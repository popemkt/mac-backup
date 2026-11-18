_:

{
  imports = [
    (import ../../options/package-executors.nix [
      "home"
      "darwinHome"
    ])
    ./agent-plugins
    ./git.nix
    ./packages.nix
    ./npm-global.nix
    ./bb-plugins
    ./mcp-servers
    ./shell.nix
    ./neovim.nix
    ./claude-code.nix
  ];
}
