import { expect, test } from 'bun:test';
import { relatedAssetHtml } from './related';
import type { AssetLock, ManagedAsset } from './index';

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const asset = (hash: string, storage: ManagedAsset['storage'] = 'external'): ManagedAsset => ({
  id: `asset-${hash[0]}`,
  hash,
  path: `assets/${hash}.bin`,
  bytes: 12,
  mime: 'application/octet-stream',
  storage,
  license: 'MIT',
  source: '',
});
const lock = (...assets: ManagedAsset[]): AssetLock => ({ version: 1, assets });

test('enumerates external resources in the head without executing scripts, sorted and deduplicated', async () => {
  const a = asset('a'.repeat(64));
  const b = asset('b'.repeat(64));
  const source =
    '<!doctype html><html><head><link rel="related" href="blossom:author.bin"><script>throw new Error()</script></head><body>Game</body></html>';
  const output = decode(
    await relatedAssetHtml(
      encode(source),
      lock(b, a, { ...a, id: 'alias' }, asset('c'.repeat(64), 'embedded')),
    ),
  );
  expect(output).toContain(`href="blossom:${a.hash}.bin?sz=12" type="application/octet-stream"`);
  expect(output).toContain('href="blossom:author.bin"');
  expect(output.indexOf(a.hash)).toBeLessThan(output.indexOf(b.hash));
  expect(output.split('data-soyli-related')).toHaveLength(3);
  expect(output).not.toContain('c'.repeat(64));
  expect(output.indexOf(b.hash)).toBeLessThan(output.indexOf('</head>'));
  expect(decode(await relatedAssetHtml(encode(output), lock(a, b)))).toBe(output);
  const changed = decode(await relatedAssetHtml(encode(output), lock(b)));
  expect(changed).not.toContain(a.hash);
  expect(changed).toContain(b.hash);
  expect(decode(await relatedAssetHtml(encode(changed), lock()))).toBe(source);
});

test('preserves unchanged self-contained HTML and creates a head when omitted', async () => {
  const source = encode('<!doctype html><title>Game</title><p>Play</p>');
  expect(await relatedAssetHtml(source, lock(asset('a'.repeat(64), 'embedded')))).toEqual(source);
  const output = decode(await relatedAssetHtml(source, lock(asset('a'.repeat(64)))));
  expect(output).toStartWith('<!doctype html><head><link rel="related"');
  expect(output).toContain('<title>Game</title>');
  expect(decode(await relatedAssetHtml(encode(output), lock(asset('a'.repeat(64)))))).toBe(output);
});

test('escapes attribute values and ignores head-like text inside scripts', async () => {
  const source = '<html><head><script>const text="</head>";</script></head></html>';
  const output = decode(
    await relatedAssetHtml(encode(source), lock({ ...asset('a'.repeat(64)), mime: 'x/"<&>' })),
  );
  expect(output).toContain('type="x/&quot;&lt;&amp;&gt;"');
  expect(output).toContain('<script>const text="</head>";</script>');
  expect(output.indexOf('data-soyli-related')).toBeLessThan(output.indexOf('<script>'));
});

test('related links remain before the body when the head end tag is omitted', async () => {
  const source = '<!doctype html><html><head><title>Game</title><body>Play</body></html>';
  const output = decode(await relatedAssetHtml(encode(source), lock(asset('a'.repeat(64)))));
  expect(output.indexOf('data-soyli-related')).toBeLessThan(output.indexOf('<body>'));
  expect(decode(await relatedAssetHtml(encode(output), lock(asset('a'.repeat(64)))))).toBe(output);
});

test('omitted heads preserve comments and the doctype ahead of generated markup', async () => {
  const prefix = '<!-- Game license: MIT -->\n<!doctype html>\n<!-- Author -->';
  const source = prefix + '<html lang="en"><title>Game</title><body>Play</body></html>';
  const output = decode(await relatedAssetHtml(encode(source), lock(asset('a'.repeat(64)))));
  expect(output).toStartWith(prefix + '<html lang="en">');
  expect(output.indexOf('data-soyli-related')).toBeLessThan(output.indexOf('<title>'));
  expect(decode(await relatedAssetHtml(encode(output), lock(asset('a'.repeat(64)))))).toBe(output);
});
