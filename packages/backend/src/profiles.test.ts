import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent, getPublicKey, matchFilters, nip19 } from 'nostr-tools';
import { CommunityStore } from '../../community/src/store';
import { ProfileService, profileRelays } from './profiles';
import {
  editableProfile,
  latestProfile,
  mergeProfile,
  profilePubkey,
  profileView,
} from '../../protocol/src/profile';
import type { SignedEvent } from '../../protocol/src';
import { initializePolicy, updatePolicy } from '../../moderation/src/policy';

const key = new Uint8Array(32);
key[31] = 7;
const pubkey = getPublicKey(key),
  relays = ['wss://relay.example'];
const directories: string[] = [],
  stores: CommunityStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});
const event = (
  data: unknown,
  created_at = Math.floor(Date.now() / 1000) - 10,
  tags: string[][] = [],
) =>
  finalizeEvent(
    { kind: 0, created_at, content: typeof data === 'string' ? data : JSON.stringify(data), tags },
    key,
  );
async function setup(initial: SignedEvent[] = []) {
  const path = await mkdtemp(join(tmpdir(), 'napplet-profiles-'));
  directories.push(path);
  const store = new CommunityStore(path);
  stores.push(store);
  let events = initial,
    failQuery = false,
    failPublish = false,
    queries = 0;
  const sent: SignedEvent[] = [];
  const service = new ProfileService(store, {
    async query(_, filters) {
      queries++;
      if (failQuery) throw new Error('offline');
      return events.filter((e) => matchFilters(filters, e));
    },
    async publish(_, e) {
      sent.push(e);
      if (failPublish) throw new Error('no acknowledgement');
      events.push(e);
      return relays;
    },
  });
  return {
    service,
    store,
    sent,
    setEvents: (e: SignedEvent[]) => (events = e),
    queryFailure: (v: boolean) => (failQuery = v),
    publishFailure: (v: boolean) => (failPublish = v),
    queries: () => queries,
  };
}
test('kind-0 selection verifies signatures and tie order, without reviving older valid JSON', () => {
  const old = event({ name: 'Older' }, 1),
    a = event({ name: 'A' }, 2),
    b = event({ name: 'B' }, 2);
  expect(latestProfile([b, old, a], pubkey)?.id).toBe([a.id, b.id].sort()[0]);
  const malformed = event('not json', 3);
  expect(profileView(pubkey, latestProfile([old, malformed], pubkey)).state).toBe('invalid');
  expect(latestProfile([{ ...a, content: '{"name":"Forged"}' }, old], pubkey)?.id).toBe(old.id);
  expect(profilePubkey(nip19.npubEncode(pubkey))).toBe(pubkey);
  expect(() => profilePubkey(nip19.nsecEncode(key))).toThrow();
  expect(
    profileView(
      pubkey,
      event({
        picture: 'javascript:alert(1)',
        website: 'https://user:pass@example.com',
        about: '<script>x</script>',
      }),
    ),
  ).toMatchObject({ picture: null, website: null, about: '<script>x</script>' });
});
test('profile refresh includes the seventh and eighth configured relays and selects the latest signed metadata', async () => {
  const older = event({ name: 'Seventh relay' });
  const newest = event(
    { name: 'Eighth relay', picture: 'https://images.example/avatar.png' },
    older.created_at + 1,
  );
  const requests = new Set<string>();
  const relay = Bun.serve<{ path: string }>({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      return server.upgrade(request, { data: { path: new URL(request.url).pathname } })
        ? undefined
        : new Response('', { status: 400 });
    },
    websocket: {
      message(socket, raw) {
        const message = JSON.parse(String(raw));
        if (message[0] !== 'REQ') return;
        requests.add(socket.data.path);
        const profile =
          socket.data.path === '/7' ? older : socket.data.path === '/8' ? newest : null;
        if (profile && matchFilters(message.slice(2), profile))
          socket.send(JSON.stringify(['EVENT', message[1], profile]));
        socket.send(JSON.stringify(['EOSE', message[1]]));
      },
    },
  });
  const previous = process.env.SPACE_INDEX_RELAYS;
  try {
    const urls = Array.from(
      { length: 8 },
      (_, index) => `ws://127.0.0.1:${relay.port}/${index + 1}`,
    );
    process.env.SPACE_INDEX_RELAYS = urls.join(',');
    expect(await profileRelays()).toEqual(urls);
    const { store } = await setup();
    const service = new ProfileService(store);
    const result = await service.read([pubkey], await profileRelays());
    expect(result.warning).toBeNull();
    expect(result.profiles[0]).toMatchObject({ name: 'Eighth relay', eventId: newest.id });
    expect([...requests].sort()).toEqual(['/1', '/2', '/3', '/4', '/5', '/6', '/7', '/8']);
  } finally {
    if (previous === undefined) delete process.env.SPACE_INDEX_RELAYS;
    else process.env.SPACE_INDEX_RELAYS = previous;
    relay.stop(true);
  }
});
test('profile reads are cached, signed edits preserve unknown fields/tags and require relay acceptance', async () => {
  const original = event(
    {
      name: 'Before',
      lud06: 'LNURL1KEEP',
      bot: true,
      birthday: { year: 1990 },
      custom: ['keep', { nested: 1 }],
    },
    undefined,
    [['client', 'another-client']],
  );
  const t = await setup([original]);
  await t.service.read([pubkey], relays);
  await t.service.read([pubkey], relays);
  expect(t.queries()).toBe(1);
  const fields = {
    ...editableProfile(original),
    display_name: 'After',
    about: 'Makes tiny worlds',
  };
  const updated = event(mergeProfile(original, fields), original.created_at + 1, original.tags);
  const result = await t.service.write(pubkey, { base: original.id, event: updated }, relays);
  expect(result.accepted).toEqual(relays);
  expect(result.profile.name).toBe('After');
  expect(JSON.parse(result.event.content)).toMatchObject({
    lud06: 'LNURL1KEEP',
    bot: true,
    birthday: { year: 1990 },
    custom: ['keep', { nested: 1 }],
  });
  expect(t.store.profile(pubkey)?.id).toBe(updated.id);
  const restarted = new ProfileService(t.store, t.service.relay);
  expect(restarted.event(pubkey)?.id).toBe(updated.id);
});
test('stale edits and blind creation cannot overwrite a newer external profile', async () => {
  const old = event({ name: 'Old' }),
    newer = event({ name: 'Elsewhere', wallet: 'keep' }, old.created_at + 2);
  const t = await setup([old]);
  await t.service.editBase(pubkey, relays);
  t.setEvents([newer]);
  const update = event({ name: 'Mine' }, old.created_at + 3);
  await expect(t.service.write(pubkey, { event: update, base: old.id }, relays)).rejects.toThrow(
    'changed in another client',
  );
  await expect(t.service.write(pubkey, { event: update, base: null }, relays)).rejects.toThrow(
    'changed in another client',
  );
  expect(t.sent).toHaveLength(0);
});
test('failed delivery retains the exact update for idempotent retry; unreachable reads cannot start an edit', async () => {
  const t = await setup();
  t.queryFailure(true);
  expect((await t.service.read([pubkey], relays)).warning).toBeTruthy();
  await expect(t.service.editBase(pubkey, relays)).rejects.toThrow('offline');
  t.queryFailure(false);
  t.publishFailure(true);
  const update = event({ name: 'First profile' });
  await expect(t.service.write(pubkey, { event: update, base: null }, relays)).rejects.toThrow(
    'no acknowledgement',
  );
  expect(t.store.profile(pubkey)).toBeNull();
  // Simulate an uncertain first delivery that actually reached the relay.
  t.setEvents([update]);
  t.publishFailure(false);
  expect((await t.service.write(pubkey, { event: update, base: null }, relays)).event.id).toBe(
    update.id,
  );
  expect(t.sent.map((e) => e.id)).toEqual([update.id, update.id]);
});
test('unrelated field changes, wrong author, changed tags, invalid URLs and timestamps are rejected', async () => {
  const old = event({ name: 'Old', custom: { keep: true } }, undefined, [['client', 'keep']]);
  const t = await setup([old]);
  const update = (data: unknown, tags = old.tags, time = old.created_at + 1) =>
    event(data, time, tags);
  for (const bad of [
    update({ name: 'New' }),
    update({ name: 'New', custom: {} }),
    update({ name: 'Old', custom: { keep: true } }, []),
    update({ name: 'Old', custom: { keep: true }, picture: 'http://localhost/a' }),
    update({ name: 'New', custom: { keep: true } }, old.tags, old.created_at),
  ])
    await expect(t.service.write(pubkey, { event: bad, base: old.id }, relays)).rejects.toThrow();
  await expect(
    t.service.write('a'.repeat(64), { event: update({}), base: old.id }, relays),
  ).rejects.toThrow('Invalid signed profile');
  expect(t.sent).toHaveLength(0);
});
test('untouched non-string foreign fields survive editing and malformed winners cannot be edited', async () => {
  const old = event({ name: 'Name', website: { custom: true }, lud06: 'KEEP' });
  expect(mergeProfile(old, { ...editableProfile(old), about: 'Hi' })).toMatchObject({
    website: { custom: true },
    lud06: 'KEEP',
    about: 'Hi',
  });
  const t = await setup([old, event('[]', old.created_at + 1)]);
  await expect(t.service.editBase(pubkey, relays)).rejects.toThrow('invalid JSON');
  const legacy = event({
    name: 'A'.repeat(90),
    picture: 'http://images.example/avatar.png',
    lud16: 'legacy-value',
  });
  expect(
    mergeProfile(legacy, { ...editableProfile(legacy), about: 'Only editing my bio' }),
  ).toMatchObject({
    name: 'A'.repeat(90),
    picture: 'http://images.example/avatar.png',
    lud16: 'legacy-value',
    about: 'Only editing my bio',
  });
  expect(() =>
    mergeProfile(legacy, {
      ...editableProfile(legacy),
      picture: 'http://another.example/avatar.png',
    }),
  ).toThrow('full HTTPS');
});

test('moderation hides the cached latest profile without resurrecting old metadata', async () => {
  const old = event({ name: 'Old' }, 1),
    latest = event({ name: 'Latest' }, 2);
  const t = await setup([old, latest]);
  const previous = process.env.SPACE_MODERATION_FILE;
  const path = join(directories.at(-1)!, 'policy.json');
  initializePolicy(path);
  process.env.SPACE_MODERATION_FILE = path;
  try {
    expect((await t.service.read([pubkey], relays)).profiles[0].name).toBe('Latest');
    updatePolicy(
      { action: 'block', type: 'event', target: latest.id, reason: 'test', revision: 0 },
      pubkey,
      '9'.repeat(64),
    );
    expect((await t.service.read([pubkey], relays)).profiles).toEqual([]);
    expect(() => t.service.event(pubkey)).toThrow('unavailable');
    expect(t.store.profile(pubkey)?.id).toBe(latest.id);
  } finally {
    if (previous === undefined) delete process.env.SPACE_MODERATION_FILE;
    else process.env.SPACE_MODERATION_FILE = previous;
  }
});
