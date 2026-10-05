import { validatedVideo } from '../../protocol/src/preview-video';
import { blocked, manifestBlocked } from '../../moderation/src/policy';
import { resolve } from 'node:path';
import {
  publicCacheSchema,
  PUBLIC_CACHE_TTL,
  publicNapplet,
  type PublicCache,
} from './public-model';
import { decodeAddress, eventSchema, identityAddress, type SignedEvent } from '../../protocol/src';
import type { Lookup } from './catalog';
import { missingDomains } from '../../runtime/src/capabilities';
import { validatedPreview } from '../../protocol/src/preview';
import { indexedEntries, indexedLookup, indexStore, indexHealth } from './indexed-catalog';
import { manifestKey, newerManifest } from './index-store';
import { legacySnapshotAddress, validateRelease } from '../../protocol/src/manifest';
import { standalonePresentationKey } from '../../protocol/src/presentation-pairs';

// Set by the dev launcher only. No request, hostname, or URL parameter can enable this mode.
export function publicDirectory() {
  return process.env.SPACE_PUBLICDEV === '1' && process.env.SPACE_PUBLICDEV_DIR
    ? resolve(process.env.SPACE_PUBLICDEV_DIR)
    : null;
}
let memo: { directory: string; modified: number; size: number; cache: PublicCache } | undefined;
export async function readUnmoderatedCatalog() {
  const directory = publicDirectory();
  if (!directory) return null;
  try {
    const file = Bun.file(resolve(directory, 'catalog.json'));
    if (file.size > 16 * 1024 * 1024) return null;
    const modified = file.lastModified;
    if (memo?.directory === directory && memo.modified === modified && memo.size === file.size)
      return memo.cache;
    const cache = publicCacheSchema.parse(await file.json());
    cache.entries = await Promise.all(
      cache.entries.map(async (entry) => {
        const derived = await publicNapplet(entry.manifest, cache.relays);
        if (derived.artifactHash !== entry.artifactHash || derived.revisionId !== entry.revisionId)
          throw new Error('Corrupt public catalog');
        return {
          ...derived,
          metadata: entry.metadata,
          bytes: entry.bytes,
          video: validatedVideo(derived.manifest, entry.video),
          preview: validatedPreview(derived.manifest, entry.preview),
          availability: missingDomains(derived.domains).length
            ? ('host-required' as const)
            : entry.availability === 'host-required'
              ? ('unavailable' as const)
              : entry.availability,
        };
      }),
    );
    memo = { directory, modified, size: file.size, cache };
    return cache;
  } catch {
    return null;
  }
}
export async function readPublicCatalog() {
  const cache = await readUnmoderatedCatalog();
  return cache
    ? { ...cache, entries: cache.entries.filter((n) => !manifestBlocked(n.manifest)) }
    : null;
}
export async function resolvePublicNapplet(input: Lookup) {
  const indexed = await indexedLookup(input);
  const entries = (await readPublicCatalog())?.entries ?? [];
  if (input.type === 'named') return null;
  if (input.type === 'snapshot')
    return indexed.known
      ? indexed.entry
      : (entries.find((n) => n.revisionId === input.id && !indexStore()?.removed(n.manifest)) ??
          null);
  try {
    const address = identityAddress(decodeAddress(input.naddr));
    const cached = entries.find(
      (n) => n.naddr && identityAddress(decodeAddress(n.naddr)) === address,
    );
    if (cached && indexStore()?.removed(cached.manifest)) return indexed.entry;
    const row = indexStore()?.row(address);
    return cached && (!row || newerManifest(cached.manifest, JSON.parse(row.event)))
      ? cached
      : indexed.entry;
  } catch {
    return null;
  }
}
/** Merge relay collections by Nostr identity; provenance never defines a category. */
export async function communityEntries() {
  const candidates = [...((await readPublicCatalog())?.entries ?? []), ...(await indexedEntries())];
  const winners = new Map<string, (typeof candidates)[number]>();
  for (const entry of candidates) {
    const key = manifestKey(entry.manifest);
    const previous = winners.get(key);
    if (
      !previous ||
      newerManifest(entry.manifest, previous.manifest) ||
      entry.revisionId === previous.revisionId
    )
      winners.set(key, entry);
  }
  // Invalid newest packages are tombstones too; a cached older package cannot resurrect them.
  for (const [key, candidate] of winners) {
    const row = indexStore()?.row(key);
    if (
      indexStore()?.removed(candidate.manifest) ||
      (row && newerManifest(JSON.parse(row.event), candidate.manifest))
    )
      winners.delete(key);
  }
  const snapshotPresentations = new Map<string, SignedEvent[]>();
  for (const entry of winners.values()) {
    const key = standalonePresentationKey(entry.manifest);
    if (entry.manifest.kind === 5129 && key)
      snapshotPresentations.set(key, [...(snapshotPresentations.get(key) ?? []), entry.manifest]);
  }
  const paired = new Set<string>();
  // Retained named revisions can coalesce old publication pairs as well. Only
  // matching candidates need signature/schema verification; no artifact fetch.
  const pairCandidates = [
    ...[...winners.values()].map((entry) => entry.manifest),
    ...(indexStore()?.allRows() ?? []).flatMap((row) => {
      try {
        const event = eventSchema.safeParse(JSON.parse(row.event));
        return event.success ? [event.data] : [];
      } catch {
        return [];
      }
    }),
  ];
  for (const candidate of pairCandidates) {
    if (candidate.kind === 5129 || manifestBlocked(candidate) || indexStore()?.removed(candidate))
      continue;
    const key = standalonePresentationKey(candidate);
    for (const snapshot of key ? (snapshotPresentations.get(key) ?? []) : []) {
      if (paired.has(snapshot.id)) continue;
      try {
        await validateRelease(candidate, snapshot);
        paired.add(snapshot.id);
      } catch {
        /* A matching unverified projection never hides a signed snapshot. */
      }
    }
  }
  return [...winners.values()].filter((entry) => {
    if (entry.manifest.kind !== 5129) return true;
    if (paired.has(entry.revisionId)) return false;
    const address = legacySnapshotAddress(entry.manifest);
    // Keep snapshot URLs, but show one gallery card when its own author's current exists.
    return !address || address.split(':')[1] !== entry.pubkey || !winners.has(address);
  });
}
export async function publicArtifact(hash: string) {
  const directory = publicDirectory();
  if (!directory || !/^[a-f0-9]{64}$/.test(hash) || blocked('hash', hash)) return null;
  const entry = (await readPublicCatalog())?.entries.find(
    (n) =>
      n.artifactHash === hash && n.availability === 'ready' && !missingDomains(n.domains).length,
  );
  if (!entry) return null;
  const file = Bun.file(resolve(directory, 'artifacts', `${hash}.html`));
  return (await file.exists()) ? file : null;
}
export async function catalogStatus() {
  const cache = await readPublicCatalog();
  return {
    index: indexHealth(),
    publicdev: !!publicDirectory(),
    publicCount: cache?.entries.length ?? 0,
    fetchedAt: cache?.fetchedAt ?? null,
    stale: !!cache && Date.now() - cache.fetchedAt > PUBLIC_CACHE_TTL,
    relays: cache?.relays ?? [],
    rejected: cache?.rejected ?? 0,
  };
}
