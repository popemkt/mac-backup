{ config, lib, ... }:

# T3 Code on macOS: the desktop app, which runs its own local server.
{
  config = lib.mkIf config.my.stacks.t3-code.enable {
    # Official cask.
    my.pkgs.casks = [ "t3-code" ];
  };
}
