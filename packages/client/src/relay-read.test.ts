import { test, expect } from 'bun:test';
import { finalizeEvent, matchFilters } from 'nostr-tools';
import { ProtocolClient } from './nostr';

test('exact event lookup waits past empty EOSE, rejects invalid arrivals and then uses its verified cache', async () => {
  const key = new Uint8Array(32);
  key[31] = 42;
  const event = finalizeEvent(
    { kind: 1618, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'Pinned proposal' },
    key,
  );
  let requests = 0;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const relay = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request, server) => (server.upgrade(request) ? undefined : new Response()),
    websocket: {
      message(socket, raw) {
        const m = JSON.parse(String(raw));
        if (m[0] !== 'REQ') return;
        requests++;
        socket.send(JSON.stringify(['EVENT', m[1], { ...event, sig: '0'.repeat(128) }]));
        timers.push(setTimeout(() => socket.send(JSON.stringify(['EVENT', m[1], event])), 60));
      },
    },
  });
  const empty = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request, server) => (server.upgrade(request) ? undefined : new Response()),
    websocket: {
      message(socket, raw) {
        const m = JSON.parse(String(raw));
        if (m[0] === 'REQ') {
          requests++;
          socket.send(JSON.stringify(['EOSE', m[1]]));
        }
      },
    },
  });
  const client = new ProtocolClient(() => [
    `ws://127.0.0.1:${empty.port}`,
    `ws://127.0.0.1:${relay.port}`,
  ]);
  try {
    const started = performance.now();
    expect((await client.queryEvent(event.id, [1618]))?.id).toBe(event.id);
    expect(performance.now() - started).toBeLessThan(500);
    const before = requests;
    expect((await client.queryEvent(event.id, [1618]))?.id).toBe(event.id);
    expect(requests).toBe(before);
    expect(() => client.queryEvent(event.id, [1618], [], AbortSignal.abort())).toThrow();
  } finally {
    timers.forEach(clearTimeout);
    client.close();
    relay.stop(true);
    empty.stop(true);
  }
});

test('shared query observables show cached and arriving events and cancel when the last UI subscriber leaves', async () => {
  const key = new Uint8Array(32);
  key[31] = 43;
  const sign = (content: string) =>
    finalizeEvent({ kind: 1, created_at: 1, tags: [], content }, key);
  const cached = sign('Cached'),
    arriving = sign('Arriving');
  let requests = 0,
    closes = 0;
  const relay = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request, server) => (server.upgrade(request) ? undefined : new Response()),
    websocket: {
      message(socket, raw) {
        const m = JSON.parse(String(raw));
        if (m[0] === 'CLOSE') closes++;
        if (m[0] === 'REQ') {
          requests++;
          if (matchFilters(m.slice(2), arriving))
            socket.send(JSON.stringify(['EVENT', m[1], arriving]));
        }
      },
    },
  });
  const client = new ProtocolClient(() => [`ws://127.0.0.1:${relay.port}`]);
  try {
    client.seed([cached]);
    const projection = client.observeQuery([{ kinds: [1] }]);
    const first: string[][] = [],
      second: string[][] = [];
    const a = projection.subscribe((events) => first.push(events.map((e) => e.id)));
    const b = projection.subscribe((events) => second.push(events.map((e) => e.id)));
    expect(first[0]).toContain(cached.id);
    for (let i = 0; i < 40 && !second.at(-1)?.includes(arriving.id); i++) await Bun.sleep(10);
    expect(second.at(-1)).toContain(arriving.id);
    expect(requests).toBe(1);
    a.unsubscribe();
    expect(closes).toBe(0);
    b.unsubscribe();
    for (let i = 0; i < 40 && !closes; i++) await Bun.sleep(10);
    expect(closes).toBe(1);
    const count = second.length;
    client.seed([sign('Later')]);
    expect(second.length).toBe(count);
  } finally {
    client.close();
    relay.stop(true);
  }
});
