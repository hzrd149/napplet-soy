import { featuredGallery } from './featured';
import { manifestFeatured } from '../../moderation/src/policy';
import type { GallerySearch } from '../../protocol/src';
import { discoveryFacets, matchesGallery, topicFacets } from '../../protocol/src/topics';
import type { PublicNapplet } from './public-model';
import { catalogStatus, communityEntries } from './public-catalog';
import { comparePublications } from '../../protocol/src/publication-order';

export const GALLERY_PAGE_SIZE = 24;
export function galleryPage(entries: PublicNapplet[], search: GallerySearch) {
  const catalog = entries.filter((n) => search.sort !== 'featured' || manifestFeatured(n.manifest));
  const visible = search.unavailable ? catalog : catalog.filter((n) => n.availability === 'ready');
  const matches = visible
    .filter((n) => matchesGallery(n, search))
    .sort((a, b) => comparePublications(a, b, search.sort));
  const pages = Math.max(1, Math.ceil(matches.length / GALLERY_PAGE_SIZE));
  const page = Math.min(search.page ?? 1, pages);
  return {
    napplets: matches.slice((page - 1) * GALLERY_PAGE_SIZE, page * GALLERY_PAGE_SIZE),
    page,
    pages,
    matches: matches.length,
    total: visible.length,
    topics: topicFacets(visible),
    discovery: discoveryFacets(visible),
    unavailableCount: catalog.filter((n) => n.availability !== 'ready' && matchesGallery(n, search))
      .length,
  };
}
export async function browseGallery(search: GallerySearch) {
  const entries = await communityEntries();
  return {
    ...galleryPage(entries, search),
    featured: await featuredGallery(entries),
    status: await catalogStatus(),
  };
}
