import type { Filter } from 'nostr-tools';
import type { ProtocolClient } from './nostr';
import type { SignedEvent } from '../../protocol/src';
import { latestProfile } from '../../protocol/src/profile';
import { validateManifest } from '../../protocol/src/manifest';
import { socialScope, socialView, lastTag } from '../../protocol/src/social';

/** Likes need the viewer's reactions and deletions, not the whole conversation or wallet. */
export async function readLikeState(
  client: ProtocolClient,
  manifest: SignedEvent,
  viewer: string,
  hints: string[] = [],
  signal?: AbortSignal,
) {
  await validateManifest(manifest);
  const scope = socialScope(manifest);
  const filters: Filter[] = [
    { kinds: [7], authors: [viewer], '#e': [manifest.id], limit: 200 },
    ...(scope.address
      ? [{ kinds: [7], authors: [viewer], '#a': [scope.address], limit: 200 }]
      : []),
    { kinds: [5], authors: [viewer], limit: 200 },
  ];
  const found = await client.queryAvailable(filters, hints, signal);
  const events = [...new Map([...client.cached(filters), ...found].map((e) => [e.id, e])).values()]
    .filter(client.allowed)
    .slice(-2000);
  const manifests = new Map([[manifest.id, manifest]]);
  const ids = [...new Set(events.filter((e) => e.kind === 7).map((e) => lastTag(e, 'e') ?? ''))]
    .filter((id) => /^[a-f0-9]{64}$/.test(id) && id !== manifest.id)
    .slice(0, 128);
  if (ids.length) {
    const filters = [{ kinds: [35129, 15129, 5129], ids, limit: 128 }];
    const cached = client.store.getByFilters(filters);
    const missing = ids.filter((id) => !cached.some((e) => e.id === id));
    const releases = missing.length
      ? [
          ...cached,
          ...(await client.queryAvailable([{ ...filters[0], ids: missing }], hints, signal)),
        ]
      : cached;
    for (const event of releases.filter(client.allowed))
      try {
        await validateManifest(event);
        manifests.set(event.id, event);
      } catch {}
  }
  return {
    scope,
    manifest,
    ...socialView(scope, events, manifests),
    lastAction: Math.max(0, ...events.map((e) => e.created_at)),
  };
}

/** Use an already verified profile or the first verified profile received.
 * Slow/empty relays keep refreshing the store without gating the wallet form. */
export function readAvailableProfile(
  client: ProtocolClient,
  pubkey: string,
  hints: string[] = [],
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const filters = [{ kinds: [0], authors: [pubkey], limit: 3 }];
  return new Promise<SignedEvent | undefined>((resolve, reject) => {
    const received = new Map<string, SignedEvent>();
    const current = () =>
      latestProfile([...client.store.getByFilters(filters), ...received.values()], pubkey);
    const accept = () => {
      const event = current();
      // Select the replaceable winner before applying moderation, as full profile reads do.
      if (event && !client.allowed(event)) reject(new Error('This profile is unavailable here.'));
      else if (event) resolve(event);
    };
    accept();
    void client
      .query(filters, hints, signal, (event) => {
        received.set(event.id, event);
        accept();
      })
      .then(() => {
        accept();
        if (!current()) resolve(undefined);
      }, reject);
  });
}
