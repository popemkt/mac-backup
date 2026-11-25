_:

# The stacks a NixOS host can enable: the shared index plus the NixOS side of
# the shared stacks.
{
  imports = [
    ./default.nix
    ./ai-agents/nixos.nix
    ./bb/nixos.nix
    ./blender
    ./kb/nixos.nix
    ./mcp-edge
    ./monitoring
    ./ntfy
    ./pull-deploy
    ./sandboxes
    ./t3-code/nixos.nix
    ./vpn/nixos.nix
  ];
}
