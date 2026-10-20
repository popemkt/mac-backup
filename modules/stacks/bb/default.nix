{ config, lib, ... }:

# bb (get-bb/bb): an agent IDE whose server drives the provider CLIs already
# signed in on the machine. This file owns the schema every platform shares;
# ./darwin.nix and ./nixos.nix are the platform sides. A server a host runs
# for someone is placement, declared with `my.services` on that host.
let
  mkStack = import ../mk-stack.nix lib;
in
{
  options.my.stacks.bb = mkStack {
    description = "bb agent IDE";
  };

  config = lib.mkIf config.my.stacks.bb.enable {
    # The repo's own bb plugins, installed in place from each person's
    # checkout by modules/common/home-manager/bb-plugins.nix.
    my.pkgs.bbPlugins = [
      # What shapes a thread's agent, and Claude Code's own view of its
      # workspace: the `Agent artifacts` panel tab and `bb artifacts`.
      "assets/bb-plugins/agent-artifacts"
    ];
  };
}
