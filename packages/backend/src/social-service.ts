import type { Filter } from 'nostr-tools';
import { ProfileService } from './profiles';
import { profileView } from '../../protocol/src/profile';
import { encodeAddress, verifiedEvent, type SignedEvent } from '../../protocol/src';
import { validateManifest } from '../../protocol/src/manifest';
import {
  socialScope,
  oneTag,
  lastTag,
  validComment,
  validLike,
  validCommentLike,
  socialView,
  type SocialScope,
} from '../../protocol/src/social';
import { communityStore, CommunityError, type CommunityStore } from '../../community/src/store';
import { blocked, manifestBlocked } from '../../moderation/src/policy';
import { manifestResponse } from './manifest-response';
import { catalogStatus } from './public-catalog';
import { socialRelay, type SocialRelay } from './social-relay';
import { boundedJson, communityBudget, communityFailure, communityHeaders } from './community-http';
export type SocialContext = { scope: SocialScope; manifest: SignedEvent; relays: string[] };
export function allowedSocial(e: SignedEvent) {
  return !blocked('event', e.id) && !blocked('pubkey', e.pubkey);
}
export async function socialContext(reference: string): Promise<SocialContext> {
  const response = await manifestResponse(
    new Request('http://internal/api/manifest?reference=' + encodeURIComponent(reference)),
  );
  if (!response.ok) throw new CommunityError('Napplet not found.', 404);
  let { manifest } = (await response.json()) as { manifest: SignedEvent };
  await validateManifest(manifest);
  let scope = socialScope(manifest);
  if (manifest.kind === 5129 && scope.address) {
    const [kind, pubkey, ...identifier] = scope.address.split(':');
    const naddr = encodeAddress({
      kind: Number(kind) as 35129 | 15129,
      pubkey,
      identifier: identifier.join(':'),
    });
    const current = await manifestResponse(
      new Request('http://internal/api/manifest?reference=' + encodeURIComponent(naddr)),
    );
    if (current.ok) {
      const candidate = (await current.json()).manifest as SignedEvent;
      if (socialScope(candidate).key === scope.key) manifest = candidate;
    }
  }
  scope = socialScope(manifest);
  if (manifestBlocked(manifest) || blocked('address', scope.key))
    throw new CommunityError('This creation is blocked here.', 403);
  const status = await catalogStatus();
  const relays = [
    ...new Set([
      ...(process.env.SPACE_INDEX_RELAYS ?? '').split(',').filter(Boolean),
      ...(status.index.relays ?? []),
      ...status.relays,
    ]),
  ].slice(0, 6);
  return { scope, manifest, relays };
}
export class SocialService {
  private refreshes = new Map<string, { at: number; pending?: Promise<void> }>();
  constructor(
    readonly store: CommunityStore,
    readonly relay: SocialRelay = socialRelay,
  ) {}
  async refresh(context: SocialContext) {
    const { scope, manifest, relays } = context,
      previous = this.refreshes.get(scope.key);
    if (previous?.pending) return previous.pending;
    if (previous && Date.now() - previous.at < 30000) return;
    if (this.refreshes.size >= 256) this.refreshes.delete(this.refreshes.keys().next().value!);
    const state: { at: number; pending?: Promise<void> } = { at: Date.now() };
    this.refreshes.set(scope.key, state);
    state.pending = (async () => {
      const filters: Filter[] = scope.address
        ? [
            { kinds: [1111], '#A': [scope.address], limit: 150 },
            { kinds: [7, 9735], '#a': [scope.address], limit: 150 },
          ]
        : [{ kinds: [1111], '#E': [scope.key], limit: 150 }];
      filters.push({ kinds: [7, 9735], '#e': [manifest.id], limit: 150 });
      const found = [
        ...this.store.events(scope.key),
        ...(await this.relay.query(relays, filters)),
        manifest,
      ];
      const referenced = [
        ...new Set(
          found
            .flatMap((e) => e.tags.filter((t) => t[0] === 'e').map((t) => t[1]))
            .filter((id) => /^[a-f0-9]{64}$/.test(id) && !found.some((e) => e.id === id)),
        ),
      ].slice(0, 64);
      if (referenced.length)
        found.push(
          ...(await this.relay.query(relays, [
            { ids: referenced, kinds: [35129, 15129, 5129, 1111], limit: 64 },
          ])),
        );
      const commentIds = [...new Set(found.filter((e) => e.kind === 1111).map((e) => e.id))].slice(
        0,
        128,
      );
      for (let i = 0; i < commentIds.length; i += 64)
        found.push(
          ...(await this.relay.query(relays, [
            { kinds: [7, 9735], '#e': commentIds.slice(i, i + 64), limit: 150 },
          ])),
        );
      const social = found.filter((e) => [7, 1111].includes(e.kind));
      const authors = [...new Set([manifest.pubkey, ...social.map((e) => e.pubkey)])].slice(0, 64);
      const ids = [...new Set(social.map((e) => e.id))].slice(0, 128);
      const metadata: Filter[] = [{ kinds: [0], authors, limit: 100 }];
      for (let i = 0; i < ids.length; i += 64)
        metadata.push({ kinds: [5], '#e': ids.slice(i, i + 64), limit: 100 });
      found.push(...(await this.relay.query(relays, metadata)));
      new ProfileService(this.store, this.relay).ingest(found.filter((e) => e.kind === 0));
      this.store.put(
        scope.key,
        found.filter((e) => allowedSocial(e)),
      );
    })().finally(() => {
      state.pending = undefined;
    });
    return state.pending;
  }
  async data(context: SocialContext) {
    const raw = this.store.events(context.scope.key).filter(allowedSocial);
    const manifests = new Map<string, SignedEvent>([[context.manifest.id, context.manifest]]);
    for (const e of raw.filter((e) => [35129, 15129, 5129].includes(e.kind)))
      try {
        await validateManifest(e);
        // Retain other verified targets too, so a contradictory e/a pair is
        // rejected instead of appearing to reference an unavailable old revision.
        if (!manifestBlocked(e)) manifests.set(e.id, e);
      } catch {}
    const events = raw.filter((e) => [1111, 7, 5, 9735].includes(e.kind));
    const profiles: Record<string, { name: string; about?: string }> = {};
    const metadata = new ProfileService(this.store, this.relay);
    metadata.ingest(raw.filter((e) => e.kind === 0));
    for (const pubkey of new Set([context.manifest.pubkey, ...events.map((e) => e.pubkey)]))
      try {
        const event = metadata.event(pubkey);
        if (event) {
          profiles[pubkey] = profileView(pubkey, event);
          if (!events.some((e) => e.id === event.id)) events.push(event);
        }
      } catch {}
    const lastActions: Record<string, number> = {};
    for (const e of events.filter((e) => [5, 7, 1111].includes(e.kind)))
      lastActions[e.pubkey] = Math.max(lastActions[e.pubkey] ?? 0, e.created_at);
    return {
      ...socialView(context.scope, events, manifests),
      profiles,
      events,
      manifests,
      lastActions,
    };
  }
  async write(context: SocialContext, input: unknown) {
    let event: SignedEvent;
    try {
      event = verifiedEvent(input);
    } catch {
      throw new CommunityError('Invalid event signature.', 401);
    }
    const now = Math.floor(Date.now() / 1000);
    if (!allowedSocial(event))
      throw new CommunityError('This account or event is blocked here.', 403);
    if (
      event.created_at < now - 120 ||
      event.created_at > now + 30 ||
      JSON.stringify(event).length > 12000
    )
      throw new CommunityError('The event is too old, too large or in the future.');
    await this.refresh(context);
    const data = await this.data(context),
      map = new Map([
        ...data.manifests,
        ...data.events.map((e): [string, SignedEvent] => [e.id, e]),
      ]);
    let valid = false;
    if (event.kind === 1111) valid = validComment(event, context.scope, map);
    if (event.kind === 7)
      valid =
        validLike(event, context.scope, data.manifests) ||
        (validCommentLike(event, context.scope, map) &&
          data.comments.some((comment) => comment.id === lastTag(event, 'e') && !comment.deleted));
    if (event.kind === 5) {
      const targets = event.tags.filter((t) => t[0] === 'e');
      valid =
        targets.length > 0 &&
        targets.length <= 64 &&
        !event.tags.some((t) => t[0] === 'a') &&
        targets.every((t) => {
          const target = map.get(t[1]);
          return (
            !!target &&
            target.pubkey === event.pubkey &&
            target.created_at <= event.created_at &&
            (validComment(target, context.scope, map) ||
              validLike(target, context.scope, data.manifests) ||
              validCommentLike(target, context.scope, map))
          );
        });
    }
    if (!valid)
      throw new CommunityError(
        'This event does not belong to the napplet thread, or is not a supported social action.',
      );
    const existing = this.store.events(context.scope.key);
    if (
      existing.filter(
        (e) =>
          e.pubkey === event.pubkey && e.created_at >= now - 60 && [5, 7, 1111].includes(e.kind),
      ).length >= 20 &&
      !existing.some((e) => e.id === event.id)
    )
      throw new CommunityError('Please wait before posting again.', 429);
    const accepted = await this.relay.publish(context.relays, event);
    this.store.put(context.scope.key, [context.manifest, event]);
    return { event, accepted };
  }
}
let service: SocialService | undefined;
export function socialService() {
  const store = communityStore();
  if (service?.store !== store) service = new SocialService(store);
  return service;
}
export async function socialResponse(request: Request) {
  try {
    communityBudget();
    const ref = new URL(request.url).searchParams.get('reference') ?? '';
    if (ref.length > 4096) throw new CommunityError('Reference too long.');
    const context = await socialContext(ref),
      service = socialService();
    if (request.method === 'POST') {
      const { value } = await boundedJson(request);
      return Response.json(await service.write(context, value), { headers: communityHeaders });
    }
    if (request.method !== 'GET') throw new CommunityError('Method not allowed.', 405);
    await service.refresh(context);
    const data = await service.data(context);
    return Response.json(
      {
        scope: context.scope,
        manifest: context.manifest,
        relays: context.relays,
        comments: data.comments,
        likes: data.likes,
        likeCount: data.likeCount,
        profiles: data.profiles,
        lastActions: data.lastActions,
        limited: true,
      },
      { headers: communityHeaders },
    );
  } catch (error) {
    return communityFailure(error);
  }
}
