# Napplet interoperability and publishing contract

2026-09-23 public application-data source update: the shared host grants a
constrained `relay.publish`/`outbox.publish` subset for kind-30078 records under
the documented `soy.app-data/1` convention. NIP-78 is pinned to
`6aeea6093786644e892dd2869fa5b642fddd271d`; our public relay access policy deliberately
differs from that revision's owner-only recommendation. The existing shim 0.30.0
publish envelopes are unchanged. An optional shell-init `capabilities.appData`
host-policy hint identifies supported limits and the verified napplet's stable
scope; it is not a new NAP, manifest requirement or publishing-provenance gate.
Viewer consent, schema-envelope validation, signed revisions and complete selected
relay reads bound writes. App payload validation belongs to the consumer. See
[shared data](SHARED-DATA.md) for tombstones, conflict/retention limits and examples.
Implemented source is distinct from a deployed runtime or released CLI.

2026-09-15 local A13/A21 update: [creator profiles](PROFILES.md) use ordinary kind-0
metadata and NIP-19 public keys, and [genealogy](REMIXING.md#genealogy-on-napplet-pages)
reads signed parent/origin claims. NIP-01/24 and NIP-5A were reviewed at
`a2494f4f81d46684e5814a9bf35e2b1df978f955`; the NIP-5D pin and napplet kinds below
remain unchanged. A snapshot’s `a` identifies itself, not its remix parent.
Optional `remix-version` pins exact ancestry; absence never affects playback.
Website kind-0 signing is explicit profile editing, not a new iframe permission.
Both features are verified locally and await deployment.

Implementation update (2026-09-13): local fixtures and relay imports use the same manifest validator, capability checks, artifact verification, NAP host, and resource policy. See [PUBLIC-RUNTIME.md](PUBLIC-RUNTIME.md) for implemented operations and limits. The [resumable publisher](PUBLISHING.md) now signs Git source, uploads artifacts/archives and publishes standard snapshot/current manifests. Persistent website indexing, signed site aliases, source remixes and social writes are implemented; see [COMMUNITY.md](COMMUNITY.md) and [REMIXING.md](REMIXING.md) for current limits. Linked image and optional NIP-92 video preview metadata are implemented; see [PREVIEWS.md](PREVIEWS.md). The six bundled examples are local test fixtures; they have not been published to public relays or Blossom.

Standing product rule: a napplet created here is an ordinary public napplet. The client must not require a Space descriptor, hashtag, repository host, alias, or CLI provenance to discover or play it. Optional metadata enriches presentation; it never selects a privileged runtime or determines protocol identity. Apply the same capability, availability, and moderation policies to every publisher. The user has selected the NIP-5D proposal as authoritative, regardless of merge status. Pin its revision and referenced NAP contracts, and treat implementation mismatches as bugs. Known gaps and future relay/media/flavor design are recorded in [CLIENT-DIRECTION.md](CLIENT-DIRECTION.md).

2026-09-17 local backend update: NAP-CVM PR 31 at `ad68a938236e9230324e377cd005008a315ff402`
and NAP-WEBRTC PR 59 at `5fae95dd2c8e59bd06c654e0845656add077dcda` are the selected
browser contracts; ContextVM docs were reviewed at `fb5bafc405f7a11b39ff5d46f78c144467df980b`.
The shared host now exposes both domains. Soy scoreboard/room/matchmaking tools
are separate versioned MCP contracts; `soy-rtc/1` is documented host signaling,
not an additional NAP or a NIP-100 conformance claim. No custom manifest metadata
or Soy publisher provenance is required. [Implementation, limits and verification](CONTEXTVM.md).

2026-09-23 score attachments extend the Soy MCP service with `soy.boards.v2`,
bounded JSON data and per-entry reads. The NAP-CVM `ad68a938`, ContextVM SDK
0.13.16, MCP 1.30.0 and shim 0.30.0 pins remain unchanged. This is a versioned
service schema over existing calls, not a new NAP, manifest requirement or proxy.
The same service runs in soyLI preview and production; all publishers can use
ordinary CVM calls. See [service semantics and limits](CONTEXTVM.md#structured-score-attachments-service-110).

## Managed runtime assets — soyLI 0.13.0 source

The local asset inventory is an authoring convention, not a manifest extension.
External assets use ordinary `resource` capability requirements,
`blossom:sha256:<hash>` references and signed Blossom server hints. Source archives
retain the lock/helper/originals for remixes; removing that optional source metadata
does not affect playback of the published HTML on compatible hosts. All publishers
use the same byte/hash/MIME admission. No new website resource proxy is introduced.
WebM classification and Blob fonts are now supported by the shared host; limits and
remaining gaps are in [ASSETS.md](ASSETS.md) and [PUBLIC-RUNTIME.md](PUBLIC-RUNTIME.md).

## Rust/WASM authoring — 2026-09-23 source

The optional Rust build recipe embeds gzip-packed executable WASM and bundled
wasm-bindgen JavaScript in the existing single HTML artifact. Decompression happens
in memory; the trusted host still verifies the complete HTML hash before execution.
There is no new manifest kind, file, NAP domain, HTTP proxy or WASM projection.
The existing opaque `allow-scripts` sandbox, `wasm-unsafe-eval`, blocked direct
network and blocked workers remain unchanged. Bevy assets use ordinary NAP-RESOURCE;
host calls go through the existing injected namespace. Other publishers remain
subject to the same admission and capability checks. Local recipe/toolchain pins
are source metadata and never playback requirements. See [WASM.md](WASM.md) for
the measured build profile and [COMPATIBILITY.md](COMPATIBILITY.md) for evidence.

## 1. Compatibility baseline

The current [NIP-5D proposal at commit 24711d9](https://github.com/dskvr/nips/blob/24711d9c47bbdd07908bf1d52bf677d9cbc530f0/5D.md) defines named napplets as kind `35129`, root napplets as `15129`, and immutable snapshots as `5129`. It adopts the file-manifest tag schema and aggregate-hash algorithm from [NIP-5A](https://github.com/nostr-protocol/nips/blob/master/5A.md). Generic nsites use different kinds; they must not be silently treated as sandboxed napplets.

The client accepts named, root, and snapshot manifests. Our publisher will default to named napplets and additionally publish snapshots for pinned links; snapshots are not a prerequisite for playing another publisher's current manifest. The source repository has its own NIP-34 identity.

The tested release must record exact SDK, shim, template, conformance, ngit, GRASP, Blossom, and protocol revisions. Reading an old README or choosing the latest versions independently is insufficient. The [compatibility record](COMPATIBILITY.md) rechecks the NIP-5D pin and inventories current operations/evidence. The host injects domains before creator scripts and performs the SHELL handshake itself; standard artifacts do not need app-owned bootstrap code. The new [NAP-CONFIG implementation](CONFIGURATION.md) uses upstream build metadata inside the signed HTML and shares one host between the CLI preview and website. Other per-NAP proposal audits and independent-client acceptance remain open.

## 2. Domain identities

| Entity            | Identifier                                            | Meaning                                                 |
| ----------------- | ----------------------------------------------------- | ------------------------------------------------------- |
| Creator           | Nostr public key                                      | Author who signs the napplet's releases                 |
| Napplet           | `35129:<author-hex>:<d-tag>` or `15129:<author-hex>:` | Stable identity across title changes and releases       |
| Release           | Signed kind-5129 snapshot event ID                    | Immutable reference to one publication                  |
| Artifact          | NIP-5A aggregate hash                                 | Identity of the playable files, independent of metadata |
| Source repository | `30617:<maintainer-hex>:<repo-id>`                    | NIP-34 repository address                               |
| Source revision   | Repository address plus exact Git object ID           | Source selected for a release                           |
| Remix             | New napplet address plus parent release reference     | Independent creation with explicit ancestry             |

Use a short generated `d-tag`, for example `plasma-k4m2`, with a separate editable display title. Limit generated IDs to 1–13 lowercase letters/digits/hyphens, with no trailing hyphen, as a conservative profile choice; do not claim the current napplet implementation itself enforces that length. Never derive identity solely from a mutable title or globally reserve titles.

The runtime's protocol tuple `(dTag, aggregateHash)` does not replace the full public identity. Host-owned storage, permission records, and social grouping must also include the author-qualified napplet address. Two authors can intentionally publish identical code and identifiers.

## 3. Playable package

- Exactly one executable artifact: `/index.html`, UTF-8, containing the application's code, CSS, and required playable assets.
- No CDN scripts, external fonts, dynamic imports fetched over the network, direct fetch/WebSocket calls, or service-worker dependencies in the initial profile.
- Build-time dependencies are allowed. They are bundled into the result rather than resolved on the viewer's device.
- Playable HTML is limited to 25 MiB, its source archive to 50 MiB and signed events to 64 KiB. These are local admission limits, not NIP-5D quotas. The website, indexer and runtime must deploy the updated artifact limit before admitting HTML above the former 10 MiB ceiling; a CLI release alone is insufficient. Managed resources retain their separate 10 MiB limit. See [previews](PREVIEWS.md) for presentation limits.
- The local preview and public player use the same runtime library and production bundle policy. A normal unsandboxed Vite page does not prove the napplet will run on the website.
- Current host capabilities and operation limits are recorded in [PUBLIC-RUNTIME.md](PUBLIC-RUNTIME.md). Required domains are checked from the signed manifest for every napplet, including fixtures. Direct browser networking remains blocked; supported resource and relay operations go through the host.

The hash algorithm is the upstream NIP-5A algorithm. Implement it once, with vectors shared by CLI, API, and browser. Reject malformed hashes, duplicate/conflicting paths, invalid signatures, inconsistent aggregate hashes, and unsupported required capabilities.

Covers, metadata, and source archives live on Blossom too, but are not playable `path` entries. This preserves a single self-contained runtime artifact.

## 4. Optional presentation and source metadata

Topics use optional lowercase `t` hashtags from [NIP-24](https://github.com/nostr-protocol/nips/blob/master/24.md), on the signed manifest and its snapshot. Multiple tags are welcome; there is no fixed category enum and no mandatory Space hashtag. The client derives topics from verified manifests for both fixtures and relay imports; provenance is not a topic or filter. Missing tags leave a napplet in Everything and text search. A selected `?tag=generative` filter matches that topic, combined with `q` and `sort`; cards and details link to the same filter. Facet counts cover the loaded catalog, including entries whose playback is unavailable. They are not network-wide counts.

The display/search projection trims a leading `#` and surrounding whitespace, normalizes NFC and lowercase, deduplicates in author order, and accepts up to 32 topics of at most 64 Unicode code points. Empty values, embedded whitespace, control/bidi characters, and embedded `#` are omitted from the projection without changing the signed event or its admission. Unknown well-formed topics are preserved; no topics are inferred from titles, capabilities, source, or linked preview descriptors. The CLI seeds editable `topics` in local project configuration; the publisher serializes them as standard `t` tags.

Use upstream manifest fields for identity, playable paths, aggregate hash, required domains, Blossom `server` hints, title, description, and `source`. A `source` reference can identify a NIP-34 repository through `nostr://` or a public HTTPS repository/archive. Our publisher defaults to retrievable open source. Source availability affects inspection/remixing, not whether this client can discover and play an otherwise supported napplet.

Prefer existing descriptor conventions over inventing a parallel manifest. [NIP-5A's upstream app descriptors](https://github.com/nostr-protocol/nips/blob/master/5A.md#upstream-app-descriptors) allow an optional `app` reference to an addressable descriptor event. Linked previews support NIP-89 application pictures and Zapstore kind-32267 screenshots/icons, with signed fixtures and a live descriptor lookup checked. Kind-32267 descriptors may also carry NIP-92 video attachments; the initial bounded silent-WebM profile is documented in PREVIEWS.md. Other descriptor formats require a separate adapter and interoperability evidence. There is no Space-specific screenshot field required for playback.

Category, cover, aspect ratio, license details, exact source commit, build provenance, and remix references may enrich the gallery. Keep site aliases and curation separate from signed protocol identity. Verify any signed descriptor and its association before trusting its claims. Missing, unknown, invalid, or unavailable optional descriptors fall back to the ordinary manifest and a generated poster; they do not hide a valid napplet or block playback. An optional descriptor may never override signed paths or required capabilities.

Preview implementation today: the fixtures have bundled SVG illustrations; relay imports resolve supported linked descriptors into bounded cached raster images. Gallery/player covers and OG images use those images, with generated cards for missing or unusable metadata. The latest 93-entry relay cache has no app links, so those cards still use the fallback. A generic card does not prove the author supplied no screenshot through another format. Metadata crawling never executes napplet code. The same descriptor parser and image indexer are available to the future publisher; see [PREVIEWS.md](PREVIEWS.md).

Removing all optional Space metadata must leave the same napplet address, playable bytes, and NAP behavior. No client should need the Space website API or a `napplet-space` hashtag to discover our publications.

## 5. Current version, snapshots, and ancestry

The named manifest is the current pointer and carries standard playable tags, required capabilities, source URL, and any optional descriptor reference. Our publisher also produces a snapshot with the same artifact and an `a` reference to the napplet's own address. A snapshot has no `d` tag. Each event is independently valid and playable without retrieving the other.

Do not add a mandatory custom current-to-snapshot pointer. The publisher can retain the exact pair in its local journal and the site index. Validate each manifest independently and check source address, signer, and artifact when associating a pair; matching code alone does not identify the exact release metadata. Public playback does not require a snapshot pair. Fixtures use these same rules and no longer emit a custom snapshot pointer or discovery hashtag.

Follow the pinned upstream schema for the named manifest's `a` immediate-parent and `A` original-ancestor tags on remixes. Snapshot `a` means the snapshotted napplet, not its remix parent. Put the exact parent snapshot in the descriptor so those meanings do not collide.

Keep URLs explicit:

```text
/n/<naddr>            latest valid publication
/r/<snapshot-event>  pinned publication
/@<handle>/<slug>     site alias for the stable napplet address
```

Titles and vanity slugs are display aliases. A fork gets a new creator-qualified address and repository, and starts from the exact referenced source commit rather than whatever is at `main` today. Do not grant a remixing creator write access to the original repository. A remix is an independent project, not an automatic PR.

The site's authenticated name registry maps a normalized creator handle and napplet slug to the decoded kind/pubkey/d-tag tuple. Multiple naddrs with different relay hints can denote that same tuple. Alias changes do not mutate the napplet's protocol identity, release ancestry, storage scope, or social thread. Retain previous names for the same creation. Site alias ownership is an operator-managed record, not a new Nostr naming standard; see [WEB-ARCHITECTURE.md](WEB-ARCHITECTURE.md).

Rollback republishes an earlier artifact/descriptor under a new current event and a new snapshot. It does not delete history. Guard timestamps against clock skew and resolve competing current events according to Nostr ordering; a stale local publication must not silently overwrite a newer release. Require an explicit override when this conflict is detected.

If the newest signed current manifest is invalid or unavailable, surface that state. The site may offer the last verified playable release, but must label it as an older version rather than quietly calling it current. Nostr ordering and gallery eligibility are separate decisions.

## 6. Source guarantees

Every release made by our publisher should include retrievable source, an exact commit, a license, dependency lockfile, and the documented build recipe. This is a creator-tool default, not a requirement for indexing other publishers' manifests. Retain a source archive on Blossom for convenient inspection and recovery. Validate archive paths, links, expanded size, and file count before extracting; validate its tracked tree against the referenced Git revision before claiming it is that source.

2026-10-03 source admission update: publication, remix and source browsing share a
1,024-file tooling safety budget, not a Nostr quota. Source remains bounded to
40 MiB and its tar to 50 MiB; the current release tree/archive contains only regular
files. Older Git trees may
retain safe aliases to public regular files within the same tree after removal or
replacement at HEAD. This changes no manifest, signature, runtime capability or
upstream pin. Existing 128-file website deployments need the updated source parser
to inspect larger archives; optional source inspection never gates playback.
The hash-verifiable archive remains portable for recovery, offline inspection and
independent mirroring alongside the source repository.

The publisher retains Git release refs so published commits remain reachable after branches move. It includes optional `source-commit` and `source-archive` provenance tags alongside the standard `source` repository URL. These two convenience tags are Space conventions, not protocol requirements; clients can ignore them and discover/play the same manifest. Large original media can be represented in a content-addressed source asset lockfile and restored during remix; every required source asset must be retained and hash-checked too. V1 can keep normal small assets in Git and introduce that lockfile only when needed.

A creator signature and matching source archive prove what the creator published and claimed. They do not prove the HTML was built from that source. Initially label the association as creator-declared. Only show a stronger reproducible-build claim after an independent isolated rebuild reproduces the artifact hash. That verification is a later worker capability, not a prerequisite for every quick first publish.

## 7. Social event mapping

2026-09-24 source: explicit **Post to Nostr** sharing uses a standalone kind-1 note,
with lowercase NIP-24 `t` tags derived from the edited text and optional NIP-92
metadata matching its original media URL. Its default `#nappletsoy` is removable
presentation, never a napplet admission requirement. The viewer signs in the shell;
no iframe permission or manifest schema changes. See [sharing](COMMUNITY.md#sharing-a-napplet-as-a-nostr-note--2026-09-24-source).

| Interaction | Protocol                                                                                          | Space aggregation rule                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Profiles    | Nostr kind 0                                                                                      | Existing author identity; merge updates according to Nostr rules                                                               |
| Like        | [NIP-25](https://github.com/nostr-protocol/nips/blob/master/25.md), kind 7                        | Include required target `e` and addressable `a` reference; count one active like per actor and napplet address across releases |
| Comment     | [NIP-22](https://github.com/nostr-protocol/nips/blob/master/22.md), kind 1111                     | Root at napplet address; include the required root/parent tags, author tags, kinds, and current target event reference         |
| Reply       | NIP-22, kind 1111                                                                                 | Preserve root napplet scope, point parent at the comment                                                                       |
| Zap         | [NIP-57](https://github.com/nostr-protocol/nips/blob/master/57.md), request 9734 and receipt 9735 | Pay creator; use address reference and the relevant event reference; aggregate validated receipts across versions              |
| Retraction  | NIP-09 deletion request                                                                           | Apply only where ownership and protocol rules authorize it; do not promise network-wide erasure                                |

Persist raw signed events and deduplicate by event ID. Resolve event-only legacy references through known manifest history where possible; do not invent missing relationships. Validate referenced authors and event kinds rather than trusting tags alone. For reactions, a deleted old like must not erase a newer like; define active-event reduction and cover it with fixtures.

Validate zap receipts against NIP-57, including provider identity, request, invoice amount and description binding. Deduplicate payment hashes as well as event IDs. A receipt is the provider's assertion of payment, not trustless proof or a reliable anti-Sybil signal. Wallet setup and optional wallet-connect support belong to the site, not the game iframe.

The client's intentional plain-description invoice compatibility and direct LUD-21
payment confirmation are documented in [COMMUNITY.md](COMMUNITY.md#zaps). Missing
description hashes use the configured provider's association; a present hash must
match. Confirmed tab-local payments update the UI while a public receipt travels
through relays, without publishing synthetic receipts or introducing a site API.

## 8. Browser trust boundary

1. Obtain and verify the signed manifest. Fetch and verify all referenced playable bytes and recompute the aggregate hash. Resolve optional descriptors separately for presentation; their absence cannot prevent execution.
2. Construct a fresh `srcdoc` document, placing the host's CSP first and its selected runtime prelude before creator scripts. Hash verification happens before those host additions; additions are excluded from the signed artifact hash.
3. Use `sandbox="allow-scripts"` without `allow-same-origin`. Do not grant forms, popups, downloads, top navigation, or devices by default.
4. Scope each inbound message to the registered iframe `Window`, full app address, release, and current session. Reject malformed/oversized payloads and unknown senders; silently ignore unknown message types as the pinned protocol requires. Bound pending operations and message rates.
5. Remove bindings, subscriptions, object URLs, audio, and pending work when the player closes or navigates. A changed document must not inherit an old session's privileges.

Browser-native input is distinct from host-mediated NAP domains. The existing
sandbox permits Gamepad API reads on tested Chromium, subject to browser exposure
and Permissions-Policy. soyLI's optional [controller helper and tester](CONTROLLERS.md)
use this directly; they add no SERIAL/device grant, signing authority or new NAP
requirement. Games must handle input focus and retain usable fallback controls.

Sandboxing alone does not block network requests. Use the pinned proposal's restrictive CSP, including `connect-src 'none'`, no external scripts, no child frames, and no workers initially. For media creations allow only embedded `data:`/`blob:` audio/image sources; permit WebAssembly byte compilation only if the chosen profile needs it. Do not enable JavaScript `unsafe-eval` as a shortcut. Host-page response headers must enforce controls such as `frame-ancestors` that a CSP meta element cannot enforce. See [CSP Level 3](https://www.w3.org/TR/CSP3/).

Test self-navigation as well as fetch, WebSocket, image beacons, popups, workers, message spoofing, and stale iframe references. CSP and a sandbox do not guarantee absence of every exfiltration channel or hard per-iframe CPU limits. Do not send secrets or signing credentials into the iframe. Infinite loops can still harm a browser tab; posters, one running player, and process isolation where available reduce exposure without guaranteeing a CPU quota.

Store saves in host-owned storage scoped by viewer/anonymous local profile and full napplet address. Default saves are device-local; cross-device persistence is later. Treat storage `shared` as shared within that napplet's permitted scope, never across unrelated creators. Decide update/migration behavior explicitly so changing an artifact does not inadvertently erase saves. Reassess capabilities on every signed release: the artifact hash excludes capability metadata, so identical bytes do not imply identical grants.

## 9. Protocol-level acceptance checks

- Publish from our CLI with a real creator identity, then discover the signed manifest using only standard Nostr kind/address filters in a second implementation. That client must retrieve the hinted Blossom bytes, verify the same aggregate hash, and run the creation without the Space API, alias, hashtag, or optional descriptor. Publishing is implemented; this independent-client acceptance check remains on A12, including a configurable artifact.
- Import that publication back through the same relay ingestion path as any other publisher. Local fixtures and imported copies must receive identical validation, capabilities, resource access, and storage identity.
- Removing optional presentation metadata still yields a discoverable, playable napplet with a generated poster.
- Another operator can reconstruct the napplet, source, metadata, and ancestry from exported signed events, Git, and Blossom without our Postgres database.
- An update preserves the stable social thread; a pinned link remains pinned.
- Two authors with matching `d-tag` and artifact hash do not share permissions or storage.
- Retried publication does not duplicate snapshots or lose references.
- A missing or corrupt blob prevents execution and produces a useful retry state.
- Unknown profile extensions do not cause unsafe capability fallback.
- Social duplicates, forged references, retractions, and invalid zap receipts reduce correctly.

Rebuilding content does not recreate the site name registry, local curation, moderation history, private saves, or every event lost by all relays. Back up those operator/private datasets separately and state their portability limits. Portable Nostr routes continue to identify creations independently of the name registry.

Source inspection (deployed 2026-09-14) consumes the existing optional `source-archive`/`source-commit` conventions without changing NIP-5D admission. It verifies the exact signed archive hash, labels commit/build correspondence as author-recorded, and offers a verified built-HTML fallback for all publishers. See [the source browser contract](REMIXING.md#browsing-a-releases-original-files). The large-original-media lockfile described above is still planned, not implemented; [asset authoring](ASSETS.md) describes that gap.

## Host account and curation update — 2026-09-15

Local A07/A20 work uses `applesauce-accounts@6.2.0` for website account sessions and
extends site policy with administrator membership and Featured order. It does not
change NIP-5D manifests, NAP permissions, artifact formats or publisher eligibility.
NIP-98 remains the admin request protocol. Saved credentials stay in the trusted
host; running napplets receive only the existing public identity notifications.
See [identity](IDENTITY.md#website-sign-in) and [moderation](MODERATION.md).

## Git proposals and optional built review — soyLI 0.12.0 (local)

The collaboration adapter follows [NIP-34 at
6d2979b3f503a8539c983efbcdcf901bbcf9ed23](https://github.com/nostr-protocol/nips/blob/6d2979b3f503a8539c983efbcdcf901bbcf9ed23/34.md):
1618 roots, author-only 1619 revisions, 1111 discussion and authorized 1630–1633
status. Publication now preserves real Git history. A single remix can publish an
independent napplet or propose the same changes upstream; neither happens merely
on clone. Proposal refs use GRASP-01 `refs/nostr/<event-id>` without updating a
maintainer branch. The existing GRASP 3.0.2 pin is retained.

The optional `soy-preview` tag binds a hash-addressed JSON descriptor, signed
snapshot and source commit to the exact PR revision. It adds no requirement to
NIP-34 discovery or NIP-5D playback; attachments are not gallery publications.
See [the complete attachment and review contract](COLLABORATION.md). The selected
NIP-5D authority and all NAP pins remain unchanged. This is local implementation,
not a claim of production rollout or source-to-build reproducibility.

## Interactive host actions — 0.15.0 source

The shared profile now includes user-selected FS import copies, Blossom UPLOAD,
COMMON social writes and public LISTS mutation. All publishers use the same host
policy. These use existing pinned shim envelopes and standard Nostr events;
no manifest identity, required presentation/source metadata or NIP-5D pin changes.
[Runtime actions](RUNTIME-ACTIONS.md) specifies viewer-owned signing/consent,
configured direct transports, supported subsets and lifecycle limits. Arbitrary
signing and relay/outbox publishing remain unavailable to frames.

## Author publication lifecycle — 0.17.0

[Unpublish, republish and hosted-data deletion](LIFECYCLE.md) use signed NIP-09
requests (kind 5), fresh NIP-5D current listings and direct Blossom BUD-11/12
requests. The author confirms a concrete inventory; per-service status distinguishes
confirmed absence, retained shared data and incomplete requests. No manifest
extension or website deletion API is required. NIP-5D and NAP pins are unchanged.
GRASP retains deleted repository archives for 90 days by default; copies and forks
outside the selected services are not recalled.
# Dynamic backend service extension (2026-09-25)

The feature branch adds opt-in `soy.backends.v1` MCP tools over the existing
NAP-CVM transport. Module schemas are described separately from outer tool hashes.
No new NAP capability, mandatory presentation metadata or REST API is introduced.
The shell can bind a consenting signed-in account to its transport using an exact,
unpublished proof scoped to provider/module. Provider signatures attest builds;
they are not proof of honest execution. Public admission defaults off; explicit creator admission and verified Linux isolation are required. See
[DYNAMIC-BACKENDS.md](DYNAMIC-BACKENDS.md) for implemented behavior and limits.
A possible upstream CEP is explicitly deferred; upstream protocol pins are unchanged.
