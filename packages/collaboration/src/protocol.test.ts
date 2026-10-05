import { test, expect } from 'bun:test';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import { aggregateHash, sha256 } from '../../protocol/src';
import {
  observeProposals,
  proposalsFromEvents,
  repositoryRef,
  validatePreview,
  type Repository,
} from './protocol';
import type { ProtocolClient } from '../../client/src/nostr';
import { lastValueFrom, of, delay, timeout } from 'rxjs';
const author = new PrivateKeySigner(),
  other = new PrivateKeySigner(),
  owner = new PrivateKeySigner();
async function fixture() {
  const pubkey = await owner.getPublicKey(),
    id = 'a'.repeat(40);
  const event = await owner.signEvent({
    kind: 30617,
    created_at: 1,
    content: '',
    tags: [['d', 'toy']],
  });
  const repo: Repository = {
    ...repositoryRef(`30617:${pubkey}:toy`),
    event,
    clones: [],
    maintainers: [pubkey],
  };
  const root = await author.signEvent({
    kind: 1618,
    created_at: 2,
    content: 'Try a new idea',
    tags: [
      ['a', repo.address],
      ['subject', 'New idea'],
      ['c', id],
      ['clone', 'https://git.example/toy.git'],
    ],
  });
  return { repo, root };
}
test('progressive proposal reads finish empty lists and wait for related status before completing', async () => {
  const { repo, root } = await fixture();
  const emptyClient = {
    allowed: () => true,
    observeQuery: () => of([]),
  } as unknown as ProtocolClient;
  expect(await lastValueFrom(observeProposals(emptyClient, repo).pipe(timeout(200)))).toEqual([]);
  const status = await owner.signEvent({
    kind: 1631,
    created_at: 4,
    content: '',
    tags: [['e', root.id, '', 'root']],
  });
  let reads = 0;
  const client = {
    allowed: () => true,
    observeQuery: () => (++reads === 1 ? of([root]) : of([status]).pipe(delay(25))),
  } as unknown as ProtocolClient;
  const result = await lastValueFrom(observeProposals(client, repo).pipe(timeout(200)));
  expect(reads).toBe(2);
  expect(result[0].status).toBe('merged');
});
test('only the proposer can update a PR; status authority and comments follow NIP-34/NIP-22', async () => {
  const { repo, root } = await fixture();
  const update = {
    kind: 1619,
    created_at: 3,
    content: '',
    tags: [
      ['a', repo.address],
      ['E', root.id],
      ['P', root.pubkey],
      ['c', 'b'.repeat(40)],
      ['clone', 'https://git.example/toy.git'],
    ],
  };
  const fake = await other.signEvent({ ...update, created_at: 4 }),
    valid = await author.signEvent(update);
  const status = {
    kind: 1632,
    created_at: 5,
    content: 'No thanks',
    tags: [['e', root.id, '', 'root']],
  };
  const badStatus = await other.signEvent({ ...status, created_at: 6 }),
    goodStatus = await owner.signEvent(status);
  const [p] = proposalsFromEvents(repo, [root, valid, fake, badStatus, goodStatus]);
  expect(p.revision.id).toBe(valid.id);
  expect(p.revisions).toHaveLength(2);
  expect(p.status).toBe('closed');
  expect(proposalsFromEvents(repo, [root, fake, badStatus])[0].revision.id).toBe(root.id);
});
for (const format of ['legacy', 'standalone'])
  test(`${format} preview is bound to exact Git commit, event author and descriptor bytes`, async () => {
    const commit = 'a'.repeat(40),
      hash = 'f'.repeat(64),
      pubkey = await author.getPublicKey();
    const manifest = await author.signEvent({
      kind: 5129,
      created_at: 1,
      content: format === 'standalone' ? 'A playable proposed improvement.' : '',
      tags: [
        ...(format === 'standalone'
          ? [
              ['x', hash],
              ['R', 'storage'],
              ['O', 'theme'],
              ['i', 'napplet:track/edit', 'track'],
            ]
          : [
              ['a', `35129:${pubkey}:preview`],
              ['path', '/index.html', hash],
              ['x', await aggregateHash([{ path: '/index.html', hash }]), 'aggregate'],
            ]),
        ['source-commit', commit],
      ],
    });
    const bytes = new TextEncoder().encode(
      JSON.stringify({ version: 1, commit, manifest, check: { profile: 'test', browser: 'test' } }),
    );
    const tags = [
      ['c', commit],
      ['soy-preview', 'https://blossom.example/blob', await sha256(bytes), commit],
    ];
    const revision = await author.signEvent({ kind: 1618, created_at: 1, content: '', tags });
    expect((await validatePreview(bytes, revision)).artifactHash).toBe(hash);
    await expect(validatePreview(bytes.slice(1), revision)).rejects.toThrow('hash');
    await expect(
      validatePreview(bytes, await other.signEvent({ ...revision, tags })),
    ).rejects.toThrow('author');
    await expect(
      validatePreview(
        bytes,
        await author.signEvent({ ...revision, tags: [['c', 'b'.repeat(40)], tags[1]] }),
      ),
    ).rejects.toThrow('commit');
  });
