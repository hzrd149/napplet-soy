import {
  boundedBytes,
  nappletKey,
  parseReceipt,
  type LifecycleReceipt,
} from '../../../../packages/lifecycle/src';
import { encodeAddress, eventSchema, type SignedEvent } from '../../../../packages/protocol/src';
import { validateManifest } from '../../../../packages/protocol/src/manifest';
import { z } from 'zod';

const historySchema = z.object({
  version: z.literal(1),
  address: z.string().max(4096),
  available: z.boolean(),
  complete: z.boolean(),
  manifests: z.array(eventSchema).max(256),
});
export async function retainedLifecycleHistory(
  manifest: SignedEvent,
  request: typeof fetch = fetch,
) {
  const key = nappletKey(manifest);
  const address = /^(35129|15129):([a-f0-9]{64}):(.*)$/.exec(key);
  if (!address) return { manifests: [] as SignedEvent[], complete: true, warnings: [] as string[] };
  try {
    const reference = encodeAddress({
      kind: Number(address[1]) as 35129 | 15129,
      pubkey: address[2],
      identifier: address[3],
    });
    const response = await request(
      `/api/lifecycle-history?reference=${encodeURIComponent(reference)}`,
      {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) throw new Error(`History service returned HTTP ${response.status}`);
    const history = historySchema.parse(
      JSON.parse(new TextDecoder().decode(await boundedBytes(response, 2 * 1024 * 1024))),
    );
    if (history.address !== key)
      throw new Error('History service returned another napplet address');
    for (const event of history.manifests) {
      await validateManifest(event);
      if (event.pubkey !== manifest.pubkey || (event.kind !== 5129 && nappletKey(event) !== key))
        throw new Error('History service returned another publication');
    }
    return {
      manifests: history.manifests,
      complete: history.complete,
      warnings: [
        history.available
          ? history.complete
            ? 'History includes revisions retained by this index. Releases never observed here may still exist elsewhere.'
            : 'Retained history exceeded the 128-revision, 128-snapshot or 2 MiB limit. Unknown releases and hosted files are retained.'
          : 'This site has no retained publication history. Only relay and saved releases were inspected.',
      ],
    };
  } catch (error) {
    return {
      manifests: [] as SignedEvent[],
      complete: false,
      warnings: [
        `Retained publication history could not be checked: ${(error instanceof Error ? error.message : 'Unavailable').slice(0, 1000)}. Hosted files are retained; refresh the inventory to retry.`,
      ],
    };
  }
}
const prefix = 'napplet:lifecycle:';
export function savedLifecycles(pubkey: string) {
  const raw = localStorage.getItem(prefix + pubkey);
  if (!raw) return [] as LifecycleReceipt[];
  const values = JSON.parse(raw);
  if (!Array.isArray(values) || values.length > 100)
    throw new Error(
      'Invalid saved lifecycle records. Export a backup before clearing this browser’s data.',
    );
  return values.map(parseReceipt).filter((r) => r.plan.author === pubkey);
}
export function saveLifecycle(receipt: LifecycleReceipt) {
  const values = savedLifecycles(receipt.plan.author).filter(
    (r) => r.plan.key !== receipt.plan.key,
  );
  values.unshift(parseReceipt(receipt));
  // Never evict an unfinished operation or an author's recovery record silently.
  if (values.length > 100)
    throw new Error(
      'This browser has 100 lifecycle records. Export and preserve them before clearing any records.',
    );
  localStorage.setItem(prefix + receipt.plan.author, JSON.stringify(values));
  window.dispatchEvent(new Event('napplet-lifecycle'));
}
