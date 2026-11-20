{
  config,
  lib,
  pkgs,
  ...
}:

# NixOS side of the kb stack. The CLI comes from the shared ./default.nix.
# The stores a host serves are `stores`, each a my.services app run as its
# owner: the single-person `server` component is macOS-only.
let
  inherit (lib) mkOption types;
  cfg = config.my.stacks.kb;
  inherit (config.users) users;
  publicOrigin = service: config.my.stacks.vpn.services.${service}.publicOrigin;

  # A store's apps, keyed by my.services entry. The UI is `app = "kb"`, so it
  # is published as svc:kb-<owner>; it listens on an owner-only socket,
  # because a request carrying the UI's Origin acts as the owner.
  storeApps =
    name: store:
    let
      socket = "/run/kb-${store.owner}/kb.sock";
    in
    {
      ${name} = {
        app = "kb";
        inherit (store) owner;
        inherit socket;
        package = pkgs.kb;
        args = [
          "--root"
          store.root
          "ui"
          "--socket"
          socket
          "--no-open"
          "--public-origin"
          (publicOrigin "kb-${store.owner}")
        ]
        ++ store.uiArgs;
      };
    };
in
{
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

    # kb's render tests drive Playwright's prebuilt Chromium, through nix-ld.
    my.pkgs.nixLdLibraries = lib.mkIf cfg.enable (import ../prebuilt-chromium-libraries.nix);
  };
}
