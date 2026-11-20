{
  config,
  lib,
  pkgs,
  ...
}:
let
  inherit (lib) mkOption types;
  cfg = config.my.stacks.ntfy;
  placement = import ./placement.nix {
    inherit pkgs;
    image = pkgs.ntfy-image;
  };
  servers = lib.mapAttrs (name: { owner, expose }: {
    inherit owner expose;
    socket = "/run/${name}/ntfy.sock";
    baseUrl =
      if expose then config.my.stacks.vpn.services."ntfy-${owner}".publicOrigin else "http://localhost";
  }) cfg.servers;
  setup = pkgs.writeShellApplication {
    name = "ntfy-setup";
    runtimeInputs = [
      config.virtualisation.podman.package
      pkgs.jq
      pkgs.curl
      pkgs.util-linux
    ];
    runtimeEnv.SERVERS = pkgs.writeText "ntfy-servers.json" (builtins.toJSON servers);
    text = builtins.readFile ./setup.sh;
  };
in
{
  options.my.stacks.ntfy = (import ../mk-stack.nix lib) {
    description = "ntfy notification servers";
    componentOptions.servers = mkOption {
      default = { };
      description = "One ntfy server per owner, keyed by its my.services entry.";
      type = types.attrsOf (
        types.submodule {
          options = {
            owner = mkOption {
              type = types.str;
              description = "Account that runs this ntfy server.";
            };
            expose = lib.mkEnableOption "tailnet exposure for this ntfy server";
          };
        }
      );
    };
  };

  config = lib.mkIf cfg.enable {
    my.services = lib.mapAttrs (_: placement) servers;
    environment.systemPackages = lib.optional (servers != { }) setup;
  };
}
