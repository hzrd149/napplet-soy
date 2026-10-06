import { expect, test } from 'bun:test';
import { browserRelayDefaults } from './client-network';
import discoveryRelays from '../../nostr/discovery-relays.json';

test('browser defaults use public relay hints rather than the indexer loopback address', () => {
  expect(
    browserRelayDefaults(
      ['ws://127.0.0.1:19347/relay', 'wss://discovery.example'],
      'wss://relay.napplet.soy,wss://discovery.example',
    ),
  ).toEqual(['wss://relay.napplet.soy', 'wss://discovery.example']);
  expect(
    browserRelayDefaults(['ws://127.0.0.1:19347/relay'], 'wss://custom.example:8443/nostr'),
  ).toEqual(['wss://custom.example:8443/nostr']);
});

test('development can keep its configured local relay and an unconfigured client has public defaults', () => {
  expect(browserRelayDefaults(['ws://127.0.0.1:19347/relay'])).toEqual([
    'ws://127.0.0.1:19347/relay',
  ]);
  expect(browserRelayDefaults([])).toEqual(['wss://relay.napplet.soy', ...discoveryRelays]);
  expect(browserRelayDefaults([])).not.toContain('wss://relay.damus.io');
  expect(browserRelayDefaults([])).not.toContain('wss://relay.pocketstr.com');
  expect(new Set(browserRelayDefaults([])).size).toBe(browserRelayDefaults([]).length);
  expect(browserRelayDefaults([])).toHaveLength(7);
  for (const relay of ['wss://relay.nos.social', 'wss://relay.nostr.net', 'wss://nostr.oxtr.dev'])
    expect(browserRelayDefaults([])).toContain(relay);
});
