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
  # Agents driven through T3 Code run as their person and cannot answer a
  # password prompt, so sudo needs none here. This makes anything an agent
  # runs able to become root.
  security.sudo.wheelNeedsPassword = false;
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
    # The kb CLI for everyone: agents working in ~/.dotfiles keep its graph.
    kb.enable = true;
    t3-code = {
      enable = true;
      instances = {
        popemkt.port = 3773;
        bytetum.port = 3774;
      };
    };
    vpn = {
      enable = true;
      tags = [ "tag:shared-server" ];
      # Each T3 Code server gets its own HTTPS name on the tailnet.
      services =
        lib.mapAttrs' (
          name: instance: lib.nameValuePair "t3-${name}" { target = instance.listenOrigin; }
        ) config.my.stacks.t3-code.instances
        // {
          # popemkt's endpoint for temporary HTTP apps: whatever listens on
          # 127.0.0.1:9001 is reachable at https://adhoc-popemkt.<tailnet>.
          adhoc-popemkt.target = "http://127.0.0.1:9001";
        };
    };
  };

  # popemkt's kb graph (the .kb store in their dotfiles checkout) in the
  # browser, as svc:kb-popemkt. The UI's request guard needs the browser
  # origin, which is that Service's.
  my.services.kb = {
    owner = "popemkt";
    port = 4321;
    command = lib.escapeShellArgs [
      "kb"
      "--root"
      "/home/popemkt/.dotfiles"
      "ui"
      "--port"
      "4321"
      "--no-open"
      "--public-origin"
      config.my.stacks.vpn.services.kb-popemkt.publicOrigin
    ];
  };

  # The work Mac's T3 Code, relayed to loopback so agents here can sign in to
  # its MCP: OAuth refuses plain HTTP off loopback, and T3 names its endpoints
  # after the host it is reached on.
  systemd.services.t3-work-relay = {
    description = "Relay 127.0.0.1:3790 to popemkt-work's T3 Code";
    wantedBy = [ "multi-user.target" ];
    after = [ "tailscaled.service" ];
    serviceConfig = {
      ExecStart = "${pkgs.socat}/bin/socat TCP-LISTEN:3790,bind=127.0.0.1,fork,reuseaddr TCP:popemkt-work.taild98079.ts.net:3773";
      DynamicUser = true;
      Restart = "always";
      RestartSec = 5;
    };
  };
}
