import { describe, expect, spyOn, test } from 'bun:test';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { verifiedSymbol } from 'nostr-tools';
import { enableWasmVerification, verifySignature } from './verify';
import { verifiedEvent } from './index';

const signed = () =>
  finalizeEvent({ kind: 1, created_at: 1, tags: [['t', 'x']], content: 'hi' }, generateSecretKey());
// A JSON round trip drops the cached verification symbol, like a relay message.
const wire = (event: object) => JSON.parse(JSON.stringify(event));

function checks() {
  expect(verifySignature(wire(signed()))).toBe(true);
  expect(verifySignature({ ...wire(signed()), content: 'changed' })).toBe(false);
  const event = wire(signed());
  expect(
    verifySignature({
      ...event,
      sig: event.sig.replace(/^./, (c: string) => (c === '0' ? '1' : '0')),
    }),
  ).toBe(false);
  expect(verifySignature({ ...event, pubkey: 'f'.repeat(64) })).toBe(false);
  expect(verifiedEvent(wire(signed())).kind).toBe(1);
  expect(() => verifiedEvent({ ...wire(signed()), content: 'changed' })).toThrow(
    'Invalid Nostr signature',
  );
}

describe('verifySignature', () => {
  test('verifies with JavaScript before WASM is enabled', checks);

  test('reuses a cached result', () => {
    const forged = { ...wire(signed()), content: 'changed', [verifiedSymbol]: true };
    expect(verifySignature(forged)).toBe(true);
  });

  test('verifies with WASM', async () => {
    const warn = spyOn(console, 'warn');
    await enableWasmVerification();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    checks();
  });
});
