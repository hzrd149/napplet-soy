# First implementation slice

Updated 2026-09-13. This records the boundary between working code and the larger v1 plan.

2026-09-23 source update: creator selection now governs the next publication in
any project. Sharing captures an account ID before building/checking and keeps it
for that operation without rewriting the global selection. Journals and lifecycle
receipts are scoped by author public key, with legacy journal/receipt reads; another
author's listings and pending releases remain intact. Ignored build/backend context
follows the selected author, and agents are explicitly instructed not to restore
stale creator bindings by switching accounts. Same-public-key signer changes retain
the listing; different keys have separate Nostr/Git/board namespaces. See
[identity](IDENTITY.md) and [publishing](PUBLISHING.md).

## Implemented

- Bun 1.3.11 with TanStack Start 1.168.52, Router 1.170.35, React 19.2.4, Vite 8.3.0, TypeScript, shadcn/ui, and Tailwind.
- SSR gallery, query-based topic/search/sort filters, random selection, creator pages, named routes, portable `naddr` routes, pinned snapshot routes, and exact-source views.
- Six deterministic signed starter releases, original SVG posters, and interactive single-HTML examples. Fixture keys and data are clearly separated from production identity work. No fake community statistics.
- Applesauce event-store isolation, signature verification, optional explicitly configured relay subscriptions, React context, and NIP-07 extension connection. Signing keys never enter a napplet iframe or SSR state.
- Each wire event's ID and signature are verified once and the result is cached on the event. The browser loads libsecp256k1 compiled to WASM (`nostr-wasm`) in a lazy chunk and uses the JavaScript verifier until it is ready or if it fails to load. The server, CLI and tests keep the JavaScript verifier.
- NIP-5A aggregate hashes; signature, author, snapshot, path, and hash checks; bounded artifact download; browser-only execution behind an opaque iframe and restrictive CSP. This does not yet claim full NAP interoperability or a complete hostile-content admission pipeline.
- Local CLI project creation with Git, source, license, agent instructions, and a standalone bundled copy of the same restricted preview runtime.
- A native Bun production server, PM2 ecosystem definition, local Caddy/PM2 commands, and a VPS deployment script with pinned tool downloads, candidate health checks, release directories, activation rollback, and systemd persistence.

## Relay discovery, previews, and ContextVM additions

- Idempotent example seeding runs before both development and local production startup; a warm check measured about 33 ms.
- Explicit `publicdev` imports signed kinds 35129/15129/5129 through Applesauce. No Space-specific snapshot pointer is required. Public source is Nostr relays, with bounded signed-hint Blossom fetching and a separate `.local` cache. No HTTP catalog importer remains.
- Public naddr/snapshot pages, capability availability states, hash-verified playback, and source downloads. A real relay scan found 93 valid manifests; 23 compatible artifacts are now cached. The playback host and interoperability evidence are documented in [PUBLIC-RUNTIME.md](PUBLIC-RUNTIME.md).
- Server-rendered OG/canonical/Twitter metadata and bounded PNG generation with a bundled font. The deploy script sets a trusted site origin. Native image rendering is excluded from Vite optimization and browser bundles.
- A runnable ContextVM matchmaking starter with encrypted Nostr transport and authenticated ticket ownership, plus a separate PM2 definition. Its API and the pending browser NAP-CVM integration are specified in [CONTEXTVM.md](CONTEXTVM.md). No game engine, managed creator hosting, or public ContextVM deployment is claimed.

See [PUBLIC-DEVELOPMENT.md](PUBLIC-DEVELOPMENT.md) for runtime limits and commands.

## Verification boundary

Protocol/runtime/CLI/deployment-input tests and Chromium tests cover signatures, hashes, address equivalence, traversal rejection, source inspection, SSR, hydration/navigation, gallery filters, mobile overflow, sandbox access/network restrictions, tamper rejection, and signer failure handling. The local PM2/Caddy stack is used for the final browser pass. Repeatable transport tests use bounded local NIP-01 fixtures; a separate read-only public-relay smoke run verifies actual discovery and playback. ContextVM client/server tests exercise encrypted MCP round trips and transport-derived identity.

Local PM2 checks exposed its Bun `require()` wrapper incompatibility with top-level await; the ecosystem now executes the Bun binary directly. PM2 also retains old executable/cwd settings on reload, so activation explicitly recreates the dedicated application process. React 19.3.0 triggered a Bun 1.3.11 CommonJS loader error when importing its production SSR renderer; React/React DOM are pinned to the verified 19.2.4 pair. Candidate smoke checks and the standalone server explicitly use production mode so this class of difference is tested before activation.

