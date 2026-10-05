import { identityAddress, type SignedEvent, type GallerySearch } from './index';
import { manifestIdentity, legacySnapshotAddress } from './manifest';

/** Display chronology never grants runtime, social, storage or deletion authority. */
export function publicationKey(event: SignedEvent) {
  const identity = manifestIdentity(event);
  return identity ? identityAddress(identity) : (legacySnapshotAddress(event) ?? event.id);
}
export function comparePublications(
  a: { manifest: SignedEvent; firstPublishedAt?: number; revisionId: string },
  b: { manifest: SignedEvent; firstPublishedAt?: number; revisionId: string },
  sort: GallerySearch['sort'],
) {
  const timestamp = (n: typeof a) =>
    sort === 'updated' || sort === 'featured'
      ? n.manifest.created_at
      : Math.min(n.firstPublishedAt ?? n.manifest.created_at, n.manifest.created_at);
  return timestamp(b) - timestamp(a) || a.revisionId.localeCompare(b.revisionId);
}
