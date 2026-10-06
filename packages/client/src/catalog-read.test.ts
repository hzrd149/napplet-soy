import { test, expect } from 'bun:test';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import { matchFilters } from 'nostr-tools';
import { hydrateNapplet, seedCatalog } from '../../../apps/web/src/lib/protocol-catalog';
import { configureClient, protocolClient, network } from '../../../apps/web/src/lib/network';
import { publicNapplet } from '../../backend/src/public-model';
import fixtures from '../../backend/data/catalog.json';

test('legacy app presentation and its fallback profile hydrate in one relay phase', async () => {
  const author = new PrivateKeySigner(),
    pubkey = await author.getPublicKey();
  const now = Math.floor(Date.now() / 1000);
  const descriptor = await author.signEvent({
    kind: 31990,
    created_at: now,
    content: '',
    tags: [['d', 'presentation']],
  });
  const profile = await author.signEvent({
    kind: 0,
    created_at: now,
    tags: [],
    content: JSON.stringify({ name: 'Presentation author' }),
  });
  const manifest = await author.signEvent({
    ...fixtures[0].current,
    created_at: now,
    tags: [
      ...fixtures[0].current.tags.filter((t) => t[0] !== 'app'),
      ['app', `31990:${pubkey}:presentation`],
    ],
  });
  let requests = 0;
  const relay = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request, server) => (server.upgrade(request) ? undefined : new Response()),
    websocket: {
      message(socket, raw) {
        const m = JSON.parse(String(raw));
        if (m[0] !== 'REQ') return;
        requests++;
        for (const event of [descriptor, profile])
          if (matchFilters(m.slice(2), event)) socket.send(JSON.stringify(['EVENT', m[1], event]));
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
    seedCatalog([{ ...(await publicNapplet(manifest)), availability: 'ready' }]);
    const entry = await hydrateNapplet(manifest);
    expect(entry.metadata?.map((e) => e.id)).toEqual([descriptor.id, profile.id]);
    expect(requests).toBe(1);
    expect((await hydrateNapplet(manifest)).metadata?.map((e) => e.id)).toEqual([
      descriptor.id,
      profile.id,
    ]);
    expect(requests).toBe(1);
  } finally {
    client.close();
    configureClient({ ...previous, rules: [], featured: [] });
    relay.stop(true);
  }
});
