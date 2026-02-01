{ config, pkgs, username, ... }:

{
  # ============================================================================
  # NIX SETTINGS
  # ============================================================================

  nix.settings.experimental-features = [ "nix-command" "flakes" ];

  # Allow unfree packages
  nixpkgs.config.allowUnfree = true;

  # ============================================================================
  # BOOT (Uncomment and configure for your system)
  # ============================================================================

  # boot.loader.systemd-boot.enable = true;
  # boot.loader.efi.canTouchEfiVariables = true;

  # ============================================================================
  # NETWORKING
  # ============================================================================

  # networking.hostName = "nixos";  # Set your hostname
  # networking.networkmanager.enable = true;

  # ============================================================================
  # LOCALIZATION
  # ============================================================================

  time.timeZone = "Asia/Ho_Chi_Minh";  # Change to your timezone

  i18n.defaultLocale = "en_US.UTF-8";

  # ============================================================================
  # USERS
  # ============================================================================

  users.users.${username} = {
    isNormalUser = true;
    description = username;
    extraGroups = [ "networkmanager" "wheel" "docker" ];
    shell = pkgs.zsh;
  };

  programs.zsh.enable = true;

  # ============================================================================
  # SYSTEM PACKAGES
  # ============================================================================

  environment.systemPackages = with pkgs; [
    vim
    git
    curl
    wget
  ];

  # ============================================================================
  # SERVICES (Uncomment as needed)
  # ============================================================================

  # Enable OpenSSH
  # services.openssh.enable = true;

  # Enable Docker
  # virtualisation.docker.enable = true;

  # ============================================================================
  # DESKTOP ENVIRONMENT (Uncomment one)
  # ============================================================================

  # GNOME
  # services.xserver.enable = true;
  # services.xserver.displayManager.gdm.enable = true;
  # services.xserver.desktopManager.gnome.enable = true;

  # KDE Plasma
  # services.xserver.enable = true;
  # services.displayManager.sddm.enable = true;
  # services.desktopManager.plasma6.enable = true;

  # ============================================================================
  # SYSTEM STATE VERSION
  # ============================================================================

  # Don't change this after initial install
  system.stateVersion = "24.05";
}