No VPS has been contacted or deployed to. Shell syntax and argument validation are tested; remote apt installation, Linux systemd behavior, certificate issuance, actual reboot recovery, and remote rollback remain unverified. The relay, Blossom and GRASP services run natively under PM2; the community database is not provisioned.

## Next vertical slice

The four web/CLI contract repairs in [CLIENT-DIRECTION.md](CLIENT-DIRECTION.md) are implemented: silent unknown messages, shared CLI playback services, NIP-65 identity preferences, and identity-change notifications without restarting the frame. The NIP-5D proposal is authoritative. The same note records the recommended Khatru/LMDB/Bleve stack and future media/flavor strategy.

Wire one real publish path through creator signing, ngit/GRASP source provisioning, Blossom upload, relay events, persistent validation/indexing, named-route assignment, and playback. The upstream shim is now pinned and playback domains are implemented; extend conformance coverage alongside the publish path. The CLI installer, remote signers, persistent naming claims, moderation, likes/comments/zaps, and a full remix/publish journal are still ahead.

Previous slice validation: 33 unit/integration tests passed; six Chromium checks passed against ordinary production mode through Caddy/PM2, plus the explicit publicdev browser check. The latter covers relay-derived naddr lookup, verified Rubik Cube playback, capability gating, and its OG endpoint. Cached public page/artifact/image URLs returned 404 when publicdev was off. The public gallery was also checked at a 390px viewport for overflow.

## Public playback addition

The player now injects the upstream shim and a NAP-SHELL handshake, with scoped saves, virtual file exports, resource mediation, and Applesauce relay/outbox reads. Cards distinguish ready artifacts from unsupported domains and failed downloads. Napplet-initiated publishing and account-changing operations are denied explicitly; the user can connect/disconnect in the host. See [PUBLIC-RUNTIME.md](PUBLIC-RUNTIME.md) for the implemented surface, constraints and real public-app checks. The standalone CLI preview now bundles these same host services; see the conformance addition below.

Previous runtime checkpoint validation: **43 unit/integration tests and 11 Chromium tests passed**. Five public/runtime checks ran through Caddy/PM2, including the real 78 MiB packaged-resource fixture; six existing app checks ran against the same production build with public mode disabled. Public page/artifact/OG/resource endpoints returned 404 in ordinary mode. Mobile public compatibility labels remain visible at 390px with no horizontal overflow. Production build and startup succeeded. The runtime checkpoint is `95b88f4`; subsequent verification, accessibility and documentation changes are committed separately.


## Standard manifests across catalog sources

Fixture and public playback now share `validateManifest` and `preparePlayback`, including required-domain checks and author/address/aggregate storage identity. Current and pinned routes validate the manifest actually being played. Known fixture manifests use the same resource endpoint and policy as relay imports, and the host receives the configured publicdev relay set for either source. Fixture seeds no longer emit the custom snapshot pointer or Space discovery hashtag; browser subscriptions query all three napplet kinds without branding filters.

The interoperability contract now requires ordinary public relay discovery and independently verifiable Blossom retrieval for every future CLI publication. Extra descriptors, source details, categories, covers, and site aliases are optional presentation/remix data; they never determine whether a supported manifest can be discovered or played. At this checkpoint fixture posters remained bundled artwork and public cards used generated OG fallbacks; the linked-preview addition below implements descriptor resolution. The UI explicitly identifies the local examples as unpublished.

Latest validation: **48 unit/integration tests, type checking, production build/startup, and four Chromium public/runtime checks passed** through local Caddy/PM2. Coverage includes fixture/import playback parity, unbranded relay discovery, resource access for both sources, capability rejection, and storage isolation between authors/apps and consistency between current/snapshot views. The 78 MiB resource test was deliberately not repeated in this pass. Public publishing and independent-client acceptance remain unfinished.


## Linked preview addition

Optional NIP-5A `app` references now resolve through signed Nostr metadata to NIP-89 pictures/profile fallback and Zapstore kind-32267 screenshots/icons. A bounded Node/Applesauce worker performs metadata queries during refresh, including public relay hints. Images are fetched with DNS/IP checks, raster-decoded with Sharp, normalized, and cached independently of playable artifacts. Gallery/player covers use the cached PNG and OG cards incorporate it. Missing, malformed, unsupported, or unreachable metadata does not block playback. See [PREVIEWS.md](PREVIEWS.md).

