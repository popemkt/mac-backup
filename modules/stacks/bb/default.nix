{ lib, ... }:

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
}
