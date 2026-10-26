{ config, lib, ... }:

# bb on macOS: the desktop app, which runs its own local server.
let
  cfg = config.my.stacks.bb;
in
{
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
