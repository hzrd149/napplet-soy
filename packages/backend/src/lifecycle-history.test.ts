import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { finalizeEvent } from 'nostr-tools';
import { encodeAddress } from '../../protocol/src';
import { IndexStore } from './index-store';
import { indexStore } from './indexed-catalog';
import { lifecycleHistoryResponse } from './lifecycle-history';
import { retainedLifecycleHistory } from '../../../apps/web/src/lib/lifecycle';

const original = process.env.SPACE_INDEX_DIR;
let directory = '',
  store: IndexStore | undefined;
afterEach(async () => {
  if (original === undefined) delete process.env.SPACE_INDEX_DIR;
  else process.env.SPACE_INDEX_DIR = original;
  indexStore();
  store?.close();
  store = undefined;
  if (directory) await rm(directory, { recursive: true, force: true });
});
test('bounded history returns exact signed address revisions and paired snapshots; browser revalidates the accelerator', async () => {
  directory = await mkdtemp(join(tmpdir(), 'soy-lifecycle-history-'));
  process.env.SPACE_INDEX_DIR = directory;
  store = new IndexStore(directory, true);
  const secret = new Uint8Array(32).fill(4);
  const old = finalizeEvent(
    {
      kind: 35129,
      created_at: 1,
      content: 'Old description',
      tags: [
        ['d', 'app'],
        ['x', 'a'.repeat(64)],
      ],
    },
    secret,
  );
  const oldSnapshot = finalizeEvent(
    { ...old, kind: 5129, tags: old.tags.filter((tag) => tag[0] !== 'd') },
    secret,
  );
  const current = finalizeEvent({ ...old, created_at: 2, content: 'New description' }, secret);
  const snapshot = finalizeEvent(
    { ...current, kind: 5129, tags: current.tags.filter((tag) => tag[0] !== 'd') },
    secret,
  );
  const independent = finalizeEvent({ ...snapshot, content: 'Separate creation' }, secret);
  const differentTime = finalizeEvent({ ...snapshot, created_at: 3 }, secret);
  const foreign = finalizeEvent({ ...snapshot }, new Uint8Array(32).fill(5));
  for (const event of [old, oldSnapshot, current, snapshot, independent, differentTime, foreign])
    store.admit(event);
  const reference = encodeAddress({ kind: 35129, pubkey: current.pubkey, identifier: 'app' });
  const response = await lifecycleHistoryResponse(
    new Request(`http://local/api/lifecycle-history?reference=${reference}`),
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.complete).toBe(true);
  expect(body.manifests.map((event: { id: string }) => event.id).sort()).toEqual(
    [old.id, oldSnapshot.id, current.id, snapshot.id].sort(),
  );
  const read = await retainedLifecycleHistory(current, (async () =>
    Response.json(body)) as unknown as typeof fetch);
  expect(read.complete).toBe(true);
  expect(read.manifests).toHaveLength(4);
  const wrongAddress = await retainedLifecycleHistory(current, (async () =>
    Response.json({
      ...body,
      address: `35129:${current.pubkey}:other`,
    })) as unknown as typeof fetch);
  expect(wrongAddress.manifests).toEqual([]);
  expect(wrongAddress.complete).toBe(false);
  const forged = await retainedLifecycleHistory(current, (async () =>
    Response.json({
      ...body,
      manifests: [{ ...current, content: 'Forged' }],
    })) as unknown as typeof fetch);
  expect(forged.manifests).toEqual([]);
  expect(forged.complete).toBe(false);
  const unavailable = await retainedLifecycleHistory(
    current,
    (async () => new Response(null, { status: 503 })) as unknown as typeof fetch,
  );
  expect(unavailable.complete).toBe(false);
  expect(unavailable.warnings[0]).toContain('HTTP 503');
  let requested = false;
  const separate = await retainedLifecycleHistory(independent, (async () => {
    requested = true;
    return Response.json(body);
  }) as unknown as typeof fetch);
  expect(requested).toBe(false);
  expect(separate.manifests).toEqual([]);
  for (let i = 3; i < 132; i++)
    store.admit(finalizeEvent({ ...current, created_at: i, content: `Revision ${i}` }, secret));
  const limited = await (
    await lifecycleHistoryResponse(
      new Request(`http://local/api/lifecycle-history?reference=${reference}`),
    )
  ).json();
  expect(limited.complete).toBe(false);
  expect(limited.manifests.length).toBeLessThanOrEqual(256);
  expect(limited.manifests.filter((event: { kind: number }) => event.kind !== 5129)).toHaveLength(
    128,
  );
});
