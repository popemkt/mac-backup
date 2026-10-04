{
  config,
  lib,
  pkgs,
  ...
}:

let
  mkStack = import ../mk-stack.nix lib;
  cfg = config.my.stacks.kb;
  inherit (config.my) username;
in
{
  imports = [
    ./server.nix
    ./system-setup.nix
  ];

  options.my.stacks.kb = mkStack {
    description = "Knowledge graph CLI and browser UI";
    componentOptions.server = lib.mkOption {
      default = { };
      description = "A supervised browser UI serving one graph.";
      type = lib.types.submodule (
        { config, ... }: {
          options = {
            enable = lib.mkEnableOption "the kb browser UI service";
            root = lib.mkOption {
              type = lib.types.str;
              default = "/Users/${username}/.dotfiles";
              description = "Absolute graph checkout path (containing .kb/).";
            };
            port = lib.mkOption {
              type = lib.types.port;
              default = 9000;
              description = "Loopback port for the kb browser UI.";
            };
            listenOrigin = lib.mkOption {
              type = lib.types.str;
              readOnly = true;
              default = "http://127.0.0.1:${toString config.port}";
              description = "Local origin the UI listens on; use as the proxy target.";
            };
            publicOrigin = lib.mkOption {
              type = lib.types.nullOr (lib.types.strMatching "https?://[^/?#@]+");
              default = null;
              description = "Canonical HTTP(S) browser origin (no trailing slash), passed to the UI request guard.";
            };
          };
        }
      );
    };
  };

  config = lib.mkIf cfg.enable {
    home-manager.users.${username}.home.packages = [ pkgs.kb ];
  };
}
