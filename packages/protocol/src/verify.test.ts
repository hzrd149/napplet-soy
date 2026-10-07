import { describe, expect, spyOn, test } from 'bun:test';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { schnorr } from '@noble/curves/secp256k1.js';
import { enableWasmVerification, verifySignature } from './verify';
import { verifiedEvent } from './index';
import { fileURLToPath } from 'node:url';

const signed = () =>
  finalizeEvent({ kind: 1, created_at: 1, tags: [['t', 'x']], content: 'hi' }, generateSecretKey());
// A JSON round trip drops the cached verification symbol, like a relay message.
const wire = (event: object) => JSON.parse(JSON.stringify(event));

function malformedChecks() {
  const event = wire(signed());
  const invalid = [
    { ...event, id: '' },
    { ...event, id: event.id.slice(0, 62) },
    { ...event, id: event.id + '00' },
    { ...event, id: 'g'.repeat(64) },
    { ...event, sig: '' },
    { ...event, sig: event.sig.slice(0, 126) },
    { ...event, sig: event.sig + '00' },
    { ...event, sig: 'g'.repeat(128) },
    { ...event, pubkey: event.pubkey.slice(0, 62) },
    { ...event, created_at: '1' },
    { ...event, created_at: 1.5 },
    { ...event, created_at: -1 },
    { ...event, kind: '1' },
    { ...event, kind: 65536 },
    { ...event, content: null },
    { ...event, tags: [['t', 1]] },
    { ...event, tags: ['t'] },
    null,
  ];
  for (const candidate of invalid) {
    // Prime WASM's reusable buffers: short IDs/signatures must not reuse bytes.
    expect(verifySignature(wire(event))).toBe(true);
    expect(verifySignature(candidate as any)).toBe(false);
  }
}

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

const cwd = fileURLToPath(new URL('../../../', import.meta.url));
function isolatedJavaScript(body: string) {
  const child = Bun.spawnSync(
    [
      process.execPath,
      '-e',
      `
    import { expect, spyOn } from 'bun:test';
    import { schnorr } from '@noble/curves/secp256k1.js';
    import { finalizeEvent, generateSecretKey } from 'nostr-tools';
    import { verifySignature } from './packages/protocol/src/verify';
    import { verifiedEvent } from './packages/protocol/src';
    const signed = ${signed.toString()};
    const wire = ${wire.toString()};
    ${checks.toString()}
    ${malformedChecks.toString()}
    ${body}
  `,
    ],
    { cwd, stdout: 'pipe', stderr: 'pipe' },
  );
  expect({ exit: child.exitCode, stderr: new TextDecoder().decode(child.stderr) }).toEqual({
    exit: 0,
    stderr: '',
  });
}

describe('verifySignature', () => {
  // Another test file may already have enabled the process-wide accelerator.
  test('JavaScript verifies signatures and rejects malformed wire fields', () => {
    isolatedJavaScript('checks(); malformedChecks();');
  });

  test('reuses the cryptographic check for an unchanged verified event', () => {
    isolatedJavaScript(`
      const event = wire(signed());
      const verify = spyOn(schnorr, 'verify');
      expect(verifySignature(event)).toBe(true);
      expect(verifySignature(event)).toBe(true);
      expect(verify).toHaveBeenCalledTimes(1);
    `);
  });

  test('verifies with WASM', async () => {
    const warn = spyOn(console, 'warn');
    await enableWasmVerification();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    checks();
    malformedChecks();
  });
});

test('failed WASM initialization keeps JavaScript verification available', () => {
  const child = Bun.spawnSync(
    [
      process.execPath,
      '-e',
      `
    import { finalizeEvent, generateSecretKey } from 'nostr-tools';
    import { enableWasmVerification, verifySignature } from './packages/protocol/src/verify';
    const event = JSON.parse(JSON.stringify(finalizeEvent({ kind: 1, created_at: 1, tags: [], content: 'test' }, generateSecretKey())));
    const warnings = [];
    console.warn = (...args) => warnings.push(args);
    globalThis.DecompressionStream = class { constructor() { throw new Error('synthetic initialization failure'); } };
    await enableWasmVerification();
    await enableWasmVerification();
    console.log(JSON.stringify({
      warnings: warnings.length,
      cause: warnings[0]?.[1]?.cause,
      valid: verifySignature(event),
      invalid: verifySignature({ ...JSON.parse(JSON.stringify(event)), content: 'changed' }),
    }));
  `,
    ],
    { cwd, stdout: 'pipe', stderr: 'pipe' },
  );
  expect(child.exitCode).toBe(0);
  expect(JSON.parse(new TextDecoder().decode(child.stdout))).toEqual({
    warnings: 1,
    cause: 'synthetic initialization failure',
    valid: true,
    invalid: false,
  });
});
