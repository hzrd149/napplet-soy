import { browseProtocol, lookupProtocol, directSource, featuredProtocol } from './protocol-catalog';
import { sourceBrowser } from '../../../../packages/backend/src/source';
import { sourceInput } from '../../../../packages/client/src/source';
import { createServerFn, createIsomorphicFn, createServerOnlyFn } from '@tanstack/react-start';
import { z } from 'zod';
import { gallerySearchSchema } from '../../../../packages/protocol/src';
import { gallery, resolveNapplet } from '../../../../packages/backend/src/catalog';
import {
  catalogStatus,
  resolvePublicNapplet,
} from '../../../../packages/backend/src/public-catalog';
import { siteOrigin } from '../../../../packages/backend/src/site-origin';
import { indexedLookup, indexStore } from '../../../../packages/backend/src/indexed-catalog';
import { newerManifest } from '../../../../packages/backend/src/index-store';

import { communityStore } from '../../../../packages/community/src/store';
import { visibleAlias } from '../../../../packages/backend/src/names-response';
import { DiscoveryQueue } from '../../../../packages/backend/src/discovery-queue';
import { discoveryTarget } from '../../../../packages/protocol/src/discovery';
import { browseGallery } from '../../../../packages/backend/src/gallery';

const lookupSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('named'), creator: z.string().max(40), slug: z.string().max(64) }),
  z.object({ type: z.literal('address'), naddr: z.string().max(4096) }),
  z.object({ type: z.literal('snapshot'), id: z.string().regex(/^[a-f0-9]{64}$/) }),
]);
type Options<T> = { data: T };
const getGallerySSR = createServerOnlyFn(({ data }: Options<z.input<typeof gallerySearchSchema>>) =>
  gallery(gallerySearchSchema.parse(data)),
);
const getBrowseGallerySSR = createServerOnlyFn(
  ({ data }: Options<z.input<typeof gallerySearchSchema>>) =>
    browseGallery(gallerySearchSchema.parse(data)),
);
async function lookupNapplet(data: z.infer<typeof lookupSchema>) {
  if (data.type === 'named' && data.creator !== '@space-lab') {
    if (!process.env.SPACE_COMMUNITY_DIR) return null;
    const alias = communityStore().lookup(data.creator.replace(/^@/, ''), data.slug);
    if (!alias || !data.creator.startsWith('@') || !visibleAlias(alias)) return null;
    data = { type: 'address', naddr: alias.naddr };
  }
  let napplet = (await resolveNapplet(data)) as
    Awaited<ReturnType<typeof resolveNapplet>> | Awaited<ReturnType<typeof resolvePublicNapplet>>;
  const remote = await resolvePublicNapplet(data);
  if (
    !napplet ||
    ('current' in napplet && remote && newerManifest(remote.manifest, napplet.current))
  )
    napplet = remote;
  // Existing curated aliases remain attached to their Nostr identity after an update.
  if (data.type === 'named' && napplet && 'current' in napplet) {
    const indexed = await indexedLookup({ type: 'address', naddr: napplet.naddr });
    const remote = await resolvePublicNapplet({ type: 'address', naddr: napplet.naddr });
    if (
      indexed.known ||
      indexStore()?.removed(napplet.current) ||
      (remote && newerManifest(remote.manifest, napplet.current))
    )
      if (!remote || remote.revisionId !== napplet.current.id) napplet = remote;
  }
  return napplet
    ? {
        ...napplet,
        relays: 'relays' in napplet ? napplet.relays : (await catalogStatus()).relays,
        siteOrigin: siteOrigin(),
      }
    : null;
}
const getNappletSSR = createServerOnlyFn(({ data }: Options<z.input<typeof lookupSchema>>) =>
  lookupNapplet(lookupSchema.parse(data)),
);
const getDiscoveredNappletSSR = createServerOnlyFn(
  async (options: Options<z.input<typeof lookupSchema>>) => {
    const data = lookupSchema.parse(options.data);
    let napplet = await lookupNapplet(data);
    const result = (state: string | null, message?: string) => ({
      napplet,
      discovery: state,
      message,
    });
    if (data.type === 'named') return result(null);
    if (!process.env.SPACE_INDEX_DIR) {
      if (napplet) return result(null);
      try {
        discoveryTarget(data.type === 'address' ? data.naddr : data.id);
        return result('searching');
      } catch {
        return result(null);
      }
    }
    let target;
    try {
      target = discoveryTarget(data.type === 'address' ? data.naddr : data.id);
    } catch {
      return result(null);
    }
    const queue = new DiscoveryQueue(process.env.SPACE_INDEX_DIR);
    try {
      const previous = queue.get(target.key);
      if (napplet && (!previous || !['queued', 'searching'].includes(previous.state)))
        return result(null);
      // A known deletion or invalid replacement is not a discovery miss.
      const known =
        target.type === 'snapshot'
          ? indexStore()?.revision(target.id)
          : indexStore()?.row(target.key);
      if (!napplet && known) return result(null);
      let job = previous;
      if (!napplet)
        try {
          job = queue.request(data.type === 'address' ? data.naddr : data.id);
        } catch (error) {
          return result(
            'failed',
            error instanceof Error ? error.message : 'Discovery is unavailable',
          );
        }
      const deadline = Date.now() + 5500;
      while (job && ['queued', 'searching'].includes(job.state) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        napplet = await lookupNapplet(data);
        job = queue.get(target.key);
        if (
          napplet &&
          'availability' in napplet &&
          napplet.availability === 'ready' &&
          napplet.preview
        )
          break;
      }
      return result(job?.state ?? 'failed');
    } finally {
      queue.close();
    }
  },
);
const getSourceSSR = createServerOnlyFn(({ data }: Options<z.input<typeof sourceInput>>) =>
  sourceBrowser.view(sourceInput.parse(data)),
);
const getReadmeSSR = createServerOnlyFn(({ data }: Options<string>) =>
  sourceBrowser.readme(
    z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(data),
  ),
);