The current public scan still contains 93 napplets and no app links. A separate signed offline browser fixture proves visible linked previews, and a read-only live query retrieved a real NIP-89 descriptor through the production metadata worker. No synthetic events were inserted into the normal public catalog or published. Test and build results for this addition are recorded in PREVIEWS.md.

## Topic taxonomy

The gallery now derives optional topics from signed NIP-24 `t` tags for every manifest. Fixed categories and the separate “Public napplets” filter are removed. Clickable tags, catalog counts, search, and shareable `?tag=...` filters work across discovery sources; details and generated OG images use the same vocabulary. Untagged napplets remain in Everything and text search. Cards show up to three topics with a link to the full list; available filters come from the loaded collection, not a fixed taxonomy. Generated preview images fit inside their cards without cropping their titles.

Fixture manifests and snapshots now carry meaningful topic tags, and new CLI projects include editable topic suggestions. The 93 currently cached relay manifests have no `t` tags; the client does not invent topics for them. This is presentation metadata, not a new admission rule or a publishing implementation. See [PROTOCOL.md](PROTOCOL.md) for normalization and bounds, and [../CONTEXT.md](../CONTEXT.md) for vocabulary.

Validation: 60 unit/integration tests, type checking, production build/startup, seven Chromium app/linked-preview checks, and a relay Rubik Cube playback check passed. The linked-preview fixture verifies that the same topic filter includes both bundled and imported napplets. Desktop and 390px mobile layouts were inspected; tag navigation, reload/history, missing-topic behavior, and idempotent seeding are covered. Local PM2/Caddy is running the updated build.


## Focused NIP-5D/NAP conformance repairs

Unknown message types are silently ignored, including future operations in recognized domains, before quota accounting. Known denied operations still return policy errors. `identity.getPublicKey` is an immediate successful snapshot even when asynchronous services are at quota. `identity.getRelays` reads the newest verified user kind-10002 event, preserves read/write directions, and keeps actual connections subject to the shared public runtime read policy.

Connecting or disconnecting preserves the running frame and sends `identity.changed` after cancelling outstanding requests, prompts, resources and subscriptions. Shared saves are isolated by account; instance storage and virtual files are fresh for each account scope. Late callbacks cannot reply into the new scope, including when request IDs are reused. Napplets must react to identity changes to clear their own in-memory state.

New CLI projects bundle the website's prelude builder, pinned shim, NAP-SHELL bootstrap, host, artifact verifier, sandbox policy and resource responder. The local server's only policy difference is admitting the current editable local revision instead of looking up a published signed manifest. It creates no signing key or fake publication. Project `previewId` provides stable local save identity, while `requires`, `relays` and `servers` configure the preview. Browser-extension identity, save/link prompts and file downloads work in the standalone host. No dependency installation or running Space backend is required after scaffolding.

Regression checks cover an independently spawned generated project, actual loopback relay traffic, CSP inheritance, source/config reloads, tampered bytes, unsupported requirements, account changes and cancelled work. Public relay writes remain absent.

Validation for this repair: type checking and **62 unit/integration tests passed**. **15 Chromium checks passed**: nine covering the standalone CLI, linked previews, public playback and runtime through the relevant local servers, plus six ordinary-mode gallery/SSR/sandbox checks. Production build and Caddy/PM2 startup passed. The opt-in 78 MiB packaged-resource test was not repeated.


## Managed relay foundation

Khatru/LMDB/Bleve now runs as a persistent PM2 process in both local modes and is wired into the VPS build/activation/rollback script. Dev startup reconciles the 12 signed example events over Applesauce; repeated seeds skip writes and publicdev never becomes a fixture destination. Caddy exposes ordinary WebSocket and NIP-11 traffic at `/relay`. Build reuse, health, process ownership and graceful shutdown are implemented. See [RELAY.md](RELAY.md) for exact pins, two checksum-guarded upstream fixes, search semantics, bounds and verification.

This completed the relay portion of the publishing slice. Blossom storage followed as recorded below. GRASP source hosting followed as recorded below. Creator keys, persistent website indexing/naming and CLI publication remain unfinished. No VPS has been contacted.

## Managed Blossom foundation

The Bun blob service implements the pinned Blossom BUD-01/02/06/11/12 contract with signed uploads, exact-byte hashing, descriptors, ranges, optional preflight, private cursor-based listing and shared uploader ownership. CAS files and SQLite metadata persist outside release directories; one process owns a directory, commits are serialized, and startup reclaims interrupted files. The shared uploader uses Applesauce signing and independently verifies bytes after uploading. See [BLOSSOM.md](BLOSSOM.md) for precise policies, limits and recovery boundaries.

