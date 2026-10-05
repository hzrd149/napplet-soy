import { expect, test } from 'bun:test';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { indexedPinnedManifest } from './pinned-manifest';

const event = finalizeEvent(
  {
    kind: 35129,
    created_at: 1,
    content: 'An archived release',
    tags: [
      ['d', 'archived'],
      ['x', 'a'.repeat(64)],
    ],
  },
  generateSecretKey(),
);
const transport = (response: () => Response) =>
  (async (url: string, options: RequestInit) => {
    expect(url).toBe(`/api/manifest?reference=${event.id}`);
    expect(options.redirect).toBe('error');
    expect(options.credentials).toBe('omit');
    return response();
  }) as typeof fetch;
test('pinned accelerator accepts only the exact independently verified manifest', async () => {
  expect(
    await indexedPinnedManifest(
      event.id,
      transport(() => Response.json({ manifest: event })),
    ),
  ).toEqual(event);
  await expect(
    indexedPinnedManifest(
      event.id,
      transport(() => Response.json({ manifest: { ...event, content: 'tampered' } })),
    ),
  ).rejects.toThrow('signature');
  const other = finalizeEvent(
    { ...event, content: 'Another signed revision' },
    generateSecretKey(),
  );
  await expect(
    indexedPinnedManifest(
      event.id,
      transport(() => Response.json({ manifest: other })),
    ),
  ).rejects.toThrow('different pinned revision');
  expect(
    await indexedPinnedManifest(
      event.id,
      transport(() => new Response(null, { status: 404 })),
    ),
  ).toBeNull();
});
test('pinned accelerator bounds streamed responses even without a content length', async () => {
  await expect(
    indexedPinnedManifest(
      event.id,
      transport(() => new Response(' '.repeat(70001))),
    ),
  ).rejects.toThrow('too-large');
});
