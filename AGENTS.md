# Project working context

If a local `AGENDA.md` exists, read it before planning relevant product work. It is
private and Git-ignored: keep it local, do not stage it or copy its roadmap into
public documentation. Public checkouts can use README.md and the relevant feature
documents; the agenda is optional, never a setup or contribution requirement.
[PLAN.md](PLAN.md) is historical design context and may contain superseded status.

Keep any local agenda current with stable IDs, decisions, remaining scope and
verification evidence. Distinguish implemented, verified and deployed. Update public
feature documents for changes to implemented behavior and limits. Do not mark a
feature complete merely because its foundation exists.

Before changing protocol-facing behavior, read [docs/PROTOCOL.md](docs/PROTOCOL.md)
and [docs/NAP-REVIEW.md](docs/NAP-REVIEW.md). Keep the user's selected NIP-5D proposal
authoritative, record compatible upstream pins, and treat all publishers equally.
Optional Space presentation and source metadata must not become playback requirements.

An agenda entry records future work; it is not an instruction to implement every
item or deploy. Follow the current user request for scope and deployment authorization.

## Nix package validation

Before pushing changes to Nix inputs, dependency manifests/lockfiles, CLI code,
shared packages, embedded creator guides or bundled preview assets, run `bun run check:nix` (or
`bash scripts/nix-check.sh`, without Bun). This realizes and force-rebuilds
`nodeModules` and `soyli`, then runs `nix flake check`, including the NixOS VM
regressions on x86_64 Linux (requires KVM). It uses `path:.` to include new files.
Run `bun run update:nix-hashes` after a dependency hash mismatch; it only updates
the exact `nodeModules` output hash and reruns the full check. Review the diff
before committing. Bun download hashes and Node/Playwright pins remain explicit;
see [docs/NIX.md](docs/NIX.md#maintaining-the-package).

## CLI error handling

soyLI wraps tools and services: failures must preserve an actionable cause.
Use `packages/diagnostics/src` at terminal/JSON/local-UI boundaries, and attach
operation, tool exit status or service status, target and recovery context where
available. Preserve causes when wrapping; do not replace them with a generic
failure or silently ignore a required step. Successful optional fallbacks can be
quiet, but exhausted alternatives must retain their failure reasons.

Do not log raw argument, environment, request or credential dumps. Credential-store
exceptions may contain secrets: expose the operation and safe OS codes only.
Test wrapped failures through a real entrypoint/process, including the useful
cause and redaction, rather than only asserting that an error occurred.
See [docs/CLI-ERRORS.md](docs/CLI-ERRORS.md) for the implemented contract and bounds.
