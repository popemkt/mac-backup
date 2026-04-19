{ ... }:

{
  imports = [
    ./external-data.nix
    ./git.nix
    ./packages.nix
    ./npm-global.nix
    ./shell.nix
    ./neovim.nix
  ];
}
