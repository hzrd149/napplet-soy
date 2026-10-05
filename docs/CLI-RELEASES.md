# soyLI releases and updates

GitHub Releases distribute the standalone CLI independently of the website/VPS.
The current published version is **0.24.1**.

**0.24.1 published 2026-10-05 (Europe/Vienna):**
[GitHub release](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.24.1),
source `2a8733af7fe14f6179a6d034db56ece351ac9f2e`.
[Workflow 37292441710](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/37292441710)
passed the source gate, all four native jobs and release publication.

A migration preview now creates its private plan parent when no account has ever
been configured. Previously that fresh-install case failed with `ENOENT` before
planning. The correction generates no key, selects no identity and signs/posts
nothing; original-author selection and confirmation remain required for publication.
The real entrypoint regression was red before the correction and passes afterward,
including the compiled macOS ARM64 binary (31 assertions). TypeScript and all 545
source tests pass (4,425 assertions). A checksum-verified public installation reports
0.24.1 as current through `doctor`. With a fresh account directory, it verifies the
actual public napplet's 1,063,318-byte HTML and prepares its conversion without
account setup or signing. All other 0.24.0 migration/compatibility behavior remains.

The website is active in deployment `20261005095909023-57511`. Its installer and
all four manual downloads point to 0.24.1. Fresh live desktop/mobile checks pass:
gallery tools follow social rankings, both chronology options are present, the
affected updated napplet shows its existing 10,000 sats, and no page errors or
390px layout overflow occur. Web and persistent index health identify the same
release. Application, relay, Blossom, GRASP and Linux backend sandbox gates passed
before activation; persistent service/index data was retained.

**0.24.0 published 2026-10-05 (Europe/Vienna):**
[GitHub release](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.24.0),
source `a85da7dbd3f46f284dd163ba32628e84ddc90996`.
[Workflow 37289773986](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/37289773986)
passed the source gate, all four native build/installer/updater/fresh-project jobs
and verified release publication.

Fresh publication uses the standalone NIP-5D manifest at `4d0fb2e`; existing
publications remain supported by the legacy reader. Required/optional domains,
icons, archetypes and intent discovery metadata are available in project metadata
and the manager. The pinned runtime/SDK/plugin remain unchanged. Optional Soy
source and presentation metadata never become playback requirements.

`soyli migrate <napplet-link> --dry-run --json` verifies exact published HTML and
previews an explicit metadata-only conversion. Original-author confirmation is
required; retries reuse a saved signature outside Git. No rebuild, asset upload
or history rewrite occurs. Named/root identity is retained; immutable snapshots
remain unchanged. See [the creator guide](NIP5D-CREATOR.md).

Safe current-tree source aliases such as `CLAUDE.md → AGENTS.md` now retain their
Git links while source archives materialize exact committed contents. Unsafe
links/private files remain blocked. Source limits remain 1,024 files/40 MiB and
50 MiB archives; playable HTML remains 25 MiB.

The compatible website reader was deployed before publishing this CLI. Addressed
likes, comments and verified zaps survive pruned historical revisions. The gallery
separates Newest from Recently updated and places filters below social rankings.
NIP-46 browser connection labels distinguish browser, device format and public
session suffix. Existing projects can run `soyli skills update`; a normal fresh
publication upgrades their manifest, while frozen legacy jobs preserve their
original resume contract. Independent clients need their own new-format reader.

Local verification: TypeScript plus 545 source tests (4,421 assertions), real
relay/Blossom/indexer/production-browser compatibility, compiled CLI migration and
source alias checks (13 tests, 147 assertions), and live desktop/mobile checks.
The affected updated napplet again displays its verified 10,000-sat total. No
public test reaction, comment, invoice request or payment was created.

