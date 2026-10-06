import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { finalizeEvent } from 'nostr-tools';

// Replay Bun's queued timeout after a failed TLS request through the real ws
// implementation. Keep this in a child: an uncaught error must fail the test.
const require = createRequire(import.meta.url);
const https = require('node:https');
const failure = new Error('Fixture TLS handshake failed');
let timeoutsDisabled = 0;
https.request = () => {
  const request = new EventEmitter() as EventEmitter & {
    end(): void;
    setTimeout(ms: number): typeof request;
    abort(): void;
    setHeader(): void;
  };
  request.setTimeout = (ms) => {
    if (ms === 0) timeoutsDisabled++;
    return request;
  };
  request.setHeader = () => {};
  request.abort = () => {
    queueMicrotask(() => request.emit('error', new Error('Fixture request aborted')));
  };
  request.end = () => {
    queueMicrotask(() => {
      if (process.argv[2] === 'timeout') {
        request.emit('timeout');
        return;
      }
      request.emit('error', failure);
      // Already queued events can still arrive after setTimeout(0).
      setTimeout(() => request.emit('timeout'), 5);
    });
  };
  return request;
};
const { socialRelay } = await import('./social-relay');
const { PreviewWebSocket } = await import('./preview-relay');
const event = finalizeEvent(
  { kind: 7, content: '+', tags: [], created_at: Math.floor(Date.now() / 1000) },
  new Uint8Array(32).fill(1),
);
const relay = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request, server) {
    return server.upgrade(request) ? undefined : new Response('', { status: 400 });
  },
  websocket: {
    message(socket, raw) {
      const message = JSON.parse(String(raw));
      if (message[0] === 'REQ') {
        socket.send(JSON.stringify(['EVENT', message[1], event]));
        socket.send(JSON.stringify(['EOSE', message[1]]));
      }
      if (message[0] === 'EVENT')
        socket.send(JSON.stringify(['OK', message[1].id, true, 'accepted']));
    },
  },
});
const local = `ws://127.0.0.1:${relay.port}`;
process.env.SPACE_INDEX_RELAYS = local;
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    switch (new URL(request.url).pathname) {
      case '/query': {
        const events = await socialRelay.query(
          ['wss://failed.example', local],
          [{ ids: [event.id] }],
        );
        return Response.json({ ids: events.map((e) => e.id), expected: event.id });
      }
      case '/publish': {
        const accepted = await socialRelay.publish(['wss://failed.example', local], event);
        return Response.json({ accepted, expected: local });
      }
      case '/close':
      case '/timeout': {
        const socket = new PreviewWebSocket('wss://failed.example');
        const errors: string[] = [];
        socket.on('error', (error) => errors.push(error.message));
        await new Promise<void>((resolve) => socket.once('close', () => resolve()));
        socket.close();
        return Response.json({ errors });
      }
      case '/health':
        return Response.json({ status: 'ok', timeoutsDisabled });
      case '/stop':
        setTimeout(() => {
          server.stop(true);
          relay.stop(true);
        }, 10);
        return new Response('stopped');
      default:
        return new Response('', { status: 404 });
    }
  },
});
console.log(server.url.href);
