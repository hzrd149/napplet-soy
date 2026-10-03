import { expect, test } from 'bun:test';
import { MAX_ARTIFACT_BYTES, sha256 } from '../../protocol/src';
import { PLAYER_SANDBOX, loadArtifact, verifiedDocument } from './index';
test('verifies bytes before constructing a document', async () => {
  const source = '<h1>Hello</h1><script>console.log("hello")</script>';
  const html = await verifiedDocument(new TextEncoder().encode(source), await sha256(source));
  expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<h1>'));
  expect(html).toContain("connect-src 'none'");
  expect(PLAYER_SANDBOX).toBe('allow-scripts');
});
test('tampering and oversized packages fail closed', async () => {
  await expect(
    verifiedDocument(new TextEncoder().encode('changed'), '0'.repeat(64)),
  ).rejects.toThrow('does not match');
  await expect(
    verifiedDocument(new Uint8Array(MAX_ARTIFACT_BYTES + 1), '0'.repeat(64)),
  ).rejects.toThrow('25 MiB');
});
test('non-UTF8 HTML is rejected', async () => {
  const bytes = new Uint8Array([0xff, 0xfe]);
  await expect(verifiedDocument(bytes, await sha256(bytes))).rejects.toThrow();
});

test('the 25 MiB HTML boundary preserves hash and UTF-8 verification', async () => {
  expect(MAX_ARTIFACT_BYTES).toBe(25 * 1024 * 1024);
  const bytes = new Uint8Array(25 * 1024 * 1024).fill(32);
  bytes.set(new TextEncoder().encode('<!doctype html><p>Large playable creation</p>'));
  const hash = await sha256(bytes);
  const document = await verifiedDocument(bytes, hash);
  expect(document).toContain('<p>Large playable creation</p>');
  expect(document.length).toBeGreaterThan(bytes.length);
  await expect(verifiedDocument(bytes, '0'.repeat(64))).rejects.toThrow('does not match');
  bytes[bytes.length - 1] = 0xff;
  await expect(verifiedDocument(bytes, await sha256(bytes))).rejects.toThrow();
  await expect(
    verifiedDocument(new Uint8Array(25 * 1024 * 1024 + 1), '0'.repeat(64)),
  ).rejects.toThrow('25 MiB');
});

test('the artifact downloader accepts verified HTML above 10 MiB', async () => {
  const source = '<!doctype html><p>Large download</p>' + ' '.repeat(11 * 1024 * 1024);
  const hash = await sha256(source);
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response(source) });
  try {
    const document = await loadArtifact(
      hash,
      AbortSignal.timeout(5000),
      undefined,
      [server.url.origin],
      [server.url.origin],
    );
    expect(document).toContain('<p>Large download</p>');
    expect(document.length).toBeGreaterThan(11 * 1024 * 1024);
  } finally {
    server.stop(true);
  }
});
