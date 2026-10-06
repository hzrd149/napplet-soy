import { test, expect } from 'bun:test';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import { matchFilters } from 'nostr-tools';
import { findManifest } from '../../../apps/web/src/lib/protocol-catalog';
import { configureClient, protocolClient, network } from '../../../apps/web/src/lib/network';

test('reused source visibility reads still apply new signed deletions and reject foreign deletion requests', async () => {
  const owner = new PrivateKeySigner(),
    other = new PrivateKeySigner(),
    now = Math.floor(Date.now() / 1000);
  const manifest = await owner.signEvent({
    kind: 5129,
    created_at: now,
    content: 'Pinned source release',
    tags: [
      ['title', 'Read-only source'],
      ['x', 'a'.repeat(64)],
    ],
  });
  let deletionRequests = 0;
  const relay = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request, server) => (server.upgrade(request) ? undefined : new Response()),
    websocket: {
      message(socket, raw) {
        const m = JSON.parse(String(raw));
        if (m[0] !== 'REQ') return;
        if (m.slice(2).some((f: any) => f.kinds?.includes(5))) deletionRequests++;
        if (matchFilters(m.slice(2), manifest))
          socket.send(JSON.stringify(['EVENT', m[1], manifest]));
        socket.send(JSON.stringify(['EOSE', m[1]]));
      },
    },
  });
  const previous = network(),
    client = protocolClient();
  configureClient({
    relays: [`ws://127.0.0.1:${relay.port}`],
    blossom: [],
    rules: [],
    featured: [],
  });
  try {
    expect((await findManifest(manifest.id))?.id).toBe(manifest.id);
    expect((await findManifest(manifest.id))?.id).toBe(manifest.id);
    expect(deletionRequests).toBe(1);
    const deletion = { kind: 5, created_at: now + 1, tags: [['e', manifest.id]], content: '' };
    client.seed([await other.signEvent(deletion)]);
    expect((await findManifest(manifest.id))?.id).toBe(manifest.id);
    client.seed([await owner.signEvent(deletion)]);
    expect(await findManifest(manifest.id)).toBeNull();
    expect(deletionRequests).toBe(1);
  } finally {
    client.close();
    configureClient({ ...previous, rules: [], featured: [] });
    relay.stop(true);
  }
});
