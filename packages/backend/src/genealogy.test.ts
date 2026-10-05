import { expect, test } from 'bun:test';
import { finalizeEvent, getPublicKey } from 'nostr-tools';
import fixtures from '../data/catalog.json';
import { buildGenealogy } from './genealogy';
import type { SignedEvent } from '../../protocol/src';

const key = new Uint8Array(32);
key[31] = 1;
const pubkey = getPublicKey(key),
  address = (d: string) => `35129:${pubkey}:${d}`;
function manifest(d: string, ancestry: string[][] = [], kind = 35129) {
  return finalizeEvent(
    {
      ...fixtures[0].current,
      kind,
      tags: [
        ...fixtures[0].current.tags.filter(
          (t) => !['d', 'title', 'a', 'A', 'remix-version'].includes(t[0]),
        ),
        ...(kind === 35129 ? [['d', d]] : []),
        ['title', d],
        ...ancestry,
      ],
    },
    key,
  );
}
const find = (events: SignedEvent[]) => async (ref: string) =>
  events.find(
    (e) =>
      e.id === ref ||
      (e.kind === 35129 && e.tags.some((t) => t[0] === 'd' && address(t[1]) === ref)),
  ) ?? null;
test('originals have no tree; foreign current manifests follow standard a/A without Space tags', async () => {
  const original = manifest('original'),
    child = manifest('child', [
      ['a', address('original')],
      ['A', address('original')],
    ]);
  expect(await buildGenealogy(original, find([]))).toBeNull();
  const tree = await buildGenealogy(child, find([original]));
  expect(tree?.nodes.map((n) => [n.title, n.relation])).toEqual([
    ['child', 'viewed'],
    ['original', 'current'],
  ]);
  expect(tree?.gap).toBeNull();
  expect(tree?.origin).toBeNull();
});
test('snapshot a is self, not parent; A alone leaves a visible gap to the declared origin', async () => {
  const noParent = manifest('snapshot', [['a', address('self')]], 5129);
  expect(await buildGenealogy(noParent, find([]))).toBeNull();
  const snapshot = manifest(
    'snapshot',
    [
      ['a', address('self')],
      ['A', address('original')],
    ],
    5129,
  );
  const requested: string[] = [];
  const tree = await buildGenealogy(snapshot, async (r) => {
    requested.push(r);
    return null;
  });
  expect(requested).toEqual([]);
  expect(tree?.nodes).toHaveLength(1);
  expect(tree?.gap).toContain('intermediate parents');
  expect(tree?.origin?.address).toBe(address('original'));
});
test('pinned lineage resolves exact parent snapshots across generations', async () => {
  const original = manifest('original', [['a', address('original')]], 5129);
  const parent = manifest(
    'parent',
    [
      ['a', address('parent')],
      ['A', address('original')],
      ['remix-version', original.id],
    ],
    5129,
  );
  const child = manifest('child', [
    ['a', address('parent')],
    ['A', address('original')],
    ['remix-version', parent.id],
  ]);
  const tree = await buildGenealogy(child, find([parent, original]));
  expect(tree?.nodes.map((n) => n.title)).toEqual(['child', 'parent', 'original']);
  expect(tree?.nodes[1].relation).toBe('exact');
  expect(tree?.nodes[1].path).toBe(`/r/${parent.id}`);
  expect(tree?.gap).toBeNull();
});
test('missing, ambiguous and mismatched parents remain gaps; cycles terminate', async () => {
  const original = manifest('original');
  const missing = manifest('missing', [['a', address('unknown')]]);
  expect((await buildGenealogy(missing, find([])))?.gap).toContain('could not be retrieved');
  const ambiguous = manifest('ambiguous', [
    ['a', address('one')],
    ['a', address('two')],
  ]);
  expect((await buildGenealogy(ambiguous, find([])))?.gap).toContain('ambiguous');
  const mismatch = manifest('mismatch', [
    ['a', address('other')],
    ['remix-version', original.id],
  ]);
  expect((await buildGenealogy(mismatch, find([original])))?.gap).toContain('does not match');
  const a = manifest('a', [['a', address('b')]]),
    b = manifest('b', [['a', address('a')]]);
  const tree = await buildGenealogy(a, find([a, b]));
  expect(tree?.nodes).toHaveLength(2);
  expect(tree?.gap).toContain('cycle');
});
test('long chains are bounded; unsigned ancestry is never shown', async () => {
  const events = Array.from({ length: 15 }, (_, i) =>
    manifest(`g${i}`, [['a', address(`g${i + 1}`)]]),
  );
  expect((await buildGenealogy(events[0], find(events)))?.nodes).toHaveLength(12);
  await expect(buildGenealogy({ ...events[0], content: 'forged' }, find(events))).rejects.toThrow();
});

test('root napplet parent addresses work without a named d tag', async () => {
  const root = manifest('root', [], 15129);
  const child = manifest('root remix', [
    ['a', `15129:${pubkey}:`],
    ['A', `15129:${pubkey}:`],
  ]);
  const tree = await buildGenealogy(child, async (reference) =>
    reference === `15129:${pubkey}:` ? root : null,
  );
  expect(tree?.nodes.map((node) => node.title)).toEqual(['root remix', 'root']);
  expect(tree?.gap).toBeNull();
});

test('standalone snapshots follow a as ancestry without mistaking same-author parents for self', async () => {
  const parent = finalizeEvent(
    {
      kind: 35129,
      created_at: 1,
      content: 'Parent',
      tags: [
        ['d', 'parent'],
        ['title', 'parent'],
        ['x', fixtures[0].artifactHash],
      ],
    },
    key,
  );
  for (const signer of [key, new Uint8Array(32).fill(2)]) {
    const child = finalizeEvent(
      {
        kind: 5129,
        created_at: 2,
        content: 'Child',
        tags: [
          ['title', 'child'],
          ['x', fixtures[0].artifactHash],
          ['a', address('parent')],
        ],
      },
      signer,
    );
    const tree = await buildGenealogy(child, find([parent]));
    expect(tree?.nodes.map((node) => node.title)).toEqual(['child', 'parent']);
    expect(tree?.nodes[0].path).toBe(`/r/${child.id}`);
    expect(tree?.gap).toBeNull();
  }
  const standalone = finalizeEvent(
    {
      kind: 5129,
      created_at: 3,
      content: 'No ancestry',
      tags: [['x', fixtures[0].artifactHash]],
    },
    key,
  );
  expect(await buildGenealogy(standalone, find([]))).toBeNull();
});
