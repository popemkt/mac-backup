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
  # `ntfy-publish` for one server: its socket is fixed, the token is read
  # from a file (./publish.sh).
  publisher =
    name: server:
    pkgs.writeShellApplication {
      name = if name == "ntfy" then "ntfy-publish" else "ntfy-publish-${name}";
      runtimeInputs = [
        pkgs.curl
        pkgs.coreutils
      ];
      runtimeEnv.NTFY_SOCKET = server.socket;
      text = builtins.readFile ./publish.sh;
    };
in
{
  options.my.stacks.ntfy = (import ../mk-stack.nix lib) {
    description = "ntfy notification servers";
    componentOptions = {
      servers = mkOption {
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
      publishers = mkOption {
        readOnly = true;
        default = lib.mapAttrs (
          name: server:
          let
            tokenFile = "${config.users.users.${server.owner}.home}/.config/ntfy/token";
          in
          {
            package = publisher name server;
            inherit tokenFile;
            # What a system unit that publishes adds to its own definition.
            # It runs as root, the one account besides the owner that can open
            # the owner-only socket, and gets the owner's host token as the
            # credential `ntfy-token` (LoadCredential=, read by PID 1), so no
            # permission on the socket or the token is widened. Until the owner
            # has run ntfy-setup there is no token, and the unit is skipped,
            # not failed.
            unitConfig.ConditionPathExists = tokenFile;
            serviceConfig.LoadCredential = [ "ntfy-token:${tokenFile}" ];
          }
        ) servers;
        defaultText = lib.literalMD "derived from `servers`";
        description = ''
          How to publish to each server, by its entry: `package`, whose
          `ntfy-publish` (`ntfy-publish-<entry>` for any entry but `ntfy`) takes
          the message on stdin; and the `unitConfig` and `serviceConfig` a
          system unit merges in to run it with the owner's token. Derived even
          while the stack is off, for tests that stand in for the server.
        '';
      };
    };
  };

  config = lib.mkIf cfg.enable {
    my.services = lib.mapAttrs (_: placement) servers;
    environment.systemPackages =
      lib.optional (servers != { }) setup
      ++ map (p: p.package) (lib.attrValues config.my.stacks.ntfy.publishers);
  };
}
