import { expect, test } from 'bun:test';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { PrivateKeySigner } from '@contextvm/sdk/signer';
import { enableWasmVerification } from '../../protocol/src/verify';
import { NappletBackend } from './backend-session';

test('CVM discovery rejects malformed relay events with the WASM verifier enabled', async () => {
  await enableWasmVerification();
  const announcement = (name: string) =>
    JSON.parse(
      JSON.stringify(
        finalizeEvent(
          {
            kind: 11316,
            created_at: Math.floor(Date.now() / 1000),
            content: JSON.stringify({ name }),
            tags: [],
          },
          generateSecretKey(),
        ),
      ),
    );
  const valid = announcement('valid provider');
  const noId = { ...announcement('empty id'), id: '' };
  const truncated = announcement('truncated id');
  truncated.id = truncated.id.slice(0, 62);
  const timestamp = announcement('string timestamp');
  timestamp.created_at = String(timestamp.created_at);
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return;
      return new Response('WebSocket required', { status: 400 });
    },
    websocket: {
      message(socket, data) {
        const [type, id] = JSON.parse(String(data));
        if (type === 'REQ') {
          for (const event of [noId, truncated, timestamp, valid])
            socket.send(JSON.stringify(['EVENT', id, event]));
          socket.send(JSON.stringify(['EOSE', id]));
        }
      },
    },
  });
  const relay = `ws://127.0.0.1:${server.port}`;
  const host = new NappletBackend(
    new PrivateKeySigner(),
    [relay],
    undefined,
    () => {},
    async () => true,
  );
  try {
    const result = await host.handle({ type: 'cvm.discover', query: { relays: [relay] } });
    expect(result.servers).toEqual([
      { pubkey: valid.pubkey, relays: [new URL(relay).href], name: 'valid provider' },
    ]);
  } finally {
    host.close();
    server.stop(true);
  }
});
