{ lib, ... }:

# AI coding agent toolchain: agent CLIs, desktop apps, orchestrators, and
# local AI service daemons. This file owns the shared stack gate; ./darwin.nix
# and ./nixos.nix are the platform sides.
let
  mkStack = import ../mk-stack.nix lib;
in
{
  options.my.stacks.ai-agents = mkStack {
    description = "AI coding agent toolchain";
  };
}
