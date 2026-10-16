_:

# Linux-specific Home Manager settings, for every user of a NixOS host.
{
  # Build as the repository's owner and activate as root: plain `sudo
  # nixos-rebuild` makes root read a repository it does not own.
  programs.zsh.shellAliases.rebuild = "nixos-rebuild switch --flake ~/.dotfiles --sudo";
}
