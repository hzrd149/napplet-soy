import { expect, test } from 'bun:test';
import { PrivateKeySigner } from 'applesauce-signers';
import { repositoryRef } from '../../collaboration/src/protocol';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { diagnose } from '../../diagnostics/src';
import { sourceGit } from '../../grasp/src/client';
import type { SignedEvent } from '../../protocol/src';
import {
  loadRepository,
  gitNostrRemotes,
  selectRepository,
  verifyReleaseReachable,
  type LinkedRepository,
} from './repository';

const pubkey = getPublicKey(generateSecretKey());
const other = getPublicKey(generateSecretKey());
async function repository() {
  const directory = await mkdtemp(join(tmpdir(), 'napplet-repository-'));
  await sourceGit(directory, ['init', '--initial-branch=master']);
  await Bun.write(join(directory, 'index.html'), '<p>one</p>');
  await sourceGit(directory, ['add', '--', 'index.html']);
  await sourceGit(directory, ['commit', '-m', 'One']);
  return directory;
}
const linked: LinkedRepository = {
  address: `30617:${pubkey}:toy`,
  pubkey,
  identifier: 'toy',
  relays: ['wss://relay.example.com/'],
  origin: 'remote origin',
  clones: ['https://git.example.com/toy.git'],
  source: 'nostr://example',
};
const state = (refs: [string, string][]) =>
  ({ kind: 30618, tags: [['d', 'toy'], ...refs] }) as unknown as SignedEvent;

test('only repository-local nostr:// remotes are detected', async () => {
  const directory = await repository();
  try {
    expect(await gitNostrRemotes(directory)).toEqual([]);
    await sourceGit(directory, ['remote', 'add', 'web', 'https://git.example.com/toy.git']);
    await sourceGit(directory, ['remote', 'add', 'my.origin', 'nostr://example.com/toy']);
    expect(await gitNostrRemotes(directory)).toEqual([
      { name: 'my.origin', url: 'nostr://example.com/toy' },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('publish.repository wins over remotes and must belong to the publishing key', async () => {
  const directory = await repository();
  try {
    await sourceGit(directory, ['remote', 'add', 'origin', 'nostr://unreachable.invalid/toy']);
    const naddr = nip19.naddrEncode({
      kind: 30617,
      pubkey,
      identifier: 'toy',
      relays: ['wss://relay.example.com'],
    });
    expect(await selectRepository({ directory, pubkey, configured: naddr })).toEqual({
      address: `30617:${pubkey}:toy`,
      pubkey,
      identifier: 'toy',
      relays: ['wss://relay.example.com'],
      origin: 'publish.repository',
    });
    await expect(
      selectRepository({ directory, pubkey: other, configured: naddr }),
    ).rejects.toMatchObject({ code: 'REPOSITORY_OWNER' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('an unreadable nostr:// remote stops publication instead of creating a second repository', async () => {
  const directory = await repository();
  try {
    await sourceGit(directory, ['remote', 'add', 'origin', 'nostr://example.com/toy']);
    const fetch = (async () => {
      throw new Error('getaddrinfo ENOTFOUND example.com');
    }) as unknown as typeof globalThis.fetch;
    const failure = await selectRepository({ directory, pubkey, fetch }).catch((e) => e);
    const diagnostic = diagnose(failure);
    expect(diagnostic.code).toBe('REPOSITORY_REMOTE');
    expect(diagnostic.details?.join('\n')).toContain('Git remote origin could not be read');
    expect(diagnostic.details?.join('\n')).toContain('ENOTFOUND');
    expect(diagnostic.recovery).toContain('publish.repository');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the release commit must be in a signed ref that a clone URL serves', async () => {
  const directory = await repository();
  try {
    const first = await sourceGit(directory, ['rev-parse', 'HEAD']);
    await Bun.write(join(directory, 'index.html'), '<p>two</p>');
    await sourceGit(directory, ['commit', '-am', 'Two']);
    const second = await sourceGit(directory, ['rev-parse', 'HEAD']);
    const served = (lines: string) => async () => lines;

    // An older release stays reachable from a newer branch tip.
    expect(
      await verifyReleaseReachable({
        directory,
        repository: linked,
        state: state([['refs/heads/master', second]]),
        commit: first,
        lsRemote: served(`${second}\trefs/heads/master`),
      }),
    ).toEqual({ ref: 'refs/heads/master', tip: second, clone: linked.clones[0] });

    // Not yet pushed: the signed state still names the older commit.
    const unpushed = await verifyReleaseReachable({
      directory,
      repository: linked,
      state: state([['refs/heads/master', first]]),
      commit: second,
      lsRemote: served(`${first}\trefs/heads/master`),
    }).catch((e) => e);
    const diagnostic = diagnose(unpushed);
    expect(diagnostic.code).toBe('SOURCE_NOT_PUSHED');
    expect(diagnostic.details?.join('\n')).toContain(`Release commit: ${second}`);
    expect(diagnostic.recovery).toContain(`Push commit ${second}`);

    // Signed, but the Git server has not received it.
    const unserved = await verifyReleaseReachable({
      directory,
      repository: linked,
      state: state([['refs/heads/master', second]]),
      commit: second,
      lsRemote: async () => {
        throw new Error('Git ls-remote failed.');
      },
    }).catch((e) => e);
    expect(unserved).toMatchObject({ code: 'SOURCE_NOT_PUSHED' });
    expect(diagnose(unserved).details?.join('\n')).toContain('Cause: Git ls-remote failed.');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('bare repository addresses and unhinted naddr discover the signed repository on configured relays', async () => {
  const signer = new PrivateKeySigner();
  const pubkey = await signer.getPublicKey();
  const relay = 'wss://repo.example/';
  const announcement = await signer.signEvent({
    kind: 30617,
    created_at: 1,
    content: '',
    tags: [
      ['d', 'game'],
      ['relays', relay],
      ['clone', 'https://repo.example/game.git'],
    ],
  });
  const state = await signer.signEvent({
    kind: 30618,
    created_at: 2,
    content: '',
    tags: [
      ['d', 'game'],
      ['refs/heads/main', 'a'.repeat(40)],
    ],
  });
  const asked: string[] = [];
  const latest = async (url: string, _key: string, _id: string, kind: number) => {
    asked.push(url);
    return url === relay ? (kind === 30617 ? announcement : state) : null;
  };
  for (const reference of [
    `30617:${pubkey}:game`,
    nip19.naddrEncode({ kind: 30617, pubkey, identifier: 'game' }),
  ]) {
    const loaded = await loadRepository(
      latest,
      { ...repositoryRef(reference), origin: 'publish.repository' },
      false,
      ['ws://127.0.0.1:9999', relay],
    );
    expect(loaded.repository.address).toBe(`30617:${pubkey}:game`);
    expect(loaded.repository.relays).toEqual([relay]);
    expect(loaded.state?.id).toBe(state.id);
  }
  expect(asked).not.toContain('ws://127.0.0.1:9999');
  // Explicit hints do not silently fall back to a different relay.
  await expect(
    loadRepository(
      latest,
      {
        ...repositoryRef(`30617:${pubkey}:game`),
        origin: 'publish.repository',
        relays: ['wss://elsewhere.example/'],
      },
      false,
      [relay],
    ),
  ).rejects.toMatchObject({ code: 'REPOSITORY_UNAVAILABLE' });
});
