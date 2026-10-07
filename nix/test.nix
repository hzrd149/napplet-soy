{ self }:
let
  version = (builtins.fromJSON (builtins.readFile ../apps/cli/distribution/version.json)).version;
  toolchain = builtins.fromJSON (builtins.readFile ../apps/cli/vendor/toolchain.json);
in
{
  name = "soyli-module";

  nodes.machine =
    { pkgs, ... }:
    {
      imports = [ self.nixosModules.default ];


      programs.soyli.enable = true;

      users.users.alice = {
        isNormalUser = true;
        uid = 1000;
      };

      environment.systemPackages = [ pkgs.dbus ];
      environment.etc = {
        # A real upstream runner and its protocol dependency, fetched only at
        # build time. The VM is offline, without installing project dependencies.
        "soyli-conformance".source = import ./conformance-fixture.nix {
          inherit pkgs;
          soyli = self.packages.${pkgs.stdenv.hostPlatform.system}.soyli;
        };
        "soyli-missing-browsers/placeholder".text = "";
        "soyli-fixtures/mini/napplet.json".text = builtins.toJSON {
          schema = "space-local-project/v1";
          name = "Nix fixture";
          entry = "index.html";
          previewId = "8c0f6a52-6f6e-4c39-9e55-2c1f5b3b9a11";
          license = "MIT";
        };
        "soyli-fixtures/mini/index.html".text = "<!doctype html><title>Nix fixture</title><p>hi</p>";
        "soyli-fixtures/mini/LICENSE".text = "MIT";
        "soyli-fixtures/tool/package.json".text = builtins.toJSON {
          name = "tool-fixture";
          private = true;
          packageManager = "pnpm@${toolchain.pnpm.version}";
          scripts.hello = "node -p process.version";
        };
      };
      virtualisation.memorySize = 4096;
      virtualisation.cores = 2;
    };

  testScript = ''
    import json
    import shlex

    def alice(command):
        return machine.succeed(f"su - alice -c {shlex.quote(command)}")

    machine.wait_for_unit("multi-user.target")

    with subtest("installed command"):
        assert alice("soyli --version").strip() == "soyli ${version}"
        assert alice("napplet-space --version").strip() == "soyli ${version}"

    with subtest("update is left to Nix"):
        out = machine.fail("su - alice -c 'soyli update 2>&1'")
        assert "managed by nix" in out, out
        assert "nix flake update" in out, out

    with subtest("doctor works offline"):
        out = alice("soyli doctor")
        assert "browser: ready" in out, out
        assert "git: ready" in out, out

    with subtest("conformance check uses the packaged Chromium"):
        alice("cp -rL /etc/soyli-fixtures/mini /etc/soyli-fixtures/tool . && chmod -R u+w mini tool")
        # soyLI allows the page 10 s to load; one retry absorbs a slow, loaded VM.
        for attempt in range(2):
            status, out = machine.execute("su - alice -c 'cd mini && soyli check --json 2>&1'")
            if status == 0:
                break
        assert status == 0 and '"status":"checked"' in out.replace(" ", ""), out
        alice("test ! -e ~/.cache/napplet-space/browsers")

    with subtest("upstream conformance reuses packaged browsers without installing"):
        alice("cp -rL /etc/soyli-conformance ./conformance && chmod -R u+w conformance")
        out = alice("cd conformance && soyli run test:conformance 2>&1")
        assert "RESULT: CONFORMANT" in out, out
        alice("test ! -e ~/.cache/napplet-space/browsers")

    with subtest("incompatible browser cache fails before any installer"):
        out = machine.fail("su - alice -c 'cd conformance && PLAYWRIGHT_BROWSERS_PATH=/etc/soyli-missing-browsers soyli run test:conformance --json'")
        error = json.loads(out)["error"]
        assert error["code"] == "CONFORMANCE_BROWSER", out
        assert error["operation"] == "prepare conformance browser", out
        assert "chromium-headless-shell" in "\n".join(error["details"]), out
        assert "Nix" in error["recovery"] and "PLAYWRIGHT_BROWSERS_PATH" in error["recovery"], out
        assert "No browser installer was run" in error["recovery"], out
        machine.succeed("test ! -e /etc/soyli-missing-browsers/.links && test ! -e /etc/soyli-missing-browsers/__dirlock")
        alice("test ! -e ~/.cache/napplet-space/browsers")

    with subtest("project toolchain comes from the Nix store"):
        alice("cd tool && soyli setup")
        out = alice("cd tool && soyli run hello 2>&1")
        assert "v${toolchain.node.version}" in out, out
        # Only the writable pnpm link directory; nothing was downloaded.
        out = alice("ls ~/.cache/napplet-space/toolchains")
        assert out.split() == ["bin-${toolchain.node.version}-${toolchain.pnpm.version}-linux-x64-provided"], out

    with subtest("account keys are stored in the Secret Service"):
        out = alice(
            "dbus-run-session -- sh -c '"
            "echo -n test | gnome-keyring-daemon --unlock --components=secrets >/dev/null"
            " && soyli account create --network local --json"
            " && soyli account show --network local --json'"
        )
        assert '"keychain"' in out, out
  '';
}
