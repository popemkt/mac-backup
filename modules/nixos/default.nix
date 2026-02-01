{ config, pkgs, lib, ... }:

{
  # ============================================================================
  # NIXOS-SPECIFIC HOME-MANAGER SETTINGS
  # ============================================================================

  # Linux-specific shell additions
  programs.zsh.shellAliases = {
    # Nix rebuild alias (nixos-specific)
    rebuild = "sudo nixos-rebuild switch --flake ~/.dotfiles";
  };

  programs.zsh.initExtra = lib.mkAfter ''
    # ========================================
    # LINUX-SPECIFIC SHELL CONFIG
    # ========================================

    # Add any Linux-specific shell setup here
  '';

  # Linux-specific packages
  home.packages = with pkgs; [
    # Uncomment as needed:
    # alacritty      # Terminal (instead of iTerm2)
    # xclip          # Clipboard support
    # xdg-utils      # XDG utilities
  ];
}