**0.23.7 published 2026-10-03 (Europe/Vienna):**
[GitHub release](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.23.7),
source `0456c03850570d2c8b8cd9ef41130639624c969d`.
Fixes [issue #3](https://github.com/zeSchlausKwab/napplet-soy/issues/3).
Publication, saved-job resume, remix, source browsing and the local workshop now
share a 1,024-file source budget. The limit bounds local scanning and archive work;
it is not a Nostr limit or a creator quota. `publish.files` remains additive and
errors now explain the actual selection. Source and archive byte budgets remain
40 MiB and 50 MiB, respectively.

Safe internal file aliases such as `CLAUDE.md → AGENTS.md` may remain in older
commits after replacement with regular files in the current tree. Each alias is
validated against its own committed tree. Unsafe links and credentials remain
blocked; no history is rewritten. Current-link and historical-link errors identify
the cause and recovery steps.

Playable HTML now permits 25 MiB across authoring, preview, publication, remix,
indexing and playback. Individual managed assets and runtime resources retain
their separate 10 MiB limits. Use `soyli update` and restart previews; optionally
run `soyli skills update` to refresh existing project guidance. No project migration
or history cleanup is needed for the reported safe historical alias.

The public website/indexer/runtime must also be deployed to admit playable files
above 10 MiB and browse archives above its old 128-file limit. The CLI release does
not update a running host. Blossom already accepts these sizes; no Blossom quota
change is required. Website deployment is pending.

Local verification passes TypeScript and all 450 source tests (3,554 assertions).
The native macOS ARM64 package passes five real-entrypoint tests (103 assertions),
including 1,024/1,025 boundaries and a 12 MiB built artifact. Real local services
verify large-source publication/resume/remix with historical aliases; the production
website indexes and plays a 12 MiB napplet in Chromium and survives an indexer
restart. Exact 25 MiB admission, over-limit rejection, hash/UTF-8 checks and the
unchanged resource cap have regression coverage.

[Workflow 37133743916](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/37133743916)
passed the source gate and all four native build, installer/updater, sandbox and
fresh-project checks. The first Intel macOS attempt reported Git unavailable in
an existing onboarding test; retrying that job passed with the same source and
checks. The original probe suppresses its process output, so its precise transient
failure remains unconfirmed.

All 11 release assets are public. Installer and manifest checksums, source revision
and native matrix were verified. An isolated public macOS ARM64 installation reports
0.23.7/current and passes the real CLI source-limit, 12 MiB artifact and historical
alias regression (24 assertions). The user's installation and accounts were
unchanged. No website deployment was performed.

**0.23.6 published 2026-10-03 (Europe/Vienna):**
[GitHub release](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.23.6),
source `f71162f9e869c98d3bb2791245c27aa95f928e50`.
[Workflow 37072285190](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/37072285190)
passed the source gate and all four native build, installer/updater, sandbox and
fresh-project checks. All 11 release assets are public. Installer and manifest
checksums, source revision and native matrix were verified. An isolated public
macOS ARM64 installation reports 0.23.6/current and passes the real CLI data-pack
import/sync regression (23 assertions). The user's installation and accounts were
unchanged; no website or Blossom deployment was needed or performed.

Managed assets now accept binary data packs (including custom extensions such as
`.ssrcpack`), JSON and plain text. The earlier media-only importer rejected these
before contacting Blossom; the server and hash-addressed resource host already
support them. Generated `assetBlob()` reads both embedded and external data inside
the sandbox without direct fetch. Media keeps the existing `assetUrl()` helper.

The CLI, local workshop and bundled authoring guidance use the same workflow.
Exact earlier media helpers remain valid when resuming or remixing old publications;
frozen source and Git history are not rewritten. Regenerate helpers explicitly to
use the new Blob API.
Imports remain byte-for-byte, hash-verified and source-scanned, with the existing
10 MiB/file and 32 MiB managed limits. Active-document policy is unchanged; importing
a pack does not certify its decoder or contents. No Blossom or website deployment
is required for these authoring changes. See [data assets](ASSETS.md#data-packs-maps-and-other-non-media-assets).

After installing this release, run `soyli skills update` and `soyli assets sync`
inside existing projects, then rebuild, test and publish. Import with
`soyli assets add ./game.ssrcpack game-pack --storage external --license <license>`.
`assets add` and `assets sync` are local operations; publication/proposals perform
the uploads using the configured creator and destination.

Local verification includes the real CLI entrypoint, sandbox reads of media and
binary/JSON/text, publisher interruption and corruption repair, and a fresh Git
remix. TypeScript and all 436 source tests pass, along with legacy publication
resume and Git/archive remix regressions. A native macOS ARM64 package builds embedded/external data in the upstream
Vite template and reads the exact bytes after a fresh checkout. Native CI requires
the CLI, sandbox and Vite regressions on all four release platforms.

The unpublished 0.23.5 candidate passed source checks and the Linux ARM64 job,
but combining the new asset-browser suite with backend initialization in one Bun
process reproduced a macOS SIGKILL; Linux x64's later signing test also timed out.
Browser/bundler suites now run in separate processes, retaining every assertion
and the shared browser cache. No published artifacts or previous tags were replaced.

**0.23.4 published 2026-09-26:**
[GitHub release](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.23.4),
source `923e89e3074463484bde98e8b496b5433799dffd`.
[Workflow 36221163275](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/36221163275)
passed the source gate and all four native build, installer/updater, delayed-signing
browser and fresh-project checks. All 11 release assets are public. Installer and
manifest checksums, source revision and native matrix were verified; an isolated
public macOS ARM64 installation reports 0.23.4/current. The user's installation
and accounts were unchanged.

The shared shell and local preview validate backend account sessions when signing
completes, so normal extension or
remote-signer approval delays no longer produce `Invalid request`. Invalid provider
challenges/session responses now identify the failing step.

The supplied backend client allows up to two minutes for account-bound calls,
including consent and signing. Provider RPC deadlines, sandbox limits and intent
expiry are unchanged. Native CI includes a real browser regression with a 16-second
extension approval and an idempotent world-creation retry.

The unpublished 0.23.3 candidate passed source checks but its native browser test
looked in Playwright's default cache after the packaged CLI installed Chromium in
its own cache. Release CI now shares an explicit browser cache between both
processes; the regression remains required on all four platforms.

Run `soyli update`, restart previews, and run `soyli skills update`
inside existing projects. Review any preserved helper conflicts, then rebuild and
republish to update copied client code. Hosts must also deploy the shared-host
fix; installing soyLI alone does not update their public player. Existing uncertain
requests retain their original IDs and expiry to avoid duplicate worlds.

napplet.soy deployed the fix in website release `20260926054112843-53639` on
2026-09-26. Live authenticated read-only browser checks pass with both 2.5-second
and 16-second extension signing delays. The latter explicitly uses the updated
approval timeout; previously published napplets still need their copied helper
rebuilt and republished. See [deployment verification](DEPLOYMENT.md).

**0.23.2 published 2026-09-25:**
[GitHub release](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.23.2),
source `8e4e3557a7528ae7d15f20ac57c263b95e8d9f8f`.
[Workflow 36185275161](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/36185275161)
passed the source gate and all four native build, installer/updater, packaged
diagnostic and fresh-project backend preview checks. All 11 release assets are
public. Public installer/manifest checksums and source revision were verified.
An isolated public macOS ARM64 installation reports 0.23.2/current; the affected
project passes dry-run with its historical public context preserved. The user's
installation, project files, website and CVM deployment were unchanged.

This patch fixes publication of projects whose old Git
history contains the former public `.napplet-space/soy-backend.json` context,
removed from the current tree. Only that exact path and bounded, strictly validated
public format are accepted; private bindings, journals, databases and credentials
remain blocked. No Git history is rewritten. See
[Historical source checks](CLI.md#historical-source-checks) for the compatibility
rule and recovery procedure.

`publish --dry-run` now checks reachable Git history. Publication and proposal
preflight reject unsafe history before backend/build preparation; errors identify
the path, blob and containing commit with useful recovery advice. Every historical
path is checked, including private aliases of otherwise permitted blobs. Native CI
also exercises these diagnostics through each packaged CLI's real entrypoint.

Upgrade with `soyli update`, then retry `soyli publish --dry-run`. Existing projects
whose historical context meets the rule need no history cleanup. Optional
`soyli skills update` refreshes the bundled backend guidance; skills alone cannot
fix an older executable's validator. Website and CVM deployment are not required.

**0.23.1 published 2026-09-25:**
[GitHub release](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.23.1),
source `f4df0c76381d75a2ae992e3873e13f1eda5b4a62`.
[Workflow 36174075409](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/36174075409)
passed the source gate and all four native build, installer/updater and fresh-project
backend preview checks. All 11 release assets are public. Installer and manifest
checksums and source revision were verified; a separate macOS ARM64 installation
reports 0.23.1 and doctor reports current. An account-free generated project has
the corrected skills and handler types with one clean initial commit. Local
verification also passed 418 source tests and six browser preview/capture/identity
regressions. The user's installation and website/provider deployment were unchanged.

This patch fixes dynamic-backend authoring and verification discovered
in an independently built multiplayer project. Frozen checks, screenshots, clips
and multiplayer previews include declared backend manifests, handlers and schemas;
missing source reports its path before browser startup. Backend configuration is
portable in `napplet.json`, while generated context and identity bindings stay local.
Fresh setup/build/dev/run regenerates the ignored context.

Multiplayer scenarios gain disposable signed-in viewers and scoped account-consent
helpers. `soyli browser path --json` exposes managed executable paths. Typed handler
context and corrected scaffold/skill guidance preserve existing projects and
clarify ownership, verification and responsive shared editing. Native CI now tests
configured modules through frozen preview paths in addition to compilation.
This patch does not add streams, a new transport or game performance changes.

After updating, restart previews and run `soyli skills update`, reviewing preserved
local edits. Run `soyli backend init` to migrate older locally stored backend
declarations into `napplet.json`, then commit the portable config and module source.
Keep `.napplet-space` ignored. See [backend authoring](DYNAMIC-BACKENDS-CREATOR.md).

**0.23.0 published 2026-09-25:**
[GitHub release](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.23.0),
source `f139962e6173c08c30d880d3385ead44f1717553`.
[Workflow 36159756534](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/36159756534)
passed the source gate and all four native build, installer/updater, fresh-project
browser and backend compiler checks. All 11 release assets are public. The published
manifest identifies the tagged commit; the downloaded macOS ARM64 archive checksum
was verified and its executable reports 0.23.0.

Creator-defined persistent backends through
`soy.backends.v1`, with provider-built source receipts, schemas, release pinning,
scoped account proofs and transactional state. soyLI adds module authoring/check/
deployment commands, local durable preview, the `soy-backends` skill, a portable
guide and frontend helper. Existing projects can run `soyli skills update` after
upgrading. Hosts must enable isolated execution and grant creator deployment access.
The shell adds administrator-managed deployment grants and an accessible tabbed
administration workspace. See [dynamic backends](DYNAMIC-BACKENDS.md).
Native release checks now compile a backend module on every supported platform.
Production activation and live verification are recorded in [dynamic backends](DYNAMIC-BACKENDS.md).

**0.22.0 published 2026-09-24:**
[GitHub release](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.22.0),
source `6132e5504b68e4534dc93585c227a85172b03796`.
[Workflow 35993373395](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/35993373395)
passed the source gate and all four native build, installer/updater and fresh-project
browser checks. All 11 release assets are public. Public installer bytes match
the tagged source, and installer/manifest checksums and source revision were verified.
An isolated macOS ARM64 install reports 0.22.0; `doctor` and `update` report current.
Its account-free starter contains the visual guide and adapted skills in both agent
directories, keeps host matching disabled, and has one clean initial Git commit.
The user's installed CLI was not changed. Website deployment was not performed.

Version 0.22.0 gives new napplets independent visual direction. The starter keeps
its own palette by default instead of automatically adopting the host's colors;
host matching remains an explicit opt-in. The shipped skills and authoring docs
guide creators through a project-specific look for both the game/content and its
UI/HUD, replacing uniform compact-density and whole-surface theming mandates.
See [Visual design](VISUAL-DESIGN.md) for the design brief and theme policies.

After upgrading, run `soyli skills update` inside existing projects and review
preserved-file conflicts. This updates guidance, not source, settings or published
artwork. Existing creations need an intentional theme-handler/style update and
fresh captures before republishing. Upstream pins, licenses and host protocol
behavior remain unchanged. No website deployment is required to update the CLI.

**0.21.0 published 2026-09-24:**
[GitHub release](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.21.0),
source `382fa2f671b5fd9d99bf7812ce8de876a1836e89`.
[Workflow 35976986196](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/35976986196)
passed the source gate, all four native builds, packaged installer/updater tests
and fresh-project browser checks. All 11 release assets are public. The public
installer matches the tagged source; installer/manifest checksums and source
revision were verified. An isolated macOS ARM64 installation reports 0.21.0, with
`doctor` and `update` reporting current. Account-free creation produces one clean
initial commit containing the lockfile and guidance, with neutral attribution.
The user's installed CLI was not changed. Website deployment was not performed.

Version 0.21.0 automatically saves new projects' complete scaffold, lockfile and
agent guidance in a local Git commit before identity or dependency setup. Neutral
soyLI attribution needs no configured Git identity or signing-key access. Existing
projects are not automatically committed, and Git-backed remixes preserve their
original history. Initial staging/commit failures keep the generated files and
surface the Git cause with recovery instructions. Agent guidance encourages
coherent checkpoints before pausing or handing back work.

The shared local preview also gains light/dark/automatic appearance and NAP-THEME
updates. Accompanying website source adds the same appearance controls, Nostr
share-note composition, featured-clip autoplay and faster gallery navigation.
Website deployment is separate from this CLI release. Existing projects can run
`soyli skills update` after upgrading; review any preserved-file conflicts.

**0.20.0 published 2026-09-23:**
[GitHub release](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.20.0),
source `0f3adcb3910460efe620d9ff9b419bb5555192cd`.
[Workflow 35878743238](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/35878743238)
passed its source gate and all four native builds, installer/updater regressions,
shared-data helper checks and fresh-project browser smoke tests. All 11 release
assets are uploaded; the manifest identifies the exact source and four native
targets. The published installer matches the tagged source and checksums. An
isolated macOS ARM64 installation reports 0.20.0; both `doctor` and `update` report
it as current. Website and CVM deployment were not performed with this release.

Version 0.20.0 adds public structured creations using the documented NIP-78
convention, with scoped viewer-authorized writes, ownership/revision checks,
unpublish tombstones and managed helper/guidance files. See
[SHARED-DATA.md](SHARED-DATA.md) for public relay compatibility and retention limits.
It also adds `soy.boards.v2` score attachments, JSON schema validation and per-entry
reads. The local preview runs the same service as the deployed CVM provider.
Publishing failures retain useful causes; CLI validation catches older providers.

The accompanying website source fixes zap invoice compatibility, confirms payments,
closes successful dialogs and updates counts without double-counting later receipts.
Website and CVM deployment remain separate from this CLI release. Existing projects
should restart previews and run `soyli skills update`, reviewing any local conflicts.
CI verifies the delivered app-data helpers on each native release platform.

Version 0.19.0 adds Rust/WASM build recipes and verified Bevy 2D/3D examples in
the existing single-HTML sandbox. See [WASM.md](WASM.md) for supported targets,
prerequisites and limits. Bunker connections now accept up to eight relay hints;
an unresponsive relay no longer delays a request already acknowledged elsewhere.

New NIP-46 sessions use owner-only files outside Git by default. Local private
keys remain in the OS vault. Existing remote sessions retain their storage until
`soyli account storage file` migrates them without re-pairing; use
`--session-storage keychain` to opt new sessions into native storage instead.

Publication follows your selected account. A running operation keeps its starting
account without resetting the shared selection, and each public key retains its
own releases and pending jobs in the same folder. Backend and local-manager
context follow that author. Switching signing methods for the same public key
keeps its listing; switching public keys creates a separate listing and repository.
The bundled agent guidance forbids switching accounts to bypass a publish error.

After updating, restart previews and run `soyli skills update` in existing projects,
reviewing conflicts with locally edited guidance. New account metadata and
multi-author journals are not readable by older CLI versions; use 0.19.0
consistently after migration. Original keys, sessions, source and releases are kept.

Version 0.18.2 fixes preview cleanup on terminal hangup and launcher exit, corrects
the bundled action guide's retired bootstrap instructions, and clarifies agent
preview ownership, mobile checks and reference-harness limitations. Release CI now
checks packaged preview cleanup and runs the assembled starter's complete `verify`
command. After updating, restart previews and run `soyli skills update` in existing
projects; review any reported conflicts without discarding your local edits.

For website deployment, use `bun run deploy` with the usual options, without the
old `bun run cli:release --host … &&` prefix. The optional legacy `cli:release`
uploads four locally built archives to a VPS mirror; it neither triggers GitHub CI
nor downloads CI artifacts. Missing local archives do not block website deployment.

The 0.18.1 installer resolves macOS CPU probes by their system path, including in
minimal environments without `/usr/sbin` on PATH. A failed probe reports the
system error separately from an unsupported processor. Packaged creation and
recording test failures include the CLI diagnostic, and artifact actions use
Node 24. The failed `soyli-v0.18.0` tag is retained; fixes use a new version.
Chromium/FFmpeg installation uses soyLI's checksum-verified managed Node runtime
instead of Bun's Node compatibility layer, which stalled downloads intermittently
on native CI. No separately installed Node is required. Browser availability and
playback still use the same pinned Playwright driver and browser cache.

## For creators

```sh
soyli doctor          # local prerequisites plus latest stable version
soyli update          # download, verify and switch the managed installation
soyli --version
# Restart running preview sessions, then inside an existing project:
soyli skills update
```

An older CLI needs the new installer once, after the first GitHub release exists:

```sh
curl -fsSL https://github.com/zeSchlausKwab/napplet-soy/releases/latest/download/install.sh | sh
```

The same script accepts `new my-napplet` or `remix <link> my-remix`. Inspect it before
executing it if preferred. `https://napplet.soy/install.sh` remains a version-pinned
copy which changes on website deployment; the GitHub URL follows the latest release.

Updates only use stable `soyli-vX.Y.Z` releases from
[zeSchlausKwab/napplet-soy](https://github.com/zeSchlausKwab/napplet-soy/releases).
Prereleases, incomplete platform assets and downgrades are refused. Doctor checks
GitHub with a five-second deadline; no release, offline, malformed or rate-limited
responses are reported as unavailable alongside the working local diagnostics.
`--json` returns the structured release status and sanitized failure context.
There is no background updater, account requirement or credential-store access.

The updater executes the installer already bundled in the installed CLI. Downloads
use HTTPS, SHA-256 verification and an executable-version check before the command
symlink is switched. The whole distribution, including Playwright support files,
is updated together. A failed download/check keeps the working command. Old release
directories, accounts, recovery keys, caches, source and unfinished work are retained.
Checksums detect corrupt downloads; they do not provide an independent publisher
signature. Distribution trust is the GitHub repository/release and HTTPS.

Installer-managed custom paths are remembered. A source checkout should be updated
with Git; manually unpacked distributions must be replaced as a whole or migrated
through the installer. Unrelated commands are never overwritten. The legacy
`napplet-space` alias follows the upgrade only if it belongs to the same installation.
Updates take an installation lock; after an interrupted/killed installer, confirm no
installer is running before removing the reported `.install-lock` directory.

## Cut a release

1. Update `apps/cli/distribution/version.json` and the `version=` line in
   `apps/web/public/install.sh` together. Update relevant feature/release notes.
2. Commit the change and push the commit, then its matching tag:

   ```sh
   git tag -a soyli-v0.23.4 -m 'napplet soyLI 0.23.4'
   git push origin main
   git push origin soyli-v0.23.4
   ```

3. Watch **soyLI releases** in Actions. Publish only after all four native jobs pass.
   The workflow handles publication; no manual asset upload or VPS login is required.
4. Try the published installer and `soyli doctor` on a separate installation. Deploy
   the website separately when its pinned installer/docs should change.

[Workflow](../.github/workflows/soyli-release.yml) triggers on matching tags,
relevant pull requests and manual runs. PRs and manual branch runs only validate;
a manual run on a matching tag may publish/retry that tag. A different tag or
installer version fails before publication. No website deployment is triggered.

The read-only check job typechecks and runs repository tests. A matrix uses native
macOS ARM64/Intel and Ubuntu ARM64/x64 runners with pinned Bun 1.3.11. Each builds
one archive, exercises the real installer/updater, and runs account-free scaffold,
build and browser checks with fresh caches and no global Node/Bun on PATH.
Linux x64 keeps the SSE4.2 baseline runtime. CI does not certify older physical
Macs, mobile gameplay or interactive OS credential-store authorization.

Only the final job has `contents: write`, using the job's automatic `GITHUB_TOKEN`.
No custom token or server secret is needed. Actions are pinned to commit hashes;
checkout does not persist its token. The selected standard runner labels follow
[GitHub's runner documentation](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

The publisher verifies all four checksums before creating a draft. It uploads:

- Four `soyli-<platform>.tar.gz` archives and their `.sha256` files.
- `install.sh`, pinned to that release.
- `release-manifest.json` with source commit and native smoke-test matrix.
- `SHA256SUMS` covering archives, installer and manifest.

Only after the uploads succeed does it publish the draft and mark it latest.
A failed upload leaves a draft that the updater cannot discover; rerunning can
replace draft assets. Published versions cannot be overwritten by this workflow;
corrections need a new version. Release jobs are serialized and refuse to replace
a newer stable version with an older one. Protect release tags and repository write
access as appropriate for the maintainers.

## Local checks and alternate hosting

```sh
bun run check
bun run cli:build --target darwin-arm64
SPACE_TEST_CLI="$PWD/.local/cli/0.23.4/soyli-darwin-arm64/soyli" \
  bun test tests/services/cli-update.test.ts tests/services/cli-distribution.test.ts
```

Choose the matching native target on Linux/Intel. Full build and legacy VPS upload
instructions remain in [CLI.md](CLI.md#building-and-releasing). Existing immutable
VPS download URLs remain valid. An explicitly configured `NAPPLET_DOWNLOAD_BASE`
uses `<base>/<version>/<archive>`; it does not silently fall back to another host.
`NAPPLET_RELEASE_VERSION` pins the bundled installer for the updater; it is not a
CLI downgrade option. `SOYLI_RELEASE_API` is a loopback-only test hook, not an
alternate production update channel.
