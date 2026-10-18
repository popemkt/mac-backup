{
  config,
  lib,
  pkgs,
  ...
}:

# kb: the repo knowledge-graph CLI, and an optional browser UI serving one
# graph. This file owns the schema and the CLI, which every platform shares;
# ./darwin.nix and ./nixos.nix are the platform sides.
let
  mkStack = import ../mk-stack.nix lib;
  cfg = config.my.stacks.kb;
in
{
  options.my.stacks.kb = mkStack {
    description = "Knowledge graph CLI and browser UI";
    componentOptions.server = lib.mkOption {
      default = { };
      description = "A supervised browser UI serving one graph.";
      type = lib.types.submodule (
        { config, ... }:
        {
          options = {
            enable = lib.mkEnableOption "the kb browser UI service";
            root = lib.mkOption {
              type = lib.types.str;
              description = "Absolute graph checkout path (containing .kb/). The platform side defaults it.";
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
    my.everyone = {
      home.packages = [ pkgs.kb ];

      # The merge driver `.gitattributes` names for kb node stores, declared
      # with kb by its store path so it exists exactly when kb does: git that
      # finds no driver program marks the store conflicted but keeps only one
      # side's nodes, with no markers.
      programs.git.settings.merge.kb-jsonl = {
        name = "kb node store (three-way by node id)";
        driver = "${lib.getExe pkgs.kb} merge-jsonl %O %A %B %P";
      };
    };
  };
}
