import { encodeAddress, identityAddress, type SignedEvent } from '../../protocol/src';
import {
  legacySnapshotAddress,
  manifestFormat,
  validateManifest,
} from '../../protocol/src/manifest';
import { nappletAddressSchema } from '../../protocol/src/remix';
function single(event: SignedEvent, key: string) {
  const tags = event.tags.filter((t) => t[0] === key);
  if (tags.length > 1 || (tags.length && !tags[0][1]))
    throw new Error('This release has ambiguous ancestry tags.');
  return tags[0]?.[1] ?? null;
}
function addressLink(address: string) {
  const [kind, pubkey, ...d] = nappletAddressSchema.parse(address).split(':');
  return encodeAddress({ kind: Number(kind) as 35129 | 15129, pubkey, identifier: d.join(':') });
}
async function ownAddress(event: SignedEvent) {
  const release = await validateManifest(event);
  if (release.identity) return identityAddress(release.identity);
  return legacySnapshotAddress(event);
}
export function hasAncestry(event: SignedEvent) {
  return event.tags.some(
    (t) =>
      t[0] === 'A' ||
      t[0] === 'remix-version' ||
      (t[0] === 'a' && (event.kind !== 5129 || manifestFormat(event) === 'standalone')),
  );
}
export type Ancestor = {
  id: string;
  title: string;
  pubkey: string;
  path: string;
  relation: 'current' | 'exact' | 'viewed';
};
export type Genealogy = {
  nodes: Ancestor[];
  gap: string | null;
  origin: { address: string; path: string } | null;
};
/** An ancestry chain is a tree with one declared parent per manifest (NIP-5A). */
export async function buildGenealogy(
  root: SignedEvent,
  find: (reference: string) => Promise<SignedEvent | null>,
  policy: {
    hidden: (event: SignedEvent) => boolean;
    blocked: (type: string, target: string) => boolean;
  } = { hidden: () => false, blocked: () => false },
): Promise<Genealogy | null> {
  const manifestBlocked = policy.hidden,
    blocked = policy.blocked;
  await validateManifest(root);
  if (manifestBlocked(root) || !hasAncestry(root)) return null;
  const tree: Genealogy = { nodes: [], gap: null, origin: null };
  const seen = new Set<string>();
  const visibleEvents: SignedEvent[] = [];
  let event = root,
    relation: Ancestor['relation'] = 'viewed';
  for (let depth = 0; depth < 12; depth++) {
    await validateManifest(event);
    if (manifestBlocked(event)) {
      tree.gap = 'An ancestor is unavailable here.';
      break;
    }
    const own = await ownAddress(event);
    if (seen.has(event.id) || (own && seen.has(own))) {
      tree.gap = 'The declared ancestry contains a cycle.';
      break;
    }
    seen.add(event.id);
    if (own) seen.add(own);
    visibleEvents.push(event);
    tree.nodes.push({
      id: event.id,
      title: (event.tags.find((t) => t[0] === 'title')?.[1] || 'Untitled napplet').slice(0, 160),
      pubkey: event.pubkey,
      path: relation === 'current' && own ? `/n/${addressLink(own)}` : `/r/${event.id}`,
      relation,
    });
    try {
      const a = single(event, 'a'),
        origin = single(event, 'A'),
        revision = single(event, 'remix-version');
      if (origin) {
        const path = `/n/${addressLink(origin)}`;
        if (!tree.origin) tree.origin = { address: origin, path };
      }
      // Only legacy snapshots use a for self-association. Standalone a/A are
      // optional ancestry claims and never an ownership or playback dependency.
      const parent = event.kind === 5129 && manifestFormat(event) === 'legacy' ? null : a;
      if (parent) addressLink(parent);
      if (revision && !/^[a-f0-9]{64}$/.test(revision))
        throw new Error('This release has an invalid parent revision.');
      if (!parent && !revision) {
        if (origin && origin !== own)
          tree.gap =
            'The origin is recorded, but intermediate parents are not recorded in this release.';
        break;
      }
      const next = await find(revision ?? parent!);
      if (!next) {
        tree.gap =
          'A parent could not be retrieved from our configured relays, or is unavailable here.';
        break;
      }
      if (revision && next.id !== revision)
        throw new Error('The parent revision could not be verified.');
      const nextOwn = await ownAddress(next);
      if (parent && nextOwn !== parent)
        throw new Error('The parent revision does not match the declared parent.');
      if (manifestBlocked(next)) {
        tree.gap = 'An ancestor is unavailable here.';
        break;
      }
      event = next;
      relation = revision ? 'exact' : 'current';
      if (depth === 11) tree.gap = 'More ancestry may exist. This view shows up to 12 generations.';
    } catch (error) {
      tree.gap = error instanceof Error ? error.message : 'Ancestry is unavailable.';
      break;
    }
  }
  // Origin is an author-declared pointer, not an invented edge across an unresolved gap.
  const hidden = visibleEvents.findIndex((e) => manifestBlocked(e));
  if (hidden === 0) return null;
  if (hidden > 0) {
    tree.nodes = tree.nodes.slice(0, hidden);
    tree.gap = 'An ancestor is unavailable here.';
  }
  if (
    tree.origin &&
    (seen.has(tree.origin.address) ||
      blocked('address', tree.origin.address) ||
      blocked('pubkey', tree.origin.address.split(':')[1]))
  )
    tree.origin = null;
  return tree;
}
