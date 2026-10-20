{ config, lib, ... }:

# bb on macOS: the desktop app, which runs its own local server.
{
  config = lib.mkIf config.my.stacks.bb.enable {
    # Official cask.
    my.pkgs.casks = [ "bb" ];
  };
}
