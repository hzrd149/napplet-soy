import type { IndexRow } from './index-store';
import { indexStore } from './indexed-catalog';
import { readUnmoderatedCatalog } from './public-catalog';
import { verifiedEvent } from '../../protocol/src';
import { profileEvent, profileView } from '../../protocol/src/profile';
import { normalizeTarget } from '../../moderation/src/targets';
import type { AdminCatalog, AdminEntry } from '../../moderation/src/admin-model';
import { communityStore } from '../../community/src/store';

/** Called only after NIP-98 authorization; blocked entries must remain manageable. */
export async function adminCatalog(extraKeys: string[]): Promise<AdminCatalog> {
  const entries = new Map<string, AdminEntry>();
  let rows: IndexRow[] = [];
  try {
    rows = indexStore()?.administrationRows() ?? [];
  } catch {
    /* Local search must not block policy management. */
  }
  const cached = (await readUnmoderatedCatalog())?.entries ?? [];
  for (const raw of [
    ...rows.map((r) => r.event),
    ...cached.map((n) => JSON.stringify(n.manifest)),
  ]) {
    if (entries.size >= 2000) break;
    try {
      const event = verifiedEvent(JSON.parse(raw));
      if (entries.has(event.id)) continue;
      const tag = (name: string) => event.tags.find((t) => t[0] === name)?.[1];
      const address =
        event.kind === 35129 || event.kind === 15129
          ? normalizeTarget(
              'address',
              `${event.kind}:${event.pubkey}:${event.kind === 15129 ? '' : (tag('d') ?? '')}`,
            )
          : null;
      const hashes = event.tags
        .flatMap((t) => {
          if (t[0] === 'x' && t.length === 2 && /^[a-f0-9]{64}$/.test(t[1]))
            return [{ hash: t[1], label: '/index.html' }];
          if (t[0] === 'path' && /^[a-f0-9]{64}$/.test(t[2] ?? ''))
            return [{ hash: t[2], label: (t[1] || 'Artifact').slice(0, 160) }];
          return [];
        })
        .slice(0, 32);
      entries.set(event.id, {
        id: event.id,
        pubkey: event.pubkey,
        address,
        title: (tag('title') || tag('d') || 'Untitled napplet').slice(0, 160),
        hashes,
      });
    } catch {
      /* A corrupt local row cannot break moderation of other identifiers. */
    }
  }
  const keys = [...new Set([...extraKeys, ...[...entries.values()].map((e) => e.pubkey)])].slice(
    0,
    2200,
  );
  const profiles: AdminCatalog['profiles'] = [];
  try {
    if (process.env.SPACE_COMMUNITY_DIR) {
      const store = communityStore();
      for (const pubkey of keys) {
        try {
          const raw = store.profile(pubkey);
          if (raw)
            profiles.push({ pubkey, name: profileView(pubkey, profileEvent(raw, pubkey)).name });
        } catch {
          /* Names are optional; the public key always remains visible. */
        }
      }
    }
  } catch {
    /* A profile cache failure must not disable administration. */
  }
  return { entries: [...entries.values()], profiles, limit: 2000 };
}
