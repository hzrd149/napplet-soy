# Minimal browser fixture for the real upstream command, not a replacement
# conformance implementation. All packages are prepared outside the offline VM.
{
  pkgs,
  soyli,
}:
let
  toolchain = builtins.fromJSON (builtins.readFile ../apps/cli/vendor/toolchain.json);
  playwrightVersion =
    (builtins.fromJSON (builtins.readFile ../package.json)).devDependencies."@playwright/test";
  conformanceCli = pkgs.fetchurl {
    url = "https://registry.npmjs.org/@napplet/conformance-cli/-/conformance-cli-0.2.15.tgz";
    hash = "sha256-15ELn4EAbAC1FMIZYepXY8RARRDl5kVg3xmg+6rMaM8=";
  };
  conformance = pkgs.fetchurl {
    url = "https://registry.npmjs.org/@napplet/conformance/-/conformance-0.13.0.tgz";
    hash = "sha256-0m2UPuVCPn0yNK1JKWBWZ9QH7ga4BAOOUXUCK+P134s=";
  };
  core = pkgs.fetchurl {
    url = "https://registry.npmjs.org/@napplet/core/-/core-0.28.0.tgz";
    hash = "sha256-gS2S9fH5JulSxaWc3NGypFvwNW6bAls2ZqXsMN9oQpo=";
  };
  package = pkgs.writeText "conformance-package.json" (builtins.toJSON {
    name = "conformance-fixture";
    private = true;
    packageManager = "pnpm@${toolchain.pnpm.version}";
    scripts."test:conformance" = "node node_modules/@napplet/conformance-cli/dist/cli.js ./dist --ready-timeout 15000";
  });
in
pkgs.runCommand "soyli-conformance-fixture" { } ''
  mkdir -p "$out/node_modules/@napplet" "$out/dist"
  for entry in "conformance-cli:${conformanceCli}" "conformance:${conformance}" "core:${core}"; do
    name="''${entry%%:*}"
    archive="''${entry#*:}"
    mkdir -p "$out/node_modules/@napplet/$name"
    tar -xzf "$archive" --strip-components=1 -C "$out/node_modules/@napplet/$name"
  done
  ln -s ${soyli.passthru.nodeModules}/node_modules/.bun/playwright@${playwrightVersion}/node_modules/playwright "$out/node_modules/playwright"
  # Bun keeps this dependency beside Playwright in its virtual store. Keep both
  # at project level so dereferencing this fixture into the VM preserves imports.
  ln -s ${soyli.passthru.nodeModules}/node_modules/.bun/playwright-core@${playwrightVersion}/node_modules/playwright-core "$out/node_modules/playwright-core"
  # The project already has its dependencies; soyLI should not run pnpm install.
  touch "$out/node_modules/.modules.yaml"
  cp ${package} "$out/package.json"
  printf '<!doctype html><title>Nix fixture</title><p>hi</p>' > "$out/dist/index.html"
''
