import { expect, test } from 'bun:test';
import { finalizeEvent } from 'nostr-tools';
import records from '../../backend/data/catalog.json';
import { publicNapplet } from '../../backend/src/public-model';
import { preparePlayback } from './playback';
import { appDataPolicy } from './app-data-session';
import { BackendAccount } from './backend-account';
import { scopedStorage } from './storage';
import { NappletConfig } from './config-session';
import { encodeAddress } from '../../protocol/src';

test('fixtures and relay-imported copies have identical playback identity and capabilities', async () => {
  for (const record of records) {
    expect((await preparePlayback(record.current, record.artifactHash)).hostIdentity).toBe(
      (await preparePlayback(record.snapshot, record.artifactHash)).hostIdentity,
    );
    for (const manifest of [record.current, record.snapshot]) {
      expect(manifest.tags.some((t) => ['space', 'e'].includes(t[0]))).toBe(false);
      const imported = await publicNapplet(manifest);
      const local = await preparePlayback(manifest, record.artifactHash);
      const remote = await preparePlayback(imported.manifest, imported.artifactHash);
      expect(local.hostIdentity).toBe(remote.hostIdentity);
      expect(local.domains).toEqual(remote.domains);
      expect(local.aggregateHash).toBe(imported.aggregateHash);
    }
  }
});

test('snapshots preserve app identity and cannot claim another signer’s storage', async () => {
  const record = records[0];
  const key = new Uint8Array(32);
  key[31] = 2;
  const otherAuthor = finalizeEvent({ ...record.snapshot }, key);
  key[31] = 1;
  const otherApp = finalizeEvent(
    {
      ...record.snapshot,
      tags: record.snapshot.tags.map((t) =>
        t[0] === 'a' ? ['a', `35129:${record.pubkey}:other`] : t,
      ),
    },
    key,
  );
  const original = await preparePlayback(record.snapshot, record.artifactHash);
  for (const manifest of [otherAuthor, otherApp])
    expect((await preparePlayback(manifest, record.artifactHash)).hostIdentity).not.toBe(
      original.hostIdentity,
    );
});

test('local and imported metadata cannot bypass required capabilities or artifact verification', async () => {
  const record = records[0];
  const key = new Uint8Array(32);
  key[31] = 1;
  const manifest = finalizeEvent(
    { ...record.current, tags: [...record.current.tags, ['requires', 'connect']] },
    key,
  );
  const imported = await publicNapplet(manifest);
  expect(imported.availability).toBe('host-required');
  for (const event of [manifest, imported.manifest])
    await expect(preparePlayback(event, record.artifactHash)).rejects.toThrow('connect');
  await expect(preparePlayback(record.current, '0'.repeat(64))).rejects.toThrow('does not match');
});

function standalone(kind: number, extra: string[][] = [], hash = records[0].artifactHash) {
  const key = new Uint8Array(32);
  key[31] = 1;
  return finalizeEvent(
    {
      kind,
      created_at: 1,
      content: 'Standalone identity fixture',
      tags: [['x', hash], ...(kind === 35129 ? [['d', records[0].identifier]] : []), ...extra],
    },
    key,
  );
}

test('new named manifests keep verified same-build saves, settings and public-data scope', async () => {
  const old = await preparePlayback(records[0].current, records[0].artifactHash);
  const next = await preparePlayback(standalone(35129), records[0].artifactHash);
  expect(next.identityHash).toBe(records[0].artifactHash);
  expect(next.hostIdentity).toBe(old.hostIdentity);
  const data = new Map<string, string>();
  const storage = {
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
  scopedStorage(
    storage,
    `${old.hostIdentity}:guest`,
    'old',
  )({
    type: 'storage.set',
    key: 'save',
    value: 'progress',
  });
  expect(
    scopedStorage(
      storage,
      `${next.hostIdentity}:guest`,
      'new',
    )({
      type: 'storage.get',
      key: 'save',
    }),
  ).toEqual({ value: 'progress' });
  storage.setItem(`space:config:v1:${JSON.stringify([old.hostIdentity, 'guest'])}`, '{"score":7}');
  const config = new NappletConfig({
    storage,
    identity: next.hostIdentity,
    pubkey: null,
    focused: () => false,
    send() {},
    declaration: {
      schema: { type: 'object', properties: { score: { type: 'number', default: 0 } } },
    },
  });
  expect(config.getSnapshot().values).toEqual({ score: 7 });
  config.close();
  expect(appDataPolicy(next.hostIdentity, []).scope).toBe(
    appDataPolicy(old.hostIdentity, []).scope,
  );
  const changed = await preparePlayback(standalone(35129, [], 'b'.repeat(64)), 'b'.repeat(64));
  expect(changed.hostIdentity).not.toBe(old.hostIdentity);
});

test('standalone snapshots play independently and lineage grants no parent data or backend binding', async () => {
  const parent = await preparePlayback(standalone(35129), records[0].artifactHash);
  for (const extra of [
    [],
    [['a', `35129:${records[0].pubkey}:${records[0].identifier}`]],
    [['a', `35129:${'f'.repeat(64)}:foreign`]],
  ]) {
    const event = standalone(5129, extra);
    const snapshot = await preparePlayback(event, records[0].artifactHash);
    expect(snapshot.hostIdentity).toBe(
      `${event.pubkey}:5129:${event.id}:${records[0].artifactHash}`,
    );
    expect(appDataPolicy(snapshot.hostIdentity, []).scope).not.toBe(
      appDataPolicy(parent.hostIdentity, []).scope,
    );
    const account = new BackendAccount(
      {
        identity: snapshot.hostIdentity,
        pubkey: records[0].pubkey,
        sign: async () => {
          throw new Error('Unexpected signing');
        },
        signal: new AbortController().signal,
        consent: async () => {
          throw new Error('Unexpected consent');
        },
      },
      async () => 'a'.repeat(64),
    );
    await expect(
      account.arguments(
        {
          tool: async () => {
            throw new Error('Unexpected backend call');
          },
        },
        'b'.repeat(64),
        'soy_backend_invoke',
        {
          target: {
            module: {
              napplet: encodeAddress({
                kind: 35129,
                pubkey: records[0].pubkey,
                identifier: records[0].identifier,
              }),
              name: 'worlds',
            },
          },
        },
      ),
    ).rejects.toThrow('Backend account binding must belong to this signed napplet');
  }
});
