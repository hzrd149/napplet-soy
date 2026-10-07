# soyLI with Nix

The repository is a Nix flake that builds soyLI from source for `x86_64-linux` and
`aarch64-linux`. macOS is not packaged yet: it needs the separate Playwright
compatibility build that the release archives ship for older Macs. Use the
[installer](CLI.md#requirements-and-storage) there.

```sh
nix run github:zeSchlausKwab/napplet-soy -- new my-napplet
nix profile install github:zeSchlausKwab/napplet-soy
```

## NixOS

```nix
{
  inputs.soyli.url = "github:zeSchlausKwab/napplet-soy";

  outputs = { nixpkgs, soyli, ... }: {
    nixosConfigurations.my-host = nixpkgs.lib.nixosSystem {
      modules = [
        soyli.nixosModules.default
        { programs.soyli.enable = true; }
      ];
    };
  };
}
```

| Option                          | Default       | Effect                                                                                                                                     |
| ------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `programs.soyli.enable`         | `false`       | Installs `soyli` (and the legacy `napplet-space` alias) system-wide.                                                                       |
| `programs.soyli.package`        | flake package | The soyLI package to install.                                                                                                              |
| `programs.soyli.keyring.enable` | `true`        | Enables GNOME Keyring as the Secret Service used for local private keys. Disable it when another provider such as KeePassXC is configured. |

The module adds no service. Without a desktop session, local private keys need an
unlocked Secret Service on a D-Bus session bus. Remote-signer file sessions need
neither, and `SOYLI_DANGEROUS_PLAINTEXT_KEYS=1` remains the explicit development
fallback. `overlays.default` provides `pkgs.soyli` for other configurations.

## What differs from the release archive

The package compiles `apps/cli` with the same pinned Bun 1.3.11 and embedded preview
as the release build, with `--distribution nix`. The executable and its `lib/`
support files live in the store. The `soyli` wrapper supplies:

- **Project toolchain:** `SOYLI_NODE` and `SOYLI_PNPM` point at nixpkgs Node and the
  pinned pnpm tarball, so nothing is downloaded or extracted at runtime. The Node
  version is still checked against `apps/cli/vendor/toolchain.json`. The writable
  toolchain cache (`~/.cache/napplet-space/toolchains`) holds only the pnpm link
  and Rust helper tools.
- **Browser:** `PLAYWRIGHT_BROWSERS_PATH` defaults to nixpkgs' Playwright Chromium
  for the same Playwright version. `soyli run test:conformance` checks the
  project's own Playwright driver and reuses its compatible headless Chromium
  and FFmpeg without running the installer or writing into the store. A missing
  or mismatched browser reports `CONFORMANCE_BROWSER` before the project script
  starts. Update the flake/package and rebuild, align the project's Playwright
  version, or set `PLAYWRIGHT_BROWSERS_PATH` to an existing compatible cache.
  Nix builds never auto-download browsers for this command. Ordinary release
  installations still download missing compatible browsers automatically.
- **Credentials:** libsecret and glib are on the loader path that `Bun.secrets` uses.
  soyLI restores the caller's `LD_LIBRARY_PATH` for the programs it starts
  (Git, browser openers, coturn), so they do not inherit those libraries.
- **Git:** nixpkgs Git is appended to `PATH` as a fallback; a Git already on `PATH`
  is preferred.

`soyli update` refuses with `UPDATE_INSTALLATION` and points to the flake input or
profile instead; `soyli doctor` still reports the latest published release. Update
with `nix flake update soyli` and a rebuild, or `nix profile upgrade`.

The contributor reported a closure of about 1.5 GiB, mostly Chromium and its
headless shell. Its size varies with the pinned dependencies. The release archive
would otherwise download these browsers on first use.

## Maintaining the package

The build intentionally fails when nixpkgs drifts from the CLI's pins:
`nodejs_24` must equal the Node pin in `toolchain.json`, and `playwright-driver`
must equal `@playwright/test`. Update the pins and nixpkgs together.

`soyli-node-modules` is a fixed-output derivation of `bun install` over the
manifests and `bun.lock`. The pinned Bun 1.3.11 can intermittently omit the
`browserslist` executable link inside its cyclic peer dependency,
`update-browserslist-db` ([upstream issue](https://github.com/oven-sh/bun/issues/30209)).
The build restores that link after checking its installed target, keeping the
expected dependency hash unchanged. Remove this workaround once the Bun pin
includes the upstream fix.

After any dependency change, rebuild it and copy the reported hash into
`nix/package.nix`:

```sh
nix build .#nodeModules   # prints "got: sha256-…" on a mismatch
```

Changing the Bun pin in `package.json` also needs the two Bun release hashes in
`nix/package.nix` (`nix store prefetch-file <url>`).

```sh
nix build .#soyli && ./result/bin/soyli doctor
nix flake check   # package and the NixOS VM test (x86_64-linux, needs KVM)
```

The VM test (`nix/test.nix`) checks offline doctor, the Nix-managed update refusal,
the shell's browser check and the actual upstream `soyli run test:conformance`
command with packaged Chromium, actionable recovery for an incompatible browser
cache, setup and scripts with the store toolchain, and an account key stored
through GNOME Keyring. The upstream fixture is assembled from pinned npm
archives at build time; the VM needs no network access and creates no browser
cache. The `soyLI Nix` GitHub workflow runs these checks on Linux for changes to
packaging, dependency pins, CLI code or its bundled preview.
