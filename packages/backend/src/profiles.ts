import { isDeepStrictEqual } from 'node:util';
import { CommunityError, CommunityStore, communityStore } from '../../community/src/store';
import {
  profileEvent,
  profileFields,
  profileObject,
  profilePubkey,
  profileView,
  type ProfileView,
} from '../../protocol/src/profile';
import type { SignedEvent } from '../../protocol/src';
import { blocked } from '../../moderation/src/policy';
import { socialRelay, type SocialRelay } from './social-relay';
import { catalogStatus, communityEntries } from './public-catalog';
import { manifestBlocked } from '../../moderation/src/policy';
import { boundedJson, communityBudget, communityFailure, communityHeaders } from './community-http';
import { siteOrigin } from './site-origin';

export async function profileRelays() {
  const status = await catalogStatus();
  return [
    ...new Set([
      ...(process.env.SPACE_INDEX_RELAYS ?? '').split(',').filter(Boolean),
      ...(status.index.relays ?? []),
      ...status.relays,
    ]),
  ].slice(0, 8);
}
export function visibleProfile(pubkey: string) {
  if (blocked('pubkey', pubkey)) throw new CommunityError('This profile is unavailable here.', 404);
}
export class ProfileService {
  private fresh = new Map<string, number>();
  private reading = new Map<string, Promise<void>>();
  private writing = new Set<string>();
  private writes = new Map<string, number>();
  constructor(
    readonly store: CommunityStore,
    readonly relay: SocialRelay = socialRelay,
  ) {}
  ingest(inputs: unknown[]) {
    for (const input of inputs)
      try {
        const event = profileEvent(input);
        // Cache the replaceable winner even if hidden; moderation must not revive older metadata.
        this.store.putProfile(event);
      } catch {}
  }
  event(pubkey: string) {
    visibleProfile(pubkey);
    const event = this.store.profile(pubkey);
    if (event && blocked('event', event.id))
      throw new CommunityError('This profile is unavailable here.', 404);
    return event;
  }
  async refresh(pubkeys: string[], relays: string[], force = false) {
    const keys = [...new Set(pubkeys)].filter((p) => !blocked('pubkey', p));
    const waiting = keys.map((p) => this.reading.get(p)).filter((p) => !!p);
    if (waiting.length) await Promise.all(waiting);
    const needed = keys.filter((p) => force || (this.fresh.get(p) ?? 0) < Date.now() - 60000);
    if (!needed.length) return;
    if (needed.length > 32 || this.reading.size + needed.length > 128)
      throw new CommunityError('Profile lookups are busy. Try again shortly.', 429);
    const task = (async () => {
      const events = await this.relay.query(
        relays,
        needed.map((pubkey) => ({ kinds: [0], authors: [pubkey], limit: 1 })),
      );
      this.ingest(events.filter((e) => needed.includes(e.pubkey)));
      for (const pubkey of needed) this.fresh.set(pubkey, Date.now());
      while (this.fresh.size > 2048) this.fresh.delete(this.fresh.keys().next().value!);
    })();
    for (const pubkey of needed) this.reading.set(pubkey, task);
    try {
      await task;
    } finally {
      for (const pubkey of needed) this.reading.delete(pubkey);
    }
  }
  async read(pubkeys: string[], relays: string[]) {
    let warning: string | null = null;
    try {
      await this.refresh(pubkeys, relays);
    } catch {
      warning =
        'Could not refresh profiles from the configured relays. Showing cached information where available.';
    }
    const profiles: ProfileView[] = [];
    for (const pubkey of pubkeys)
      try {
        profiles.push(profileView(pubkey, this.event(pubkey)));
      } catch {}
    return { profiles, warning };
  }
  async editBase(pubkey: string, relays: string[]) {
    await this.refresh([pubkey], relays, true);
    const event = this.event(pubkey);
    if (!profileObject(event))
      throw new CommunityError(
        'The current profile contains invalid JSON. Repair it in another client before editing here.',
        409,
      );
    return { event, relays };
  }
  async write(pubkey: string, input: unknown, relays: string[]) {
    const body = input as { event?: unknown; base?: unknown } | null;
    let event: SignedEvent;
    try {
      event = profileEvent(body?.event, pubkey);
    } catch {
      throw new CommunityError('Invalid signed profile.', 401);
    }
    if (
      body?.base !== null &&
      (typeof body?.base !== 'string' || !/^[a-f0-9]{64}$/.test(body.base))
    )
      throw new CommunityError('Missing profile edit base.');
    const content = profileObject(event);
    if (!content || blocked('event', event.id))
      throw new CommunityError('This profile cannot be published here.', 403);
    visibleProfile(pubkey);
    if (this.writing.has(pubkey))
      throw new CommunityError('An update is already in progress. Try again.', 409);
    this.writing.add(pubkey);
    try {
      await this.refresh([pubkey], relays, true);
      const previous = this.event(pubkey);
      if (previous?.id !== event.id) {
        if ((previous?.id ?? null) !== body.base)
          throw new CommunityError(
            'Your profile changed in another client. Reload the profile before editing again.',
            409,
          );
        const original = profileObject(previous);
        if (!original) throw new CommunityError('The current profile contains invalid JSON.', 409);
        const now = Math.floor(Date.now() / 1000);
        if (
          event.created_at < now - 120 ||
          event.created_at > now + 30 ||
          (previous && event.created_at <= previous.created_at)
        )
          throw new CommunityError(
            'The update must be recent and newer than the current profile. Reload and try again.',
            409,
          );
        if (!isDeepStrictEqual(event.tags, previous?.tags ?? []))
          throw new CommunityError('Existing profile tags must be preserved.');
        const editable = new Set(Object.keys(profileFields.shape));
        for (const key of new Set([...Object.keys(original), ...Object.keys(content)])) {
          if (isDeepStrictEqual(original[key], content[key])) continue;
          if (!editable.has(key))
            throw new CommunityError('Unrelated profile fields must be preserved.');
          const field = profileFields.shape[key as keyof typeof profileFields.shape];
          if (!field.safeParse(content[key] ?? '').success)
            throw new CommunityError(`Invalid profile field: ${key}.`);
        }
        if ((this.writes.get(pubkey) ?? 0) > Date.now() - 10000)
          throw new CommunityError('Please wait a few seconds before another profile update.', 429);
      }
      const accepted = await this.relay.publish(relays, event);
      if (!accepted.length)
        throw new CommunityError(
          'No relay acknowledged this event. Retry sends the same signed event.',
          502,
        );
      this.ingest([event]);
      this.writes.set(pubkey, Date.now());
      while (this.writes.size > 2048) this.writes.delete(this.writes.keys().next().value!);
      return { profile: profileView(pubkey, this.event(pubkey)), event, accepted };
    } finally {
      this.writing.delete(pubkey);
    }
  }
}
let cached: ProfileService | undefined;
export function profileService() {
  const store = communityStore();
  if (cached?.store !== store) cached = new ProfileService(store);
  return cached;
}
export async function profilePage(input: { pubkey: string; page: number; all: boolean }) {
  const pubkey = profilePubkey(input.pubkey);
  visibleProfile(pubkey);
  const relays = await profileRelays();
  const service = process.env.SPACE_COMMUNITY_DIR ? profileService() : null;
  const result = service
    ? await service.read([pubkey], relays)
    : { profiles: [profileView(pubkey, null)], warning: 'Profile services are not configured.' };
  const profile = result.profiles[0];
  if (!profile) throw new CommunityError('This profile is unavailable here.', 404);
  const entries = (await communityEntries()).filter(
    (n) => n.pubkey === pubkey && !manifestBlocked(n.manifest),
  );
  const shown = entries
    .filter((n) => input.all || n.availability === 'ready')
    .sort(
      (a, b) =>
        b.manifest.created_at - a.manifest.created_at || a.revisionId.localeCompare(b.revisionId),
    );
  const pages = Math.max(1, Math.ceil(shown.length / 24));
  const page = Math.min(input.page, pages);
  return {
    profile,
    warning: result.warning,
    relays,
    entries: shown.slice((page - 1) * 24, page * 24),
    total: shown.length,
    hidden: entries.length - shown.length,
    page,
    pages,
    all: input.all,
    siteOrigin: siteOrigin(),
  };
}
export async function profilesResponse(request: Request, key?: string) {
  try {
    communityBudget();
    const params = new URL(request.url).searchParams;
    if ((key && key.length > 100) || (params.get('keys') ?? '').length > 3200)
      throw new CommunityError('Profile lookup is too large.');
    const decode = (value: string) => {
      try {
        return profilePubkey(value);
      } catch {
        throw new CommunityError('Use a Nostr public key (npub or hexadecimal).');
      }
    };
    const relays = await profileRelays(),
      service = profileService();
    if (key) {
      const pubkey = decode(key);
      visibleProfile(pubkey);
      if (request.method === 'POST') {
        const { value } = await boundedJson(request, 20000);
        return Response.json(await service.write(pubkey, value, relays), {
          headers: communityHeaders,
        });
      }
      if (params.get('edit') === '1')
        return Response.json(await service.editBase(pubkey, relays), { headers: communityHeaders });
    }
    const keys = [
      ...new Set(key ? [decode(key)] : (params.get('keys') ?? '').split(',').map(decode)),
    ];
    if (!keys.length || keys.length > 32) throw new CommunityError('Request 1–32 profiles.');
    return Response.json(await service.read(keys, relays), { headers: communityHeaders });
  } catch (error) {
    return communityFailure(error);
  }
}
