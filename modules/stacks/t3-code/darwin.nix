{ config, lib, ... }:

# T3 Code on macOS: the desktop app, which runs its own local server.
# The headless servers a NixOS host runs are ./nixos.nix.
let
  mkStack = import ../mk-stack.nix lib;
in
{
  options.my.stacks.t3-code = mkStack {
    description = "T3 Code agent harness control surface (desktop app)";
  };

  config = lib.mkIf config.my.stacks.t3-code.enable {
    # Official cask.
    my.pkgs.casks = [ "t3-code" ];
  };
}
