{ config, lib, ... }:

# T3 Code on macOS: the desktop app, which runs its own local server.
let
  cfg = config.my.stacks.t3-code;
in
{
  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.instances == { };
        message = "my.stacks.t3-code.instances are headless servers for a NixOS host; on macOS the T3 Code app runs its own server.";
      }
    ];

    # Official cask.
    my.pkgs.casks = [ "t3-code" ];
  };
}
