self:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.programs.soyli;
in
{
  options.programs.soyli = {
    enable = lib.mkEnableOption "soyLI, the napplet.soy creator CLI";

    package = lib.mkPackageOption self.packages.${pkgs.stdenv.hostPlatform.system} "soyli" { };

    keyring.enable = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        Whether to enable GNOME Keyring as the Secret Service provider that soyLI
        uses to store account keys. Disable this when another Secret Service
        provider (for example KeePassXC) is configured, or when keys are stored
        in plaintext files with {env}`SOYLI_DANGEROUS_PLAINTEXT_KEYS=1`.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    environment.systemPackages = [ cfg.package ];
    services.gnome.gnome-keyring.enable = lib.mkIf cfg.keyring.enable (lib.mkDefault true);
  };
}
