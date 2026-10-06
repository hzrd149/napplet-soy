# Cross-client and standalone release checks

## Current migration scope — 2026-10-04

[NIP-5D PR 7 migration](NIP5D-MIGRATION.md) has a separate real-service/browser fixture in `tests/services/nip5d-migration.test.ts`: directly signed new and legacy manifests, raw artifact verification, saved-state continuity, independent snapshot isolation, icons, required/optional domains and retained pinned revisions. These fixtures are independent of Soy's event builder, but are not an external client implementation.

The pinned Paja 0.16.4 host below consumes the legacy format. The current interoperability runner therefore wraps freshly published Soy HTML in an explicitly legacy manifest built by the pinned upstream builder for that leg, while testing current Soy publication/source/Git separately. Do not infer PR 7 support by Paja or another external client from a passing legacy check. The dated 0.14.1 evidence below remains historical.

Verified locally on **2026-09-20** for soyLI **0.14.1**, then published with website
release `20260920084527457-12824`. The cross-client checks below use disposable
identities and loopback Khatru, Blossom and GRASP services. Separate
[deployment evidence](DEPLOYMENT.md#soyli-0141-and-workshop-release--2026-09-20)
records the public installer, downloads, website and protocol health checks.

## Independent host and publisher

| Component                    | Version / revision                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Independent host             | [`@kehto/paja`](https://github.com/kehto/web) 0.16.4, dependencies pinned in the test fixture lockfile                                |
| Upstream manifest builder    | [`napplet/web` 956135b](https://github.com/napplet/web/tree/956135bfc41a2cff5e45d6c68d9f9a4d68c50531), `packages/cli/src/manifest.ts` |
| Ordinary Nostr Git transport | ngit / git-remote-nostr 2.1.0                                                                                                         |
| Soy host / starter           | Existing shim 0.30.0 and maintained boilerplate pins; see [compatibility](COMPATIBILITY.md)                                           |

`tests/services/interoperability.test.ts` checks:

1. A normal soyLI publication, including its source and external PNG, is discovered
   from its Nostr address by Paja's resolver. Paja verifies and loads it using its
   own unchanged browser host. The sandbox decodes the Blossom image and receives
   configuration defaults from the shipped starter settings code.
2. Independently authored HTML is uploaded with signed BUD-02 authorization.
   Upstream publishing code constructs its aggregate and root, named and snapshot
   manifests. Each resolves, remixes and runs in Soy's shared preview host, including
   runtime schema registration and a working counter. No Soy source archive,
   presentation descriptor, preview image or branded identifier is supplied.
3. A signed manifest with an incorrect aggregate is rejected before preview.
4. A second creator remixes and proposes a real Git commit with soyLI. Ordinary
   `git ls-remote` and `git clone` through the installed `git-remote-nostr` discover
   and fetch the original history and proposed commit. Its ancestry is intact.

The first run exposed a real configuration mismatch: our example only subscribed
after an embedded schema, while Paja returned `config.schemaError: no-schema`.
The 0.14.1 example now registers the same schema when the host's `config.schema`
is absent. It preserves a host-supplied schema and optional CSS defaults. This
uses NAP-CONFIG without changing the manifest, host protocol or upstream SDK.

Run from the repository with Git, ngit, Chromium and the local service build
prerequisites installed:

```sh
bun scripts/interop.ts
# Exercise a locally built standalone publisher instead of the source CLI:
SPACE_TEST_CLI="$PWD/.local/cli/0.14.1/soyli-darwin-arm64/soyli" bun scripts/interop.ts
```

The runner downloads pinned upstream tooling into ignored `.local/interoperability`,
keeps it outside application dependencies, and leaves screenshots under `evidence/`.
An existing upstream checkout must be clean and at the pinned revision. The test
can also use explicit `SOY_INTEROP_PAJA` and `SOY_INTEROP_UPSTREAM` paths; without
both, it is skipped rather than pretending independent acceptance ran.

This is not a full upstream CLI publishing session or a ngit review/merge UI test.
The reverse fixture uses upstream manifest-builder functions and a direct BUD-02
upload. Paja's pointer runner proves address resolution and playback, not inclusion
in a separate public gallery. Paja uses permissive test ACLs; production consent,
all NAP operations, CONFIG schema edge cases and arbitrary game behavior need their
own acceptance. No public relay receives the fixture events.

## Standalone platforms and workshop

`scripts/cli-platform-smoke.sh /absolute/path/to/soyli` creates a disposable project
with fresh managed Node/pnpm and Chromium caches, removes Bun/Node from PATH,
typechecks and builds the maintained starter, runs the host check, lists assets and
destinations, and creates a local Git checkpoint. It creates no signing identity
and publishes nothing. Network access is needed for managed dependency downloads.

Native macOS ARM64 additionally runs the packaged installer, capture, upstream
starter/configuration and fresh-clone asset/workshop checks. The integrated browser
workshop check covers metadata editing, diff/checkpoint, failed publication/retry,
a contributor's playable proposal, Original/Proposed comparison, local merge and
separate release, including a 390 px layout.

Platform evidence must distinguish Linux ARM64 in a VM/container, Linux x64 under
emulation and macOS x64 under Rosetta from native Intel hardware. Rosetta emits a
Bun AVX warning even when the workflow passes. These checks do not qualify the old
Intel Mac's OS, CPU, Keychain or codec behavior. Native Intel Mac acceptance and a
nontechnical human workshop walkthrough remain open. The release evidence file
records exactly which archive/platform combinations passed.
