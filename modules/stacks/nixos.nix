_:

# The stacks a NixOS host can enable: the shared index plus the NixOS side of
# the shared stacks.
{
  imports = [
    ./default.nix
    ./bb/nixos.nix
    ./blender
    ./kb/nixos.nix
    ./t3-code/nixos.nix
    ./vpn/nixos.nix
  ];
}
