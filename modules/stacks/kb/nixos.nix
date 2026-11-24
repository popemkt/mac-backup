{
  config,
  lib,
  pkgs,
  ...
}:

# NixOS side of the kb stack. The CLI comes from the shared ./default.nix.
# The stores a host serves are `stores` (the single-person `server`
# component is macOS-only): each is a my.services app run as its owner, and,
# with `capture`, a second one that takes captures from phones, which
# `kb-pair` pairs.
let
  inherit (lib) mkOption mkEnableOption types;
  cfg = config.my.stacks.kb;
  inherit (config.users) users;
  publicOrigin = service: config.my.stacks.vpn.services.${service}.publicOrigin;

  # A store's apps, keyed by my.services entry, each published as
  # svc:<app>-<owner> from an owner-only socket. The UI is `app = "kb"`: a
  # request carrying its Origin acts as the owner. The capture listener,
  # `app = "kb-capture"` on the entry `<name>-capture`, is `kb ui
  # --capture-only` on the same root: it admits only capture version
  # discovery, pairing with a code from `kb-pair`, and delivery with the
  # bearer token pairing returns (kb DESIGN.md → Raw capture).
  storeApps =
    name: store:
    let
      app =
        kind: args:
        let
          socket = "/run/${kind}-${store.owner}/kb.sock";
        in
        {
          app = kind;
          inherit (store) owner;
          inherit socket;
          package = pkgs.kb;
          args = [
            "--root"
            store.root
            "ui"
          ]
          ++ args
          ++ [
            "--socket"
            socket
            "--no-open"
            "--public-origin"
            (publicOrigin "${kind}-${store.owner}")
          ];
        };
      ui = app "kb" [ ];
    in
    {
      ${name} = ui // {
        args = ui.args ++ store.uiArgs;
      };
    }
    // lib.optionalAttrs store.capture.enable {
      "${name}-capture" = app "kb-capture" [ "--capture-only" ];
    };

  # What kb-pair knows of each store with a capture listener, by the name of
  # the store's UI Service (kb-<owner>).
  captureStores = lib.mapAttrs' (
    _: store:
    lib.nameValuePair "kb-${store.owner}" {
      inherit (store) owner root;
      url = publicOrigin "kb-capture-${store.owner}";
    }
  ) (lib.filterAttrs (_: store: store.capture.enable) cfg.stores);
  kbPair = pkgs.writeShellApplication {
    name = "kb-pair";
    runtimeInputs = [ pkgs.jq ];
    text = builtins.readFile ./kb-pair.sh;
    runtimeEnv = {
      KB = lib.getExe pkgs.kb;
      STORES = pkgs.writeText "kb-pair-stores.json" (builtins.toJSON captureStores);
    };
  };
in
{
  # A store's MCP behind the OAuth edge (`remoteMcp`).
  imports = [ ./remote-mcp.nix ];

  # The served stores' part of the stack's schema, declared with its only
  # reader: my.services runs native apps on NixOS only.
  options.my.stacks.kb = mkOption {
    type = types.submodule {
      options.stores = mkOption {
        default = { };
        example = {
          kb.owner = "popemkt";
          kb-bytetum.owner = "bytetum";
        };
        description = ''
          kb stores this host serves in the browser, keyed by the my.services
          entry of each store's UI (unit `app-<name>`). A store is one
          person's: its UI runs as its owner, on the owner-only socket
          `/run/kb-<owner>/kb.sock`, published as svc:kb-<owner>, so each
          person serves at most one.
        '';
        type = types.attrsOf (
          types.submodule (
            { config, ... }:
            {
              options = {
                owner = mkOption {
                  type = types.str;
                  example = "popemkt";
                  description = "Person the store's servers run as; one of the host's `my.people`.";
                };
                root = mkOption {
                  type = types.str;
                  default = "${users.${config.owner}.home}/.local/share/kb/home";
                  defaultText = lib.literalExpression ''"''${home}/.local/share/kb/home"'';
                  description = ''
                    Absolute path of the root served (the directory holding
                    .kb/): by default the owner's kb home store (kb DESIGN.md →
                    Locations), a root outside any repository that `kb ui`
                    creates on first start. Never a repository's committed
                    .kb, which changes through commits, not a live UI.
                  '';
                };
                capture.enable = mkEnableOption ''
                  a capture-only listener beside the UI, for phones (kb's
                  Android app): `kb ui --capture-only` on the same root, as
                  the owner, published as svc:kb-capture-<owner>. Pair a phone
                  with `kb-pair`; the Service still needs its grant and
                  auto-approver in configs/tailscale/policy.hujson
                '';
                uiArgs = mkOption {
                  type = types.listOf types.str;
                  default = [ ];
                  example = [
                    "--embed-origin"
                    "https://bb-popemkt.example-tailnet.ts.net"
                  ];
                  description = ''
                    Further `kb ui` arguments, after the root, socket and
                    public origin the stack passes.
                  '';
                };
                remoteMcp = {
                  enable = mkEnableOption ''
                    kb's MCP on this store behind the OAuth edge
                    (my.stacks.mcp-edge; docs/mcp-edge.md): `kb mcp --listen`
                    in a sandboxed unit, `kb-remote`, as the edge's identity
                    `kb-edge`, which sees only this store. At most one store
                  '';
                  emails = mkOption {
                    type = types.listOf types.str;
                    default = [ ];
                    example = [ "owner@gmail.com" ];
                    description = ''
                      Verified Google addresses whose tokens reach this
                      store's MCP. Declared in the host file.
                    '';
                  };
                  package = mkOption {
                    type = types.package;
                    default = pkgs.kb;
                    defaultText = lib.literalExpression "pkgs.kb";
                    description = ''
                      The kb the unit runs, as `<main program> --root <root>
                      mcp --listen unix:<socket>`. Needs a kb with
                      `mcp --listen` (popemkt/kb, feat/mcp-listen).
                    '';
                  };
                };
              };
            }
          )
        );
      };
    };
  };

  config = {
    # GAP [[01M52TVK8YAZDN3R8V0CB99GSW]] kb.server has no NixOS side.
    assertions = [
      {
        assertion = !(cfg.enable && cfg.server.enable);
        message = "my.stacks.kb.server has no NixOS implementation yet; serve a store with my.stacks.kb.stores.";
      }
      {
        assertion = cfg.stores == { } || cfg.enable;
        message = "my.stacks.kb.stores (${toString (lib.attrNames cfg.stores)}) needs my.stacks.kb.enable.";
      }
    ];

    my.services = lib.mkIf cfg.enable (lib.concatMapAttrs storeApps cfg.stores);
    environment.systemPackages = lib.mkIf (cfg.enable && captureStores != { }) [ kbPair ];

    # kb's render tests drive Playwright's prebuilt Chromium, through nix-ld.
    my.pkgs.nixLdLibraries = lib.mkIf cfg.enable (import ../prebuilt-chromium-libraries.nix);
  };
}
