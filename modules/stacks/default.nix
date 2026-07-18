_:

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
    ./office-docs.nix
    ./vpn
  ];
}
