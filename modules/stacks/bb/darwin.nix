{
  config,
  lib,
  pkgs,
  ...
}:

# bb on macOS: the desktop app, which runs its own local server, and the
# typefaces bb's pages name.
#
# A page's fonts resolve on the machine that draws it, so they are installed
# where bb is viewed: the Macs, whether the page comes from the local server
# or from shared-server's. The NixOS side installs none: its bb server only
# serves pages, and the headless Chromium agents drive there is for the
# pages under test, not bb's own.
{
  config = lib.mkIf config.my.stacks.bb.enable {
    # Official cask.
    my.pkgs.casks = [ "bb" ];

    # The faces bb-lively's Cloudbank preset names
    # (assets/bb-plugins/bb-lively/core/src/domain/presets.ts): Jost
    # (nixpkgs' build of its upstream release) for reading, Josefin Sans for
    # lettering, and Federant for its planned display face; without them it
    # falls back to Avenir Next and Futura.
    fonts.packages = [
      pkgs.jost
      (import ./fonts.nix { inherit pkgs lib; })
    ];
  };
}
