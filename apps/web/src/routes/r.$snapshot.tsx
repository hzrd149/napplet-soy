import { PublicDetail } from '@/components/public-detail';
import { nappletHead } from '@/lib/napplet-head';
import { createFileRoute, notFound, Outlet, useMatchRoute } from '@tanstack/react-router';
import { getDiscoveredNapplet } from '@/lib/catalog.functions';
import { DiscoveryState } from '@/components/discovery-state';
import { Detail } from '@/components/detail';
export const Route = createFileRoute('/r/$snapshot')({
  loader: async ({ params }) => {
    if (!/^[a-f0-9]{64}$/.test(params.snapshot)) throw notFound();
    const result = await getDiscoveredNapplet({ data: { type: 'snapshot', id: params.snapshot } });
    if (!result.napplet && !result.discovery) throw notFound();
    return result;
  },
  pendingMs: 200,
  pendingComponent: () => <DiscoveryState poll={false} />,
  head: ({ loaderData }) => {
    const n = loaderData?.napplet;
    return n
      ? nappletHead(
          n,
          `/r/${'provenance' in n ? n.revisionId : n.snapshot.id}`,
          'provenance' in n ? n.revisionId : n.snapshot.id,
        )
      : {
          meta: [
            { title: 'Discovering a napplet — napplet.soy' },
            { name: 'robots', content: 'noindex' },
          ],
        };
  },
  component: Release,
});
function Release() {
  const match = useMatchRoute();
  const { napplet: n, discovery, message } = Route.useLoaderData();
  // Source inspection depends on the signed release, not playable-artifact availability.
  if (
    n &&
    match({
      to: '/r/$snapshot/source',
      params: { snapshot: 'provenance' in n ? n.revisionId : n.snapshot.id },
    })
  )
    return <Outlet />;
  if (
    !n ||
    (discovery &&
      ['queued', 'searching'].includes(discovery) &&
      'availability' in n &&
      n.availability !== 'ready')
  )
    return <DiscoveryState state={discovery ?? 'failed'} message={message} />;
  return 'provenance' in n ? <PublicDetail napplet={n} pinned /> : <Detail napplet={n} pinned />;
}
