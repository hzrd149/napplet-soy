import type { SignedEvent } from '../../protocol/src';
import { manifestIcon } from '../../protocol/src/manifest';
import {
  iconSources,
  verifyIconBytes,
  MAX_ICON_BYTES,
  MAX_ICON_PIXELS,
} from '../../protocol/src/icon';
import { downloadBytes } from './bytes';

const cache = new Map<string, { url: string | null; at: number; bytes: number }>();
const pending = new Map<string, Promise<void>>();
export const resolvedIconUrl = (id: string) => cache.get(id)?.url ?? null;

/** Render verified bytes, never the remote icon URL. Failures are presentation-only. */
export async function resolveManifestIcon(event: SignedEvent, local: string[] = []) {
  if (typeof createImageBitmap === 'undefined') return;
  const previous = cache.get(event.id);
  if (previous && (previous.url || Date.now() - previous.at < 60000)) return;
  if (pending.has(event.id)) return pending.get(event.id);
  const task = (async () => {
    const claim = manifestIcon(event);
    const deadline = AbortSignal.timeout(4000);
    let url: string | null = null,
      size = 0;
    if (claim)
      for (const source of iconSources(event)) {
        if (deadline.aborted) break;
        try {
          const bytes = await downloadBytes(source, deadline, MAX_ICON_BYTES, local);
          const header = await verifyIconBytes(bytes, claim);
          deadline.throwIfAborted();
          const blob = new Blob([bytes as BlobPart], { type: claim.mime });
          // Decoding cannot be cancelled. Stop waiting at the shared deadline,
          // and close a bitmap that finishes after its manifest has timed out.
          const decoding = createImageBitmap(blob).then((bitmap) => {
            if (deadline.aborted) {
              bitmap.close();
              deadline.throwIfAborted();
            }
            return bitmap;
          });
          let onAbort: () => void = () => {};
          const aborted = new Promise<never>((_, reject) => {
            onAbort = () => reject(deadline.reason);
            deadline.addEventListener('abort', onAbort, { once: true });
            if (deadline.aborted) onAbort();
          });
          const decoded = await Promise.race([decoding, aborted]).finally(() =>
            deadline.removeEventListener('abort', onAbort),
          );
          try {
            if (
              !decoded.width ||
              !decoded.height ||
              decoded.width * decoded.height > MAX_ICON_PIXELS
            )
              throw new Error('Icon dimensions exceed the presentation budget');
            // JPEG EXIF orientation may transpose dimensions without changing the pixel budget.
            if (!(
              (decoded.width === header.width && decoded.height === header.height) ||
              (decoded.width === header.height && decoded.height === header.width)
            ))
              throw new Error('Decoded icon dimensions disagree with the verified header');
          } finally {
            decoded.close();
          }
          url = URL.createObjectURL(blob);
          size = bytes.length;
          break;
        } catch {
          /* Try another declared origin; never block the playable artifact. */
        }
      }
    cache.set(event.id, { url, at: Date.now(), bytes: size });
    let total = [...cache.values()].reduce((n, v) => n + v.bytes, 0);
    while (cache.size > 128 || total > 32 * 1024 * 1024) {
      const [id, value] = cache.entries().next().value!;
      if (value.url) URL.revokeObjectURL(value.url);
      total -= value.bytes;
      cache.delete(id);
    }
  })().finally(() => pending.delete(event.id));
  pending.set(event.id, task);
  return task;
}
