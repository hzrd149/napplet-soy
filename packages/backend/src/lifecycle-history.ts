import { decodeAddress, eventSchema, identityAddress, type SignedEvent } from '../../protocol/src';
import {
  legacySnapshotAddress,
  validateManifest,
  validateRelease,
} from '../../protocol/src/manifest';
import { standalonePresentationKey } from '../../protocol/src/presentation-pairs';
import { indexStore } from './indexed-catalog';
import { manifestKey } from './index-store';

const MAX_HISTORY_BYTES = 2 * 1024 * 1024;

/** Public signed history is an inventory hint, never deletion authorization. */
export async function lifecycleHistoryResponse(request: Request) {
  let address: string, author: string;
  try {
    const reference = new URL(request.url).searchParams.get('reference') ?? '';
    if (reference.length > 4096) throw new Error('Reference too long');
    const identity = decodeAddress(reference);
    address = identityAddress(identity);
    author = identity.pubkey;
  } catch {
    return Response.json({ error: 'Expected a named or root napplet address' }, { status: 400 });
  }
  const store = indexStore();
  if (!store)
    return Response.json(
      { version: 1, address, available: false, complete: true, manifests: [] },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  const candidates: SignedEvent[] = [];
  // The store has separate 10,000-row bounds for current events and history.
  for (const row of store.allRows()) {
    if (row.event.length > 70000) continue;
    try {
      const parsed = eventSchema.safeParse(JSON.parse(row.event));
      if (!parsed.success || parsed.data.pubkey !== author) continue;
      const event = parsed.data;
      if (manifestKey(event) === address || event.kind === 5129) candidates.push(event);
    } catch {
      /* Malformed index rows cannot become lifecycle targets. */
    }
  }
  candidates.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
  let complete = true,
    size = 0;
  const manifests = new Map<string, SignedEvent>();
  const add = (event: SignedEvent) => {
    if (manifests.has(event.id)) return true;
    const bytes = new TextEncoder().encode(JSON.stringify(event)).byteLength;
    if (manifests.size >= 256 || size + bytes > MAX_HISTORY_BYTES - 4096) {
      complete = false;
      return false;
    }
    manifests.set(event.id, event);
    size += bytes;
    return true;
  };
  const presentations = new Map<string, SignedEvent>();
  const named = candidates.filter((event) => event.kind !== 5129 && manifestKey(event) === address);
  if (named.length > 128) complete = false;
  for (const event of named.slice(0, 128)) {
    try {
      await validateManifest(event);
      if (!add(event)) break;
      const presentation = standalonePresentationKey(event);
      if (presentation) presentations.set(presentation, event);
    } catch {
      /* Return verified manifests only. */
    }
  }
  let pairs = 0;
  for (const event of candidates) {
    if (event.kind !== 5129) continue;
    const presentation = standalonePresentationKey(event);
    const current = presentation && presentations.get(presentation);
    if (!current && legacySnapshotAddress(event) !== address) continue;
    if (pairs >= 128) {
      complete = false;
      break;
    }
    try {
      if (current) await validateRelease(current, event);
      else await validateManifest(event);
      if (!add(event)) break;
      pairs++;
    } catch {
      /* Near matches and invalid signatures are not publication pairs. */
    }
  }
  return Response.json(
    { version: 1, address, available: true, complete, manifests: [...manifests.values()] },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
