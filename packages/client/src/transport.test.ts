import { expect, test } from 'bun:test';
import { finalizeEvent, matchFilters } from 'nostr-tools';
import { ProtocolClient } from './nostr';
import { blossomBytes, readBytes, resourceUrl } from './bytes';
import { sha256 } from '../../protocol/src';
const key = new Uint8Array(32).fill(7); // Public fixture only.
const sign = (kind: number, content = '', created_at = Math.floor(Date.now() / 1000)) =>
  finalizeEvent({ kind, tags: [], content, created_at }, key);

test('direct queries reject invalid signatures, mismatched filters and future events; publish requires a relay acknowledgement', async () => {
  const good = sign(1, 'from Nostr'),
    unrelated = sign(2),
    future = sign(1, '', Math.floor(Date.now() / 1000) + 1000);
  const attempts: string[] = [];
  let connections = 0;
  let deny = true;
  const relay = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(r, server) {
      if (server.upgrade(r)) return;
      return new Response('', { status: 404 });
    },
    websocket: {
      open() {
        connections++;
      },
      message(socket, raw) {
        const m = JSON.parse(String(raw));
        if (m[0] === 'REQ') {
          for (const e of [good, good, unrelated, future, { ...good, content: 'tampered' }])
            socket.send(JSON.stringify(['EVENT', m[1], e]));
          socket.send(JSON.stringify(['EOSE', m[1]]));
        } else if (m[0] === 'EVENT') {
          attempts.push(JSON.stringify(m[1]));
          socket.send(JSON.stringify(['OK', m[1].id, !deny, 'fixture']));
        }
      },
    },
  });
  const client = new ProtocolClient(() => [`ws://127.0.0.1:${relay.port}`]);
  try {
    const streamed: string[] = [];
    expect(
      (await client.query([{ kinds: [1] }], [], undefined, (e) => streamed.push(e.id))).map(
        (e) => e.id,
      ),
    ).toEqual([good.id]);
    expect(streamed).toEqual([good.id]);
    expect((await client.query([{ ids: [good.id], kinds: [1] }])).map((e) => e.id)).toEqual([
      good.id,
    ]);
    await expect(client.publish(good)).rejects.toThrow('No relay acknowledged');
    deny = false;
    expect(await client.publish(good)).toHaveLength(1);
    expect(connections).toBe(1);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toBe(attempts[1]);
    expect(JSON.parse(attempts[0])).toEqual(JSON.parse(JSON.stringify(good)));
  } finally {
    client.close();
    relay.stop(true);
  }
});

test('aborting a relay query closes its subscription without waiting for the relay', async () => {
  const relay = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(r, server) {
      if (server.upgrade(r)) return;
      return new Response();
    },
    websocket: { message() {} },
  });
  const client = new ProtocolClient(() => [`ws://127.0.0.1:${relay.port}`]);
  try {
    const start = Date.now();
    await expect(client.query([{ kinds: [1] }], [], AbortSignal.timeout(60))).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(1000);
  } finally {
    client.close();
    relay.stop(true);
  }
});

test('Blossom bytes are verified across declared fallbacks and redirects are refused', async () => {
  const bytes = new TextEncoder().encode('<!doctype html><p>Verified</p>'),
    hash = await sha256(bytes);
  const paths: string[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request): Response {
      const path = new URL(request.url).pathname;
      paths.push(path);
      if (path.startsWith('/redirect/'))
        return Response.redirect(`http://127.0.0.1:${server.port}/${hash}`);
      return new Response(path.startsWith('/bad/') ? 'tampered' : bytes);
    },
  });
  const origin = `http://127.0.0.1:${server.port}`;
  try {
    expect(
      await blossomBytes(hash, [origin + '/bad', origin], AbortSignal.timeout(1000), undefined, [
        origin,
      ]),
    ).toEqual(bytes);
    await expect(
      blossomBytes(hash, [origin + '/redirect'], AbortSignal.timeout(1000), undefined, [origin]),
    ).rejects.toThrow('verified file');
    expect(paths).toEqual([`/bad/${hash}`, `/${hash}`, `/redirect/${hash}`]);
    await expect(blossomBytes(hash, [origin], AbortSignal.timeout(1000))).rejects.toThrow(
      'verified file',
    );
    expect(() => resourceUrl('https://127.0.0.1/private')).toThrow();
    expect(() => resourceUrl('https://user:password@files.example/x')).toThrow();
    expect(resourceUrl('https://files.example:8443/x').port).toBe('8443');
  } finally {
    server.stop(true);
  }
});

test('streaming download limits apply even without Content-Length', async () => {
  const response = new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(6));
        c.enqueue(new Uint8Array(6));
        c.close();
      },
    }),
  );
  await expect(readBytes(response, 10)).rejects.toThrow('too-large');
});

test('mutation reads refuse a partial relay view even when one relay supplies events', async () => {
  const good = sign(3);
  const relays = [true, false].map((complete) =>
    Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: (r, s) => (s.upgrade(r) ? undefined : new Response()),
      websocket: {
        message(ws, raw) {
          const m = JSON.parse(String(raw));
          if (m[0] !== 'REQ') return;
          ws.send(JSON.stringify(['EVENT', m[1], good]));
          ws.send(JSON.stringify([complete ? 'EOSE' : 'CLOSED', m[1], 'read refused']));
        },
      },
    }),
  );
  const client = new ProtocolClient(() => relays.map((r) => `ws://127.0.0.1:${r.port}`));
  try {
    expect(await client.query([{ kinds: [3] }])).toHaveLength(1);
    await expect(client.query([{ kinds: [3] }], [], undefined, undefined, true)).rejects.toThrow(
      'list-unavailable',
    );
  } finally {
    client.close();
    relays.forEach((r) => r.stop(true));
  }
});

test('publication returns on a fast acknowledgement while the other relay still receives the event', async () => {
  const event = sign(7, '+');
  let acknowledgeSlow: (() => void) | undefined;
  let sawFast!: () => void;
  const fastAcknowledged = new Promise<void>((resolve) => {
    sawFast = resolve;
  });
  const received: string[] = [];
  const relays = [true, false].map((fast) =>
    Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: (r, server) => (server.upgrade(r) ? undefined : new Response()),
      websocket: {
        message(socket, raw) {
          const message = JSON.parse(String(raw));
          if (message[0] !== 'EVENT') return;
          received.push(message[1].id);
          const acknowledge = () => socket.send(JSON.stringify(['OK', event.id, true, 'saved']));
          if (fast) {
            acknowledge();
            sawFast();
          } else acknowledgeSlow = acknowledge;
        },
      },
    }),
  );
  const urls = relays.map((r) => `ws://127.0.0.1:${r.port}`);
  const client = new ProtocolClient(() => urls);
  const publication = client.publish(event);
  try {
    await fastAcknowledged;
    const accepted = await Promise.race([publication, Bun.sleep(300).then(() => null)]);
    expect(accepted).toEqual([`${urls[0]}/`]);
    // First acceptance can arrive before the other socket has delivered its write.
    // Fanout must finish delivering promptly; it need not precede the first ACK.
    for (let i = 0; i < 30 && received.length < 2; i++) await Bun.sleep(10);
    expect(received).toEqual([event.id, event.id]);
    expect(client.store.hasEvent(event.id)).toBe(true);
  } finally {
    acknowledgeSlow?.();
    await publication.catch(() => {});
    client.close();
    relays.forEach((r) => r.stop(true));
  }
});