export const getCreatorNames = createServerFn({ method: 'GET' })
  .validator(z.string().regex(/^@[a-z0-9-]{1,32}$/))
  .handler(async ({ data }) => {
    if (data === '@space-lab')
      return (await gallery({ q: '', tag: '', sort: 'new' })).map((n) => ({
        handle: 'space-lab',
        slug: n.slug,
        pubkey: n.pubkey,
        naddr: n.naddr,
      }));
    return process.env.SPACE_COMMUNITY_DIR
      ? communityStore().creator(data.slice(1)).filter(visibleAlias)
      : [];
  });

const getFeaturedGallerySSR = createServerOnlyFn(async () => {
  const { featuredGallery } = await import('../../../../packages/backend/src/featured');
  return featuredGallery();
});

export const getBrowseGallery = createIsomorphicFn()
  .server(getBrowseGallerySSR)
  .client(async (options: Parameters<typeof getBrowseGallerySSR>[0]) =>
    browseProtocol(gallerySearchSchema.parse(options.data)),
  );
export const getNapplet = createIsomorphicFn()
  .server(getNappletSSR)
  .client(async (options: Parameters<typeof getNappletSSR>[0]) => {
    const data = lookupSchema.parse(options.data);
    // Readable names belong to this site. Resolve only that mapping on the server.
    if (data.type === 'named') {
      const aliases = await getCreatorNames({ data: data.creator });
      const alias = aliases.find((a) => a.slug === data.slug);
      return alias ? lookupProtocol({ type: 'address', naddr: alias.naddr }) : null;
    }
    return lookupProtocol(data);
  });
export const getDiscoveredNapplet = createIsomorphicFn()
  .server(getDiscoveredNappletSSR)
  .client(async (options: Parameters<typeof getDiscoveredNappletSSR>[0]) => {
    const napplet = await getNapplet(options);
    return {
      napplet,
      discovery: napplet ? null : 'missing',
      message: undefined as string | undefined,
    };
  });
export const getSource = createIsomorphicFn()
  .server(getSourceSSR)
  .client(async (options: Parameters<typeof getSourceSSR>[0]) =>
    directSource.view(sourceInput.parse(options.data)),
  );
export const getReadme = createIsomorphicFn()
  .server(getReadmeSSR)
  .client(async (options: Parameters<typeof getReadmeSSR>[0]) => directSource.readme(options.data));

export const getFeaturedGallery = createIsomorphicFn()
  .server(getFeaturedGallerySSR)
  .client(featuredProtocol);

export const getGallery = createIsomorphicFn()
  .server(getGallerySSR)
  .client(async () => {
    const aliases = await getCreatorNames({ data: '@space-lab' });
    const values = await Promise.all(
      aliases.map((a) => lookupProtocol({ type: 'address', naddr: a.naddr })),
    );
    return values.filter((n): n is NonNullable<typeof n> => !!n);
  });