Both dev modes now start Blossom, verify six fixture blobs through its API, and upload only missing/damaged/unowned blobs. Publicdev is never a write destination. The VPS script builds/tests the same bundle, activates it under PM2, checks its build/instance, and includes it in rollback. Caddy gives blob storage its own root origin: local port 8081 or `blossom.<domain>` (overridable with `--blossom-domain`). Data stays at `/var/lib/napplet-space/blossom`.

Service tests cover real HTTP authorization, ownership and deletion, hash mismatch, ranges, cursors, concurrent quotas, idempotent seeding, file repair and process locking. The bundled service survives SIGTERM and SIGKILL. A real local relay round trip discovers a signed NIP-5D manifest through Applesauce and retrieves its exact bytes using its standard Blossom server hint.

This is still a publication component: fixture manifests in the ordinary catalog/relay do not yet advertise these running services, and normal website indexing still uses existing catalogs. GRASP followed as recorded below; creator identity/CLI publication and persistent index/naming integration remain next. No VPS or public-relay publication was attempted.

Validation: 64 application tests, 15 Blossom HTTP/process tests, 10 Go race tests and four relay process tests passed. Two Chromium checks passed through Caddy: the new cross-origin upload/read/delete flow and the existing relay-discovered Rubik Cube playback/OG flow. Type checking, the production build/startup, Caddy configuration validation and VPS shell syntax passed. The local stack is running with publicdev and 93 relay-discovered entries; a warm six-blob verification took 64 ms with no uploads.


## Managed GRASP foundation

Pinned ngit-grasp v3.0.2 now provides source hosting, using standard kind-30617 repository announcements, kind-30618 branch-state authorization and Git smart HTTP. The shared Applesauce publication adapter checks signatures and selected targets, pushes an authorized commit, and verifies queryable metadata plus Git refs before reporting success. Service identity, repository authorization and Git objects survive process restarts. The build has checksum-guarded process ownership, local isolation and build-identification changes; see [GRASP.md](GRASP.md).

Both dev modes run the same native service and Caddy Git origin, then reconcile six fixture source repositories. The VPS script installs checksum-pinned Rust, builds/tests GRASP, gives it a third hostname, persists state outside releases and manages activation/recovery under PM2. An upstream-pin guard prevents automatic migrations/downgrades through ordinary deployments. Creator keys never enter the Git subprocess. Publicdev remains read-only and is not a seed destination.

Validation: **67 application tests, eight native GRASP process tests and the Chromium relay-discovery/Rubik Cube/OG check passed**. Type checking, the production web build/startup, local and generated VPS Caddy configuration validation, and deployment shell syntax passed. Independent Git cloning through Caddy produced bytes matching the signed Soft orbit fixture. HMR startup through the same Caddy proxy also retained all 93 publicdev entries. A warm six-repository seed check took 1.2 seconds with zero publications. No VPS, remote TLS, ngit CLI version matrix or actual reboot was tested.

This completes the source-hosting component, committed separately from its stack wiring. Creator identity followed as recorded below. Next is the resumable CLI transaction connecting Git, Blossom and NIP-5D publication, followed by persistent discovery/indexing and named-route assignment. Existing gallery manifests still use the bundled catalog; the complete independent-client publishing acceptance test remains ahead.


## Creator identity foundation

