{ lib, ... }:

# T3 Code: agent harness control surface. This file owns the schema, which
# every platform shares; ./darwin.nix and ./nixos.nix are the platform sides.
let
  mkStack = import ../mk-stack.nix lib;
in
{
  options.my.stacks.t3-code = mkStack {
    description = "T3 Code agent harness control surface";
  };
}
