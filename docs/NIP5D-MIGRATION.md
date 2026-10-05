# NIP-5D standalone manifest migration

This source targets [dskvr/nips PR 7 at `4d0fb2e9fa1fdca71be09b17a4c5f382fbca5d51`](https://github.com/dskvr/nips/blob/4d0fb2e9fa1fdca71be09b17a4c5f382fbca5d51/5D.md), reviewed on 2026-10-04 while the PR was open. It supersedes the writer contract at `24711d9c47bbdd07908bf1d52bf677d9cbc530f0`, retained by the legacy reader. Kinds remain **35129 / 15129 / 5129**. This document describes local implementation, not a deployed website or released CLI.

## Read old, publish new

| Area                    | New publication                                                              | Existing publication                                          |
| ----------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Artifact                | Exactly one `x` containing raw HTML SHA-256                                  | Verified `/index.html` path and legacy aggregate binding      |
| Description             | Nonempty plain-text `content`                                                | Existing `description` tag                                    |
| Required capabilities   | Repeated `R`                                                                 | Existing `requires`                                           |
| Optional capabilities   | Repeated `O`; missing domains do not block                                   | No extra capability is inferred                               |
| Icons                   | Optional hash plus PNG/JPEG/WebP MIME                                        | Existing linked covers remain supported                       |
| Discovery               | `z` archetypes, queryless `i` intents and parameter names, `#R`/`#O` filters | Existing kinds, titles, descriptions and topic filters        |
| Snapshot ancestry       | Optional `a` parent / `A` root on 5129 only                                  | Historical named ancestry and snapshot self-address semantics |
| Source and presentation | Existing optional Git/source/archive/descriptor extensions                   | Existing source and preview links remain valid                |

One shared validator handles web, indexer, local review, remix, moderation inputs and playback. Format selection is explicit; failure is not a reason to reinterpret a malformed new event as an old event. Nostr ordering still chooses the current event before package admission. An invalid newer event does not silently restore an older release as current.

Fresh publication and proposal previews use the new shape. A frozen legacy journal resumes the exact original plan, event format and signatures. Re-publishing an unchanged project after an older completed publication still creates the new-format publication. No source history or signed historical event is rewritten.

Local `requires` remains the authoring option and is translated to `R`. `optionalDomains`, `archetypes`, `intents` and `icon` are editable through project metadata and the local manager; see [the creator guide](NIP5D-CREATOR.md). Required build metadata is combined with explicit required domains. Optional declarations cannot override required ones or grant any permission.

## Identity and saved data

A new manifest binds the protocol identity to the raw artifact hash. Existing named/root applications retain their author-qualified address, and their browser saves/settings keep the deterministic legacy-derived physical build key. The same author, address and HTML bytes therefore keep the same data across a manifest-only upgrade. A different HTML build retains the existing build-isolation behavior; this migration does not promise cross-build save migration.

New snapshots are independent. Parent/root tags cannot select a parent's storage, account backend binding, social thread, moderation identity or deletion scope, even for the same author. They are provenance claims only. Legacy snapshots retain their old validated own-address behavior. A bare new snapshot with no ancestry is valid, discoverable and playable.

New soyLI pinned links use `/r/<signed-current-event-id>` to preserve the named app's address-based integrations while pinning its exact executable and metadata. `/r` accepts all three manifest kinds; existing snapshot links continue to work. The persistent site index archives observed replaced revisions, keeps their verified artifact references, and applies deletion/expiration/moderation to those revisions too. They do not become extra current gallery entries. Current events and archived revisions each have a 10,000-record operational bound; artifact/preview cache budgets still apply.

Back up the index alongside other persistent service data. Relays can prune replaceable events: a new operator cannot reconstruct an unobserved older named event from a relay that discarded it. An exact signed-event link pins identity and content, not eternal data availability. Independent snapshot events remain ordinary relay-retainable immutable publications.

A new current/snapshot pair may be coalesced in the gallery only when its signer, timestamp, artifact and every shared signed presentation/capability/source field agree and both manifests validate. This is presentation only. Direct snapshot URLs continue to work with independent scope. The index can compare archived named revisions; a browser that has not observed those revisions may show additional independently valid historical snapshots. An ancestry tag or matching artifact hash alone never establishes a pair.

Lifecycle review separately enumerates exact signed pairs, including retained historical revisions, and shows their event IDs before author confirmation. The shared planner revalidates that inventory; saved receipts freeze it for retries. Unknown or near-matching snapshots remain independent. A bounded optional history endpoint supplies signed events, not deletion authority. See [the lifecycle contract](LIFECYCLE.md).

## Optional features and trust

Icons are downloaded by hash only from declared Blossom origins. Both the hash and actual decoded PNG/JPEG/WebP format are checked. Byte and dimension budgets apply before rendering; the browser uses verified Blob URLs and the index uses normalized verified images. Invalid or unavailable icons fall back to ordinary artwork without blocking execution. Existing screenshots take cover precedence.

The gallery exposes archetype, intent, required-domain and optional-domain filters alongside existing search/topics. Intent/capability tags advertise behavior, not authority. The complete `R` set is checked at launch against actual host support. `O` does not constrain compatibility. Targeted intersections cannot enumerate every compatible app, so they never replace this local check.

The discovery helper also supports opt-in intersection queries from [NIP-91 PR 2252 at `b93bda29d45998866e81c65e0693616294a78672`](https://github.com/dskvr/nips/blob/b93bda29d45998866e81c65e0693616294a78672/91.md). Every `&` constraint retains its matching `#` fallback in the same filter, and results are checked locally. The gallery's single-selection facets use ordinary NIP-01 filters. The managed relay supports those indexed filters but does not advertise NIP-91 intersection support; that separate relay extension is not a requirement of NIP-5D.

The current upstream announcement mentions screenshot tags and possible intent hints, but the pinned PR defines neither a screenshot-tag schema nor an intent dispatch operation. Existing signed application descriptors continue to provide screenshot/video presentation. No undocumented tag or message is invented. There is no new runtime `intent` grant, inter-napplet launch or automatic handler invocation.

The executable remains one self-contained HTML file verified before CSP and shim injection into an opaque `allow-scripts` iframe. WASM and managed resource transport are unchanged. No source, icon, descriptor, Git host, site alias or Soy provenance is a playback prerequisite. All publishers use the same admission rules.

## Dependency and rollout boundaries

The manifest migration is implemented by Soy's parser/publisher and managed guidance adapters. Runtime shim 0.30.0, nap/core 0.32.0, starter SDK 0.24.4, Vite plugin 0.11.2, conformance CLI 0.2.15 / engine 0.13.0 and the recorded boilerplate/skill snapshots retain their pins. The plugin still builds single-file HTML and embeds required-domain metadata; its optional legacy event output is not used by soyLI publication.

1. Deploy the dual-format reader, indexer, runtime and associated service policy first. Preserve the index database and allow projections to refresh.
2. Verify old and new named, root and snapshot fixtures through the deployed site, including old links and unavailable-artifact states.
3. Release the updated CLI writer and guidance. Existing projects can run `soyli skills update`; source/build configuration remains the creator's work. Publish normally to upgrade a release; use `--resume` only for an existing frozen job.
4. Keep the legacy reader. No bulk re-signing, history rewrite or deletion is necessary for old napplets to remain playable.

Independent clients must adopt the new event shape themselves. The pinned Paja/upstream-builder checks in [interoperability](INTEROPERABILITY.md) qualify the legacy format only. Passing those tests is not evidence that an older external host understands PR 7.

## Verification

Local verification on 2026-10-04:

- `bun run check`: 495 tests passed across 119 files, 4,054 assertions; typecheck passed.
- Go relay `test -race ./...` passed, including raw-hash moderation, legacy/snapshot identity and indexed discovery tags.
- `tests/services/nip5d-migration.test.ts`: real relay/Blossom/indexer and production browser passed (35 Bun assertions plus UI checks). Covers all three kinds in both formats, saved-state continuity, independent snapshots, required/optional capabilities, plaintext descriptions, icons, filters, archived pinned navigation and confirmed removal of current/historical pairs while independent snapshots remain listed.
- Real publishing, proposal, remix and mobile lifecycle service tests passed. Source and compiled arm64 CLI lifecycle runs each passed 31 assertions through publish, unpublish, republish and hosted-data deletion. The compiled fixture includes the release preview bundle and companion browser libraries.
- Native CLI fresh scaffold, project metadata roundtrip and guidance update passed with an isolated account directory and no creator account setup.
- Pinned Paja/upstream-builder/ngit interoperability passed 26 assertions for the **legacy format**. This does not qualify those external clients for PR 7.

The regression suites also cover frozen legacy journal resume, fresh upgrade, third-party metadata bounds, identity isolation, moderation, signed history inventory, icon verification and cold legacy discovery. Tests use isolated local services; no remote publication, release or deployment is claimed.

## Dedicated author migration

soyLI 0.24.0 adds the opt-in `migrate <link> --dry-run` / `--confirm` / `--resume`
flow described in [the creator guide](NIP5D-CREATOR.md#upgrade-an-existing-publication-without-rebuilding-it).
It verifies and reuses exact published HTML, retains named/root identity and
optional source/media references, and never rewrites signed history or rebuilds.
It refuses stale pinned releases, deleted/expired publications, changed primary
state, wrong authors and unverified bytes. Snapshot conversion is excluded because
standalone snapshots have a different independent identity. A fresh publication
from an existing local project also recognizes an exact metadata-only migration
of its saved previous manifest; arbitrary remote changes remain conflicts.