2026-09-23 source follow-up: new CLI remote sessions default to owner-only files
outside Git, with per-account optional native storage and explicit migration of
existing sessions. Local private keys retain their native-vault policy. The
foundation's original all-Keychain behavior below is historical; see
[current storage choices](IDENTITY.md#remote-session-storage-choices).

The CLI now manages persistent creator identities with Bun's native OS credential store and an Applesauce signing adapter shared by source, Blossom and napplet publication. Interactive project creation offers a new key, a bunker connection or setup later, then reuses the selected identity across projects. Account metadata and recovery exports are kept outside Git trees. Public and local profiles have separate directories and credential namespaces. No default creator account was created during development; native tests used isolated temporary metadata and removed their exact test credentials.

NIP-46 connections retrieve the actual user pubkey separately from the bunker transport key, verify it again on reopening, scope signing requests to publication kinds, check returned signatures and exact event contents, and close on denial/cancellation/timeout. Private local keys and remote client sessions stay in the keychain. NIP-49 export/import supports passphrase-encrypted recovery. Pending public reservations let interrupted key storage recover the same identity; missing keys never silently generate replacements. See [IDENTITY.md](IDENTITY.md) for commands and limits.

A native macOS Keychain/CLI test proved reuse across separate processes and two generated projects, encrypted export/import, and removal of all test credentials. A separate integration test proved one reopened creator authorizing Git source on ngit-grasp, an upload on Blossom, and a standard NIP-5D event queryable from Khatru whose server hint returns the expected bytes. These were isolated loopback services. Linux/Windows native keystores and external signer applications have not been tested.

Validation: **79 application tests, the creator service integration test and the opt-in native Keychain/CLI test passed**, along with type checking. The focused 13-test identity/CLI/service suite passed again after adding cancellation support to saved remote-account selection. Recovery includes the official NIP-49 test vector. A manual interactive terminal check confirmed that choosing setup later produces a usable project without creating credentials. No website runtime changes or public publications were made in this slice.

At that checkpoint the public installer, publication journal, source freeze, index/naming integration and publish/remix command remained unfinished. The publisher addition below connects the signing components.

## Resumable creator publication

The CLI now provides `publish`, `publish --dry-run`, `publish --resume` and `status`, with project/destination options and structured errors. It publishes standard named manifests and immutable snapshots through Applesauce, with topic hashtags, required domains, Blossom hints and a standard NIP-34 source URL. Only optional source-commit/archive provenance tags are additional conventions. The default local destinations use the managed services; public defaults describe the intended deployment and have not been contacted. See [PUBLISHING.md](PUBLISHING.md).

The single-HTML profile freezes an explicit file set, checks the current shared sandbox in Chromium, creates a public release commit and archive, persists signatures before publication, and resumes from atomic journal checkpoints. A repeated release checks remote data, repairs missing blobs/events and retries failed mirrors with the same snapshot/commit. Source commits form a dedicated public release history with retained release refs; the user's ordinary Git index, unrelated files and private history are not uploaded. This revises the earlier plan to commit the entire local repository. A Git lease and remote version checks reject observed competing updates; Nostr remains eventually consistent rather than a cross-service transaction.

The browser compiler was moved into a fresh Bun process because the pinned runtime can misread package files when compilation follows networking in a long-lived process. Both scaffolding and publication still use the same runtime bundler. The startup check executes only the frozen HTML under the current trusted preview host, rejects script/CSP failures, and blocks external networking. It is not a full gameplay or arbitrary NAP conformance suite.

Validation: **91 application tests and eight native GRASP regression tests passed**, with type checking. The publication service test ran the sandbox check, resumed after interruption, discovered signed events through an independent Nostr wire reader, extracted the hash-verified source tar and independently cloned/fetched retained Git release refs. The opt-in native test drove the actual CLI with temporary Keychain credentials and resumed a saved publication after SIGKILL. A separate browser check verifies rejection of broken scripts and direct network resources. Temporary credentials, repositories, browsers and services are cleaned up; no personal default identity, public relay or VPS was changed.

The command currently returns `announced_pending_index` with `websiteReady: false`. A printed portable route is not claimed to be an indexed web page. Next: persistent ordinary-relay ingestion into the website and confirmed current/snapshot playback, followed by authenticated named-route mapping. Public installer, media descriptor authoring, remix, additional build profiles and independent public-client acceptance remain ahead.


## Persistent relay index and website confirmation

The independent Applesauce worker now consumes ordinary napplet manifests and authenticated deletion markers from configured relays. SQLite WAL projections and verified artifact/preview caches persist outside releases. Current winners, immutable snapshot lookup, gallery deduplication, linked/generated previews and runtime delivery share the existing validation and capability rules. Invalid updates cannot revive older versions. The dev and VPS launchers use the same PM2 worker definition; deployment checks its release heartbeat and includes it in rollback. This single-VPS SQLite choice supersedes the earlier Postgres proposal.

Publication now returns `indexed` after the website confirms its exact signed current/snapshot pair and artifact. Website outages leave relay publication successful and pending. `status --refresh` checks readiness without signer access or republishing; normal `status` remains local. See [INDEXING.md](INDEXING.md) for polling, storage bounds, backdated-event recovery, deletion handling and remaining limits.

Verification includes application tests and a native relay → Blossom → independent worker → production SSR → Chromium sandbox round trip, including worker restart. No personal creator account, public relay publication or VPS deployment was involved. Next: authenticated creator handles and named-route claims; portable links already resolve.
