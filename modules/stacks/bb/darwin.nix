{ config, lib, ... }:

# bb on macOS: the desktop app, which runs its own local server.
let
  cfg = config.my.stacks.bb;
in
{
  # The desktop app's part of the stack's schema, declared with its only
  # reader: NixOS hosts run bb-app, which has no desktop to start.
  options.my.stacks.bb = lib.mkOption {
    type = lib.types.submodule {
      options.desktopSwitches = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        # HTML-in-Canvas, which bb-lively's Control preset draws its
        # effects with (assets/bb-plugins/bb-lively/ART-DIRECTION.md#control).
        default = [ "--enable-blink-features=CanvasDrawElement" ];
        description = ''
          Chromium switches the bb desktop app starts with when opened
          through `bb Launcher` (or `bb-launch`), installed when the list is
          not empty. A Dock or Spotlight launch of bb itself still starts it
          without them; the launcher then offers to restart it.
        '';
      };
    };
  };

  config = lib.mkIf cfg.enable {
    # Official cask.
    my.pkgs.casks = [ "bb" ];

    # `bb Launcher` (~/Applications/Home Manager Apps) and `bb-launch`: bb
    # with `desktopSwitches`, which it has no setting for (./launcher.nix).
    my.everyone = lib.mkIf (cfg.desktopSwitches != [ ]) (
      { pkgs, ... }:
      {
        home.packages = [ (pkgs.callPackage ./launcher.nix { switches = cfg.desktopSwitches; }) ];
      }
    );
  };
}
