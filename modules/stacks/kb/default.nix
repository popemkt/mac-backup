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
    componentOptions.mcp = lib.mkOption {
      default = { };
      description = ''
        `kb mcp` on the server's store (`server.root`), registered with every
        agent harness on the host (my.pkgs.mcpServers), so agents reach that
        store out of the box. kb serialises writers on the store, so the MCP
        server and the UI share it safely.
      '';
      type = lib.types.submodule {
        options = {
          enable = lib.mkEnableOption "registering kb's MCP server on the server's store with every agent";
          name = lib.mkOption {
            type = lib.types.strMatching "[A-Za-z0-9_-]+";
            default = "kb-home";
            example = "kb-work";
            description = ''
              The MCP server's name in every harness. Not `kb`: a repository's
              own .mcp.json names its committed store `kb`, which would shadow
              this one there.
            '';
          };
        };
      };
    };
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
              description = ''
                Absolute path of the root the UI serves (the directory holding
                .kb/). The platform side defaults it to the person's kb home
                store, a root outside any repository; a repository's committed
                .kb changes through commits, not a live UI.
              '';
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
              description = ''
                kb's public address (no trailing slash): admitted by the UI
                request guard, and the address links that leave the page name
                (calendar backlinks, the OAuth redirect URI).
              '';
            };
            embedOrigins = lib.mkOption {
              type = lib.types.listOf (lib.types.strMatching "https?://[^/?#@]+");
              default = [ ];
              example = [ "https://bb-popemkt.example-tailnet.ts.net" ];
              description = ''
                Pages allowed to frame the UI (`kb ui --embed-origin`, kb
                DESIGN.md → Surfaces → Embedding the page), such as a bb
                server whose kb plugin (assets/bb-plugins/kb) shows this
                store beside a thread. Empty: no page may frame it.
              '';
            };
            aliasOrigins = lib.mkOption {
              type = lib.types.attrsOf (lib.types.strMatching "https?://[^/?#@]+");
              default = { };
              example = {
                local = "https://kb.localhost";
              };
              description = ''
                Other browser origins a proxy serves the same UI at (no
                trailing slash), each admitted by the request guard exactly as
                the public origin is. Never kb's address: links keep
                publicOrigin. Each name keys the alias's readiness check,
                `kb-ui-<name>`, so a host can make it depend on whatever
                serves that address.
              '';
            };
          };
        }
      );
    };
  };

  config = lib.mkIf cfg.enable {
    # kb's agent skill, from the pinned package (share/kb/skills), linked into
    # every agent's skills; skipped until a kb release ships that folder.
    my.pkgs.agentSkills = [ "kb=${pkgs.kb}/share/kb/skills" ];

    my.pkgs.mcpServers = lib.mkIf cfg.mcp.enable {
      ${cfg.mcp.name} = {
        command = lib.getExe pkgs.kb;
        args = [
          "--root"
          cfg.server.root
          "mcp"
        ];
      };
    };

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
