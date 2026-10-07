#!/usr/bin/env bash

set -euo pipefail

# path: includes new/unstaged files, unlike a Git flake reference. Anchor to the
# checkout so invocation from another directory checks the same source.
cd "$(dirname "${BASH_SOURCE[0]}")/.."
flake_ref="path:."
targets=("$flake_ref#nodeModules" "$flake_ref#soyli")

# --rebuild needs already-realized outputs. Then bypass cached outputs to catch
# stale fixed-output hashes and non-deterministic package builds.
nix build "${targets[@]}" --no-link --print-build-logs
nix build "${targets[@]}" --no-link --rebuild --print-build-logs
nix flake check "$flake_ref" --print-build-logs
