import { expect, test } from 'bun:test';
import { finalizeEvent, getPublicKey, matchFilters } from 'nostr-tools';
import fixtures from '../../backend/data/catalog.json';
import { likeTemplate, deletionTemplate, socialScope } from '../../protocol/src/social';
import type { SignedEvent } from '../../protocol/src';
import { ProtocolClient } from './nostr';
import { readLikeState, readAvailableProfile } from './social';

const viewerKey = new Uint8Array(32).fill(7);
const authorKey = new Uint8Array(32);
authorKey[31] = 1; // Public fixture only.
const profile = (name: string, now: number) =>
  finalizeEvent(
    {
      kind: 0,
      created_at: now,
      tags: [],
      content: JSON.stringify({ name, lud16: 'test@wallet.example' }),
    },
    authorKey,
  );
const relay = (receive: (socket: any, message: any[]) => void) =>
  Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      if (!server.upgrade(request)) return new Response();
    },
    websocket: {
      message(socket, raw) {
        receive(socket, JSON.parse(String(raw)));
      },
    },
  });

test('like preparation uses a partial viewer read, preserves deletions and validates referenced releases', async () => {
  const manifest = fixtures[0].current;
  const now = Math.floor(Date.now() / 1000);
  const previous = finalizeEvent({ ...manifest, created_at: now - 20 }, authorKey);
  const active = finalizeEvent(likeTemplate(socialScope(previous), previous, now - 10), viewerKey);
  const removed = finalizeEvent(likeTemplate(socialScope(manifest), manifest, now - 9), viewerKey);
  const deletion = finalizeEvent(deletionTemplate([removed], now - 8), viewerKey);
  const foreignDeletion = finalizeEvent(deletionTemplate([active], now - 7), authorKey);
  const events = [previous, active, removed, deletion, foreignDeletion];
  const filtersSeen: any[] = [];
  const fast = relay((socket, m) => {
    if (m[0] !== 'REQ') return;
    filtersSeen.push(...m.slice(2));
    for (const event of events)
      if (matchFilters(m.slice(2), event)) socket.send(JSON.stringify(['EVENT', m[1], event]));
    socket.send(JSON.stringify(['EOSE', m[1]]));
  });
  const stalled = relay(() => {});
  const client = new ProtocolClient(() => [
    `ws://127.0.0.1:${fast.port}`,
    `ws://127.0.0.1:${stalled.port}`,
  ]);
  client.seed([foreignDeletion]);
  try {
    const result = await Promise.race([
      readLikeState(client, manifest, getPublicKey(viewerKey)),
      Bun.sleep(500).then(() => null),
    ]);
    expect(result?.likes.map((e) => e.id)).toEqual([active.id]);
    expect(result?.lastAction).toBe(deletion.created_at);
    expect(filtersSeen.flatMap((f) => f.kinds)).not.toContain(0);
    expect(filtersSeen.flatMap((f) => f.kinds)).not.toContain(1111);
    expect(filtersSeen.flatMap((f) => f.kinds)).not.toContain(9735);
  } finally {
    client.close();
    fast.stop(true);
    stalled.stop(true);
  }
});

test('Lightning profile lookup ignores empty, invalid and future arrivals and keeps refreshing cached profiles', async () => {
  const now = Math.floor(Date.now() / 1000),
    old = profile('Old', now - 10),
    fresh = profile('Fresh', now);

  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const empty = relay((socket, m) => {
    if (m[0] === 'REQ') socket.send(JSON.stringify(['EOSE', m[1]]));
  });
  const delayed = relay((socket, m) => {
    if (m[0] !== 'REQ') return;
    for (const event of [{ ...old, sig: '0'.repeat(128) }, profile('Future', now + 120)])
      socket.send(JSON.stringify(['EVENT', m[1], event]));
    void gate.then(() => {
      socket.send(JSON.stringify(['EVENT', m[1], fresh]));
      socket.send(JSON.stringify(['EOSE', m[1]]));
    });
  });
  const client = new ProtocolClient(() => [
    `ws://127.0.0.1:${empty.port}`,
    `ws://127.0.0.1:${delayed.port}`,
  ]);
  try {
    const first = readAvailableProfile(client, old.pubkey);
    expect(await Promise.race([first, Bun.sleep(100).then(() => null)])).toBeNull();
    release();
    expect((await first)?.id).toBe(fresh.id);
    client.seed([old]);
    expect((await readAvailableProfile(client, old.pubkey))?.id).toBe(fresh.id);
  } finally {
    release();
    client.close();
    empty.stop(true);
    delayed.stop(true);
  }
});

test('closing a Lightning lookup aborts its relay subscriptions promptly', async () => {
  const stalled = relay(() => {});
  const client = new ProtocolClient(() => [`ws://127.0.0.1:${stalled.port}`]);
  const controller = new AbortController();
  try {
    const reading = readAvailableProfile(client, getPublicKey(authorKey), [], controller.signal);
    controller.abort();
    await expect(reading).rejects.toThrow();
  } finally {
    client.close();
    stalled.stop(true);
  }
});

test('Lightning profile lookup does not resurrect an older profile when the current profile is moderated', async () => {
  const now = Math.floor(Date.now() / 1000);
  const old = profile('Old', now - 10),
    blocked = profile('Blocked', now);
  const client = new ProtocolClient(
    () => [],
    (event) => event.id !== blocked.id,
  );
  client.seed([old, blocked]);
  try {
    await expect(readAvailableProfile(client, old.pubkey)).rejects.toThrow(
      'This profile is unavailable here.',
    );
  } finally {
    client.close();
  }
});
