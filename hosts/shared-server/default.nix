{
  config,
  lib,
  pkgs,
  ...
}:

# Shared server: one NixOS host, two people, both administrators. Each runs
# their own T3 Code server, published on the tailnet. Why it has this shape:
# docs/shared-nixos-server-plan.md#decision.
{
  imports = [
    ./hardware-configuration.nix
    ../../modules/nixos/system
  ];

  # Carried over from the installer configuration.
  boot = {
    loader = {
      systemd-boot.enable = true;
      efi.canTouchEfiVariables = true;
    };
    kernelPackages = pkgs.linuxPackages_latest;
  };
  networking.networkmanager.enable = true;
  time.timeZone = "Asia/Ho_Chi_Minh";
  i18n.defaultLocale = "en_US.UTF-8";
  # Set once at install time; it is a compatibility marker, never an upgrade knob.
  system.stateVersion = "26.05";

  # A laptop serving as a server: closing the lid never suspends it.
  services.logind.settings.Login = {
    HandleLidSwitch = "ignore";
    HandleLidSwitchExternalPower = "ignore";
    HandleLidSwitchDocked = "ignore";
  };

  # Keep the installer's desktop (Plasma, sound, printing, Firefox): the screen
  # is the local way in, and a switch never restarts the display manager, so
  # one run from a desktop terminal survives activation.
  services = {
    xserver = {
      enable = true;
      xkb.layout = "us";
    };
    displayManager.sddm.enable = true;
    desktopManager.plasma6.enable = true;
    printing.enable = true;
    pulseaudio.enable = false;
    pipewire = {
      enable = true;
      alsa.enable = true;
      pulse.enable = true;
    };
  };
  security.rtkit.enable = true;
  programs.firefox.enable = true;

  # Passwords are machine state (scripts/shared-server-secrets), never declared.
  my.people = [
    "popemkt"
    "bytetum"
  ];
  users.users = lib.genAttrs config.my.people (_: {
    extraGroups = [
      "networkmanager"
      "wheel"
    ];
  });

  my.stacks = {
    t3-code = {
      enable = true;
      instances = {
        popemkt.port = 3773;
        bytetum.port = 3774;
      };
    };
    vpn = {
      enable = true;
      # Each T3 Code server gets its own HTTPS name on the tailnet.
      services = lib.mapAttrs' (
        name: instance: lib.nameValuePair "t3-${name}" { target = instance.listenOrigin; }
      ) config.my.stacks.t3-code.instances;
    };
  };
}
