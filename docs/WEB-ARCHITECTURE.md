# Rendering, routing, and named links

Implementation update (2026-09-12): see [PUBLIC-DEVELOPMENT.md](PUBLIC-DEVELOPMENT.md) for automatic seeds, relay-only publicdev, and SSR/PNG previews, and [CONTEXTVM.md](CONTEXTVM.md) for the multiplayer service boundary. The remaining infrastructure and extensions below are still a plan. Public clients accept ordinary named/root/snapshot manifests without requiring Space extensions.

Status: architecture with initial implementation, 2026-09-11. TanStack Start/Router, Bun, React, shadcn, Applesauce, SSR routes, a signed fixture catalog, source inspection, and sandbox playback are implemented. Persistent indexing, production name claims, social actions, and the full upstream NAP integration remain planned. The user additionally requested Caddy/PM2 VPS deployment; see [DEPLOYMENT.md](DEPLOYMENT.md).

## 1. Rendering decision

Propose **TanStack Start with TanStack Router, React 19+, a Bun server, and Vite for framework builds**. Serve useful public HTML on direct requests, hydrate it, then use client-side navigation. Start provides SSR, server functions, and client/server builds around Router. Its type-safe routing and search parameters fit gallery filters and the three detail URL forms. [TanStack Start overview](https://tanstack.com/start/latest/docs/framework/react/overview).

The earlier React Router Framework Mode recommendation was a conservative default, not a demonstrated advantage over TanStack. It remains a reasonable alternative. The main caution for Start is release maturity: its current overview labels it Release Candidate with a stable API. Pin and test the complete integration before adopting it. Avoid adding the rest of the TanStack libraries automatically; use Query only where shared client caching or mutation handling earns its additional state-management surface.

### Why include Vite when using Bun?

Bun already provides frontend bundling and a fullstack development server with hot module reloading. A Bun/React SPA does not inherently need Vite. The reason to retain a framework build tool here is Start's integration for server/client builds and server functions. Its documented options are Vite and Rsbuild; Bun's native bundler is not a drop-in replacement for that pipeline. Vite is our initial candidate, not a protocol requirement or a shadcn requirement. [Bun fullstack server](https://bun.sh/docs/bundler/fullstack), [Start build options](https://tanstack.com/start/latest/docs/framework/react/overview).

Bun serves as the package manager and intended JavaScript runtime; Vite supplies the framework build/development pipeline. A production deployment runs the built server and static assets, not the Vite development server. Validate that the pinned development tooling runs under Bun as well as the production server. A Bun-only approach remains possible with more custom SSR/build integration, but that maintenance would become our responsibility.

The creator template's Vite build is a separate decision: upstream napplet tooling already supplies a Vite plugin and single-file artifact workflow. Website framework changes do not require changing creator templates. Neither Bun nor Vite is required in the browser to play a published HTML artifact.

| Surface                                | Initial request                                                                                                | After hydration                                                                      |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Gallery, categories, creator pages     | Render the first page of public metadata and posters on the server                                             | Filter, paginate, restore scroll, update counts                                      |
| Named napplet and Nostr-address routes | Render title, description, creator, poster, source/remix links, initial public discussion, Open Graph metadata | Verify release/artifact, start the player on selection, enable signed social actions |
| Pinned release                         | Render metadata for that exact snapshot                                                                        | Execute only that snapshot's verified artifact                                       |
| Source and remix views                 | Render accessible source text/lineage summaries                                                                | Navigate files or load further results                                               |
| Settings and signer controls           | Render a neutral page shell; authenticate any protected server reads                                           | Connect browser signer and load private state                                        |
| About and creation instructions        | Optional build-time prerendering                                                                               | Minimal interaction                                                                  |

SSR renders the surrounding site. Napplet HTML is never imported, evaluated, or inserted as executable content into the server render. Its runtime is a browser-only module mounted after hydration and artifact verification. Credentials and browser APIs must not appear in server-render imports.

Anonymous public pages should contain useful content with JavaScript disabled. Playing, wallet connection, and signing require JavaScript. Social crawlers receive the title, description, and a verified/processed cover without running a napplet. There is no need for React Server Components in the initial implementation.

A06 adds the actual starter command directly to the server-rendered hero, explicitly
allowing creation, remixing and CLI publication without website sign-in. The hero,
creation page, CLI help and remix dialog share a command builder. The walkthrough
is a checked-in, offline-rendered MP4 with a poster, captions and transcript. Native
controls load video only on demand; no Remotion runtime ships to the browser. Static
public files support single byte ranges so video seeking works through the Bun server.
See [Onboarding](ONBOARDING.md) for regeneration, request boundaries and verification.
A06 and the About route are deployed in `20260914192251320-98168` on 2026-09-14.

## 2. Bun server and application boundaries

One `apps/web` deployment handles SSR and site-owned administration, aliases, health and share-image endpoints. Protocol entities load over Nostr and Blossom directly in the browser. Shared backend operations in `packages/backend` support SSR and workers without HTTP requests to our own server. The retained HTTP surfaces are listed in [PROTOCOL-ACCESS.md](PROTOCOL-ACCESS.md).

Start documents Bun deployment with React 19 or newer, including a native Bun server alternative. The implementation uses Vite's emitted Fetch-style Start server entry behind `apps/web/server.ts`; it does not require Nitro. The production build, SSR, direct protocol navigation, verified artifacts, and route status codes have browser coverage. PM2 launches the Bun executable directly because its Bun interpreter wrapper uses `require()`, which cannot load this server's top-level await. Caddy owns TLS on the VPS. Direct relay cancellation and native media playback have isolated regression coverage. [Start hosting](https://tanstack.com/start/latest/docs/framework/react/guide/hosting).

Do not silently use Node in local development and Bun in production. If the chosen versions cannot support the integration reliably, record and review that constraint before selecting a consistent alternative runtime for both environments.

Isomorphic route loaders resolve identifiers from validated SQLite projections during SSR and query Nostr directly in the browser. SSR implementations use server-only functions, so they do not expose a second set of protocol RPC endpoints. Database access and secrets stay in the server bundle. Workers perform discovery and verification asynchronously for the initial HTML and OG previews; an unknown portable identifier can also resolve directly in the browser without waiting for indexing. Readable alias mappings and site policy remain server functions because this website owns that state. A database/service outage is not a fabricated 404. See [INDEXING.md](INDEXING.md) for the server index's persistence model.

## 3. Route map

| URL                                                                | Meaning                                                                       |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `/`                                                                | Gallery; filters in query parameters, e.g. `?sort=new&tag=game`               |
| `/create`                                                          | Combined creator/soyLI guide, templates, installation, skills and downloads   |
| `/cli`                                                             | Permanent redirect to `/create`; `/cli/download/…` continues serving releases |
| `/@alice`                                                          | Creator's site profile                                                        |
| `/@alice/plasma-pet`                                               | Human-readable napplet page, following its current release                    |
| `/@alice/plasma-pet/source`                                        | Source for the selected current release                                       |
| `/@alice/plasma-pet/remixes`                                       | Remix lineage and descendants                                                 |
| `/n/<naddr>`                                                       | Portable identity route, following its current release                        |
| `/n/<naddr>/source`                                                | Equivalent source view without a site handle                                  |
| `/r/<manifest-event-id>`                                           | Exact signed revision of any supported manifest kind                          |
| `/r/<manifest-event-id>/source`                                    | Exact source revision of that release                                         |
| `/n/<naddr>/play`, `/r/<event-id>/play`, `/@alice/plasma-pet/play` | Immersive presentation of the same identity/release; deployed 2026-09-14      |
| `/settings`                                                        | Creator/account preferences                                                   |
| `/about`                                                           | Server-rendered guide, stack and resources; deployed 2026-09-14               |
| `/api/v1/*`                                                        | CLI/public data/status and authenticated account endpoints                    |

These are ordinary path routes, with no hash router. Direct requests and refreshes go through the same resolver and return proper HTTP status codes. TanStack Router handles subsequent navigation and route loading.

The `/play` children deliberately render through their parent detail component,
which retains the live iframe and host while route presentation changes. They reuse
the parent's resolver and canonical/OG metadata. Native fullscreen is layered over
CSS expansion and requires a browser gesture. See the current
[immersive lifecycle contract](PUBLIC-RUNTIME.md#immersive-links) for exit/history
semantics and verification; deployed in `20260914171728494-21459` on 2026-09-14.

For the proposed Start implementation, use file-based routes under `apps/web/src/routes` and its generated typed route tree. Route modules own validated path/search inputs, loaders, metadata, and error boundaries; server functions and API handlers own protected backend operations. Shared detail components and a shared `resolveNappletPage()` service keep alias, address, and snapshot views consistent. The URL contract above does not depend on the final router choice.

Validate gallery query parameters such as `sort`, `tag`, and `q`, provide defaults, and keep shareable navigation state in the URL. Preserve one player instance across its child views. Establish one owner for each cached dataset: route data for page metadata initially, and a deliberate live-update layer for Nostr events. If Query is introduced, hydrate its cache from SSR and update that same cache from subscriptions rather than keeping independent competing copies.

The `creator` segment includes the leading `@`; validate and normalize it centrally. A value without `@` is not a creator namespace. This avoids relying on a partially dynamic segment such as `@:handle`. Every relevant loader validates its own input through the shared resolver; do not depend on parent-loader execution order for validation or authorization. Reserved static routes and API/framework resource routes have explicit handlers.

## 4. Named-route registry

Model aliases as a layer over stable protocol identity:

```text
/@alice/plasma-pet
    → normalized handle "alice" → creator public key
    → normalized slug "plasma-pet" within that creator
    → (35129, creator public key, d-tag)
    → current signed manifest → exact snapshot
```

The mapping stores the decoded kind/pubkey/d-tag tuple. Different `naddr` encodings with different relay hints can name the same napplet, so an encoded string is not the database identity. An alias never points directly to an HTML URL or a changeable Git branch.

Suggested records:

- `creator_handles`: normalized handle, owner pubkey, primary/legacy status, timestamps.
- `napplet_slugs`: owner pubkey, normalized slug, napplet identity, primary/legacy status.
- `alias_changes`: authenticated claim/change, old/new association, timestamp, administrative reason if any.

Enforce a unique handle and a unique `(owner_pubkey, slug)` pair transactionally. Claim/change operations authenticate control of the creator key and verify that a target napplet belongs to that author. Bind signed requests to their action/endpoint/body, use a short validity period, and prevent replay. Normal Nostr profile display names do not reserve a route and are not evidence of handle ownership.

Generate a readable default handle with a collision suffix and derive the default slug from the title. A collision adds a suffix without blocking publish. Display titles can change independently. Handles and slugs are optional presentation conveniences: an unavailable naming service must not prevent publication to `/n/<naddr>`.

Keep previous names as aliases after renaming. Redirect explicit old-name routes to the current primary route, and do not reassign an old path to unrelated content. Deletion/moderation can leave a tombstone instead of redirecting elsewhere. Prefixing names with the creator keeps ordinary napplet titles out of a global first-come-first-served namespace. Short global vanity routes can be a later curated feature.

This registry is operated by napplet.space. It is not a global Nostr naming standard or a replacement for signature verification. Export/back it up separately so the same operator can restore old links. Another host can choose different names while retaining the same napplet identities. No new Nostr event kind is needed to ship these routes. Serving matching NIP-05 names would be a separate optional feature.

## 5. Canonical links, navigation, and caching

Named and `/n/` routes both resolve directly. Use the current primary named URL as the page's SEO canonical when one exists; otherwise use the normalized `/n/` URL. The portable address route remains usable without an alias redirect. Pinned release pages use `/r/` as their own canonical and never redirect to the current release.

Share offers the friendly link, the portable Nostr address, and an exact-version link. Copying a Remix command always resolves to the release being displayed. Social counts, saves, and permissions use protocol identity rather than the URL that led to the page. With the standalone manifest migration, soyLI pins the signed named revision itself to preserve its address-based integrations. The index retains observed replaced revisions and verifies them under the same rules as current releases. New snapshot ancestry never borrows the named app's identity; old snapshot links retain their legacy behavior. See [NIP5D-MIGRATION.md](NIP5D-MIGRATION.md).

The running player's Source action links to `/r/<displayed-manifest-id>/source`, so an intervening publication cannot switch the inspected source. A direct request to a named `/source` route resolves current once and redirects to the corresponding pinned source view. This also prevents parallel nested loaders from accidentally selecting different current releases.

Start with ordinary gallery-to-detail navigation, intent-based metadata prefetch, and scroll restoration. Prefetch does not execute a napplet. The detail route owns one player; child tabs can reuse it. Expand the player through presentation state without replacing its iframe. An optional `?view=fullscreen` represents an expanded layout, while the browser Fullscreen API still requires a user gesture. Use browser history so Back/Escape behave predictably; only intercept Escape when the player controls that presentation mode.

Preserving a gallery behind an intercepted modal route can come later. Direct URL loads must always render a complete detail page. Pin the running player to its selected snapshot; a new current release produces an update affordance rather than replacing a game mid-session.

Cache anonymous public metadata briefly and invalidate it when the current release, alias, or moderation state changes. Hash-addressed assets get immutable cache entries. Snapshot identity is immutable, but its page's availability/moderation status is not; do not cache the whole page forever. Never put signer-specific state into shared HTML/data caches. Initialize hydration from the same SSR data, then attach live updates.

Browser social actions obtain signatures from the user's signer; a server action does not possess that signer. Protected alias/settings mutations validate the authenticated request on the server. All profile text, comments, source paths, and metadata are untrusted rendering inputs.

## 6. UI components

Applesauce owns Nostr event storage, relay connections, React event-store context, and browser-extension signing. It is the Nostr data layer; do not add a competing Query cache for the same events. Current relay discovery is optional and explicit, while the gallery's initial server projection uses a validated bundled fixture catalog. Remote events never become executable content merely by entering the event store.

Use shadcn/ui as requested, with Tailwind and shared CSS theme tokens. Keep owned components in `apps/web/src/components/ui` initially; extract a shared UI package only when another application needs it. Shadcn has an official TanStack Router setup guide and does not dictate our server framework. [shadcn TanStack installation](https://ui.shadcn.com/docs/installation/tanstack-router).

Apply these components to the gallery, player controls, dialogs, menus, creation instructions, and account screens. Choose typography, color, spacing, and interaction details for the demoscene character. Individual napplets choose their own rendering libraries; the site's component dependencies do not become a mandatory part of every playable artifact.

## 7. Acceptance criteria

- Direct-load and refresh every named, address, snapshot, and source route; verify status, metadata, and canonical URL without JavaScript.
- Named and Nostr routes resolve to the same identity and social thread; different relay hints do not duplicate records.
- Rename a creator or napplet, then verify old links still identify the same creation.
- Race two handle/slug claims and reject unauthorized remapping.
- Simulate naming-service failure and publish successfully with a portable link.
- Hydration creates no duplicate player, subscriptions, or identity-dependent mismatch.
- A malicious napplet cannot execute during SSR, metadata prefetch, or a feed render.
- Fullscreen, source navigation, Back, and returning to the gallery preserve intended player/scroll behavior.

## Direct protocol transport (2026-09-15 source update)

TanStack server loaders provide initial HTML and crawler metadata. Browser loader
implementations use Applesauce relay queries and original Blossom/provider URLs,
including on first-load refresh. Site moderation, names, curation, health and OG
generation remain server-owned. See [the route inventory and boundaries](PROTOCOL-ACCESS.md).
This source update is not yet deployed and does not replace installed soyLI binaries.
