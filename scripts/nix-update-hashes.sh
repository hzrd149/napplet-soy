#!/usr/bin/env bash

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
package_file="nix/package.nix"
target="path:.#nodeModules"
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

# Match the exact dependency derivation, not a failed Bun download or another
# nested fetcher. Never convert unrelated build/evaluation errors into a hash.
drv=$(nix eval --raw "$target.drvPath")
build_target() {
  local status
  echo "Checking $target ${*}"
  if nix build "$target" --no-link --print-build-logs "$@" >"$tmp_dir/build.log" 2>&1; then
    cat "$tmp_dir/build.log"
    return 0
  else
    status=$?
  fi
  cat "$tmp_dir/build.log" >&2
  if ! grep -Fq "hash mismatch in fixed-output derivation '$drv'" "$tmp_dir/build.log"; then
    echo "Could not refresh $target (nix build exit $status). Fix the reported cause; no hash was changed." >&2
    exit "$status"
  fi
  return 1
}

if build_target && build_target --rebuild; then
  echo "$target hash is current"
else
  # Nix can repeat the same error; accept duplicates, not conflicting hashes.
  hash=$(sed -nE 's/^[[:space:]]*got:[[:space:]]+(sha256-[A-Za-z0-9+\/=]+)[[:space:]]*$/\1/p' "$tmp_dir/build.log" | sort -u)
  if [[ ! "$hash" =~ ^sha256-[A-Za-z0-9+/]{43}=$ ]]; then
    echo "Expected one SHA-256 mismatch for $target; no hash was changed." >&2
    exit 1
  fi
  matches=$(grep -Ec '^[[:space:]]*outputHash = "sha256-[^"]+";' "$package_file" || true)
  if [[ "$matches" -ne 1 ]]; then
    echo "Expected exactly one outputHash in $package_file, found $matches; no hash was changed." >&2
    exit 1
  fi
  sed -i -E "s|^([[:space:]]*outputHash = )\"sha256-[^\"]+\";|\1\"${hash}\";|" "$package_file"
  echo "Updated nodeModules outputHash to $hash in $package_file"
fi

# A changed hash is not verified until all package and module checks pass.
bash scripts/nix-check.sh
