import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { publicNapplet } from '../../backend/src/public-model';
import { IndexStore } from '../../backend/src/index-store';
import { indexStore } from '../../backend/src/indexed-catalog';
import { communityEntries } from '../../backend/src/public-catalog';
import { seedCatalog, availableCatalog } from '../../../apps/web/src/lib/protocol-catalog';
import type { SignedEvent } from '../../protocol/src';
import { socialScope } from '../../protocol/src/social';

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
async function publications() {
  const secret = generateSecretKey(),
    pubkey = getPublicKey(secret);
  const address = `35129:${pubkey}:game`;
  const snapshots: SignedEvent[] = [],
    descriptors: SignedEvent[] = [];
  for (let i = 0; i < 3; i++) {
    const descriptor = finalizeEvent(
      {
        kind: 32267,
        created_at: 10 + i,
        content: 'A game',
        tags: [
          ['d', `release-${i}`],
          ['name', 'Same title'],
          ['latest', address],
        ],
      },
      secret,
    );
    descriptors.push(descriptor);
    snapshots.push(
      finalizeEvent(
        {
          kind: 5129,
          created_at: 10 + i,
          content: 'A game',
          tags: [
            ['x', String(i + 1).repeat(64)],
            ['title', 'Same title'],
            ['app', `32267:${pubkey}:release-${i}`],
          ],
        },
        secret,
      ),
    );
  }
  const current = finalizeEvent(
    {
      kind: 35129,
      created_at: 13,
      content: 'A game, updated',
      tags: [
        ['d', 'game'],
        ['x', '4'.repeat(64)],
        ['title', 'A renamed game'],
      ],
    },
    secret,
  );
  const entries = await Promise.all(
    [current, ...snapshots].map(async (event) => ({
      ...(await publicNapplet(event)),
      metadata: descriptors,
    })),
  );
  return { secret, pubkey, address, current, snapshots, descriptors, entries };
}

test('fresh browser discovery groups historical snapshots using verified author references without observing old named revisions', async () => {
  const f = await publications();
  seedCatalog(f.entries);
  expect(
    availableCatalog()
      .filter((n) => n.pubkey === f.pubkey)
      .map((n) => n.revisionId),
  ).toEqual([f.current.id]);
  for (const snapshot of f.snapshots) expect(socialScope(snapshot).key).toBe(snapshot.id);
});

test('server gallery groups historical snapshots even if the index missed their old named revisions', async () => {
  const f = await publications();
  directory = await mkdtemp(join(tmpdir(), 'soy-presentation-grouping-'));
  process.env.SPACE_INDEX_DIR = directory;
  store = new IndexStore(directory, true);
  for (const entry of f.entries) {
    store.admit(entry.manifest);
    store.project(entry.revisionId, entry, 0, 0);
  }
  expect((await communityEntries()).map((n) => n.revisionId)).toEqual([f.current.id]);
});

test('independent snapshots, foreign descriptors and forged or ambiguous latest references remain discoverable', async () => {
  const f = await publications();
  const snapshot = f.snapshots[0],
    descriptor = f.descriptors[0];
  const independent = finalizeEvent(
    { ...snapshot, created_at: 14, tags: snapshot.tags.filter((t) => t[0] !== 'app') },
    f.secret,
  );
  const forged = {
    ...descriptor,
    tags: descriptor.tags.map((t) => (t[0] === 'latest' ? ['latest', f.address] : t)),
    sig: '0'.repeat(128),
  };
  const ambiguous = finalizeEvent(
    { ...descriptor, tags: [...descriptor.tags, ['latest', `35129:${f.pubkey}:other`]] },
    f.secret,
  );
  const foreignKey = generateSecretKey(),
    foreign = finalizeEvent({ ...descriptor }, foreignKey);
  const foreignSnapshot = finalizeEvent(
    {
      ...snapshot,
      created_at: 15,
      tags: snapshot.tags.map((t) =>
        t[0] === 'app' ? ['app', `32267:${foreign.pubkey}:release-0`] : t,
      ),
    },
    f.secret,
  );
  for (const metadata of [[forged], [ambiguous], [foreign]]) {
    seedCatalog([
      { ...(await publicNapplet(snapshot)), metadata },
      ...f.entries.filter((n) => n.manifest.kind !== 5129),
    ]);
    expect(availableCatalog().some((n) => n.revisionId === snapshot.id)).toBe(true);
  }
  seedCatalog([
    { ...(await publicNapplet(independent)), metadata: f.descriptors },
    { ...(await publicNapplet(foreignSnapshot)), metadata: [foreign] },
  ]);
  expect(availableCatalog().some((n) => n.revisionId === independent.id)).toBe(true);
  expect(availableCatalog().some((n) => n.revisionId === foreignSnapshot.id)).toBe(true);
});

test('a title collision or absent target cannot hide an independent snapshot', async () => {
  const f = await publications();
  seedCatalog([f.entries[1]]); // No current target observed.
  expect(availableCatalog().some((n) => n.revisionId === f.snapshots[0].id)).toBe(true);
  const other = finalizeEvent(
    { ...f.current, tags: f.current.tags.map((t) => (t[0] === 'd' ? ['d', 'different-app'] : t)) },
    f.secret,
  );
  seedCatalog([await publicNapplet(other)]);
  expect(availableCatalog().some((n) => n.revisionId === f.snapshots[0].id)).toBe(true);
});

test('observing old signed named revisions groups their snapshots without resurrecting old listing cards', async () => {
  const f = await publications();
  seedCatalog(f.entries.map((n) => ({ ...n, metadata: [] })));
  for (const snapshot of f.snapshots) {
    const historical = finalizeEvent(
      { ...snapshot, kind: 35129, tags: [...snapshot.tags, ['d', 'game']] },
      f.secret,
    );
    seedCatalog([await publicNapplet(historical)]);
  }
  expect(
    availableCatalog()
      .filter((n) => n.pubkey === f.pubkey)
      .map((n) => n.revisionId),
  ).toEqual([f.current.id]);
});

test('an older or expired named target cannot hide a newer snapshot', async () => {
  for (const expired of [false, true]) {
    const f = await publications();
    const current = finalizeEvent(
      {
        ...f.current,
        created_at: expired ? 13 : 9,
        tags: [...f.current.tags, ...(expired ? [['expiration', '1']] : [])],
      },
      f.secret,
    );
    seedCatalog([{ ...f.entries[1] }, await publicNapplet(current)]);
    expect(availableCatalog().some((n) => n.revisionId === f.snapshots[0].id)).toBe(true);
  }
});

test('root manifests can group only their own author-referenced snapshots', async () => {
  const f = await publications();
  const root = finalizeEvent(
    { ...f.current, kind: 15129, tags: f.current.tags.filter((t) => t[0] !== 'd') },
    f.secret,
  );
  const descriptor = finalizeEvent(
    {
      ...f.descriptors[0],
      tags: f.descriptors[0].tags.map((t) =>
        t[0] === 'latest' ? ['latest', `15129:${f.pubkey}:`] : t,
      ),
    },
    f.secret,
  );
  seedCatalog([{ ...f.entries[1], metadata: [descriptor] }, await publicNapplet(root)]);
  expect(
    availableCatalog()
      .filter((n) => n.pubkey === f.pubkey)
      .map((n) => n.revisionId),
  ).toEqual([root.id]);
});
