_:

# The stacks a macOS host can enable: the shared index plus the stacks that
# are still macOS-only, and the macOS side of the shared ones.
{
  imports = [
    ./default.nix
    ./ai-agents/darwin.nix
    ./bb/darwin.nix
    ./browsers
    ./kb/darwin.nix
    ./local-proxy
    ./office-docs.nix
    ./t3-code/darwin.nix
    ./vpn/darwin.nix
  ];
}
