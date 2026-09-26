{ config, lib, ... }:

# Intent layer: vertical slices grouped by functionality, not by install
# channel. Each stack declares WHAT belongs to a capability and tags it
# into channel lists (my.pkgs.*); executors handle HOW to install.
#
# A stack is either a single file (office-docs.nix) or a folder with a
# default.nix plus sibling modules (ai-agents/) when it grows config,
# services, or per-tool files.
{
  imports = [
    ./ai-agents
    ./browsers
    ./office-docs.nix
    ./vpn
  ];

  # Every stack's `extra.*` (declared by mk-stack.nix) folds into the channel
  # of the same name while the stack is enabled.
  config.my.pkgs = lib.mkMerge (
    map (stack: lib.mkIf stack.enable stack.extra) (lib.attrValues config.my.stacks)
  );
}
