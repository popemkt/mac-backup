{ config, lib, ... }:

# Intent layer: vertical slices grouped by functionality, not by install
# channel. Each stack declares WHAT belongs to a capability and tags it
# into channel lists (my.pkgs.*); executors handle HOW to install.
#
# A stack is either a single file (office-docs.nix) or a folder with a
# default.nix plus sibling modules (ai-agents/) when it grows config,
# services, or per-tool files.
#
# This file is the part every platform shares: the stacks whose schema is
# platform-neutral, and the `extra.*` fold. A platform index (./darwin.nix,
# ./nixos.nix) imports it and adds that platform's stacks and service
# implementations. A stack moves here when its schema stops naming one
# platform.
{
  imports = [
    ./vpn
  ];

  # Every stack's `extra.*` (declared by mk-stack.nix) folds into the channel
  # of the same name while the stack is enabled.
  config.my.pkgs = lib.mkMerge (
    map (stack: lib.mkIf stack.enable stack.extra) (lib.attrValues config.my.stacks)
  );
}
