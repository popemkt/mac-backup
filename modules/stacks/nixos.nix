_:

# The stacks a NixOS host can enable: the shared index plus the NixOS side of
# the shared stacks.
{
  imports = [
    ./default.nix
    ./t3-code/nixos.nix
    ./vpn/nixos.nix
  ];
}
