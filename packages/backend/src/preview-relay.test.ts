import { expect, test } from 'bun:test';
import { RelayPool, type RelayOptions } from 'applesauce-relay';
import { finalizeEvent, matchFilters } from 'nostr-tools';
import { queryPreviewMetadata as discoverPreviewMetadata, previewRelayUrl } from './preview-relay';
import records from '../data/catalog.json';
import { discoverPreviewMetadata as workerMetadata } from './preview-discovery';

test('metadata relay hints accept only public WSS destinations', () => {
  for (const url of [
    'ws://example.com',
    'wss://127.0.0.1',
    'wss://[::1]',
    'wss://user:pass@example.com',
    'wss://example.com:8443',
  ])
    expect(() => previewRelayUrl(url)).toThrow();
});

test('the Node metadata worker accepts a bounded job and refuses private relay destinations', async () => {
  const key = new Uint8Array(32);
  key[31] = 1;
  const manifest = finalizeEvent(
    {
      ...records[0].current,
      tags: [
        ...records[0].current.tags,
        ['app', `31990:${records[0].pubkey}:app`, 'wss://localhost'],
      ],
    },
    key,
  );
  // localhost exercises connection-time DNS policy and may consume the relay's
  // 3 s query window. Include cold bundling/Node startup and leave cleanup time
  // before Bun's test deadline; equal deadlines let Bun kill the child first.
  const signal = AbortSignal.timeout(10000);
  expect(await workerMetadata([manifest], [], signal)).toEqual([]);
  // A cancellation fallback must not make a hung worker look like a rejection.
  expect(signal.aborted).toBe(false);
  const controller = new AbortController();
  controller.abort();
  expect(await workerMetadata([manifest], [], controller.signal)).toEqual([]);
}, 15000);

test('Applesauce resolves exact linked descriptors and profile fallback, rejecting unrelated and forged events', async () => {
  const key = new Uint8Array(32);
  key[31] = 1;
  const app = finalizeEvent(
    { kind: 31990, tags: [['d', 'app']], created_at: records[0].current.created_at, content: '' },
    key,
  );
  const profile = finalizeEvent(
    {
      kind: 0,
      tags: [],
      created_at: app.created_at,
      content: '{"picture":"https://images.example/cover.png"}',
    },
    key,
  );
  const manifest = finalizeEvent(
    {
      ...records[0].current,
      tags: [...records[0].current.tags, ['app', `31990:${app.pubkey}:app`, 'wss://hint.example']],
    },
    key,
  );
  const requests: unknown[][] = [];
  const connections: string[] = [];
  const relay = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return;
      return new Response('', { status: 400 });
    },
    websocket: {
      message(ws, raw) {
        const request = JSON.parse(String(raw));
        requests.push(request);
        if (request[0] === 'REQ') {
          // Send a forged and unrelated event even if it violates the filter.
          ws.send(JSON.stringify(['EVENT', request[1], { ...app, content: 'forged' }]));
          ws.send(JSON.stringify(['EVENT', request[1], records[0].current]));
          for (const event of [app, profile])
            if (matchFilters(request.slice(2), event))
              ws.send(JSON.stringify(['EVENT', request[1], event]));
          ws.send(JSON.stringify(['EOSE', request[1]]));
        }
      },
    },
  });
  class FixtureSocket extends WebSocket {
    constructor(url: string) {
      connections.push(url);
      super(`ws://127.0.0.1:${relay.port}`);
    }
  }
  try {
    const result = await discoverPreviewMetadata(
      [manifest],
      ['wss://configured.example'],
      AbortSignal.timeout(2000),
      {
        pool: new RelayPool({ WebSocket: FixtureSocket as RelayOptions['WebSocket'] }),
        timeoutMs: 500,
      },
    );
    expect(result.map((e) => e.id).sort()).toEqual([app.id, profile.id].sort());
    expect(connections).toContain('wss://hint.example/');
    expect(requests.some((r) => r[0] === 'AUTH' || r[0] === 'EVENT')).toBe(false);
    expect(
      requests
        .filter((r) => r[0] === 'REQ')
        .every((r) => r.slice(2).every((f: any) => !!f.authors)),
    ).toBe(true);
  } finally {
    relay.stop(true);
  }
});
