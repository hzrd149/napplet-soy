import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent } from 'nostr-tools';
import sharp from 'sharp';
import { sha256 } from '../../protocol/src';
import { iconSources } from '../../protocol/src/icon';
import { validatedPreview } from '../../protocol/src/preview';
import { indexPreviewImages, cachedPreviewBytes } from './preview-images';
import { publicNapplet, publicPoster } from './public-model';

const key = new Uint8Array(32).fill(7);
const html = new TextEncoder().encode('<!doctype html><p>A standalone napplet</p>');
const png = () => sharp({ create: { width: 24, height: 24, channels: 4, background: '#266fe8' } }).png().toBuffer();
async function manifest(hash: string, mime = 'image/png', extra: string[][] = []) {
  return finalizeEvent({ kind: 35129, created_at: 100, content: 'Plain text <b>description</b>', tags: [
    ['d', 'independent'], ['x', await sha256(html)], ['title', 'Independent'],
    ['icon', hash, mime], ['server', 'https://blossom.example'], ...extra,
  ] }, key);
}
test('standalone manifest icons are fetched only from declared origins, verified, decoded and rendered from cache', async () => {
  const bytes = await png(), event = await manifest(await sha256(bytes));
  const dir = await mkdtemp(join(tmpdir(), 'manifest-icon-'));
  try {
    const entry = await publicNapplet(event);
    const urls: string[] = [];
    await indexPreviewImages(dir, [entry], [], new AbortController().signal, { download: async (url) => {
      urls.push(url.href); return bytes;
    } });
    expect(urls).toEqual([`https://blossom.example/${await sha256(bytes)}`]);
    expect(entry.description).toBe('Plain text <b>description</b>');
    expect(entry.preview?.descriptor.id).toBe(event.id);
    expect(validatedPreview(event, entry.preview)).not.toBeNull();
    expect(await cachedPreviewBytes(dir, entry.preview!)).not.toBeNull();
    expect(publicPoster(entry)).toBe(`/api/previews/${event.id}`);
    expect(validatedPreview(event, { ...entry.preview, url: `https://unlisted.example/${await sha256(bytes)}` })).toBeNull();
    expect(iconSources({ tags: [...event.tags, ['server', 'https://blossom.example/path'], ['server', 'https://user@evil.example']] })).toEqual(urls);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('bad icon hashes, mismatched MIME, undecodable bytes and unsupported icons never prevent admission', async () => {
  const good = await png(), broken = good.subarray(0, 8);
  const dir = await mkdtemp(join(tmpdir(), 'manifest-icon-bad-'));
  try {
    for (const [event, bytes] of [
      [await manifest('0'.repeat(64)), good],
      [await manifest(await sha256(good), 'image/jpeg'), good],
      [await manifest(await sha256(broken)), broken],
      [await manifest(await sha256(good), 'image/svg+xml'), good],
      [await manifest(await sha256(good), 'image/png', [['icon', await sha256(good), 'image/png']]), good],
    ] as const) {
      const entry = await publicNapplet(event);
      await indexPreviewImages(dir, [entry], [], new AbortController().signal, { download: async () => bytes });
      expect(entry.preview).toBeNull();
      expect(entry.artifactHash).toBe(await sha256(html));
      expect(publicPoster(entry)).toContain('/api/og/');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
