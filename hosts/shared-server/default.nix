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
    # From 2026-10-21 this G14 (GA402RK: a 680M plus an RX 6800S) reset every
    # few minutes, each time an "uncorrected error caused a data fabric sync
    # flood event" (the reset reason the kernel logs at boot). The dGPU's
    # runtime power management is this model's usual trigger, so it stays
    # powered: with it, resets dropped from every few minutes to one in about
    # seven hours. PCIe link power saving (ASPM), the other common AMD
    # trigger, is off too.
    kernelParams = [
      "amdgpu.runpm=0"
      "pcie_aspm=off"
    ];
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
    bb.enable = true;
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
      # Each person logs in as themselves over Tailscale SSH
      # (configs/tailscale/policy.hujson); there is no sshd.
      ssh = true;
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

  # Vulkan sees only the 680M iGPU (1002:1681), so Chromium's WebGPU and
  # WebGL render there: ANGLE otherwise picks the RX 6800S dGPU, which was
  # implicated in this machine's data fabric sync flood resets. Mesa's
  # device_select layer reads it; `!` hides every other device.
  environment.sessionVariables.MESA_VK_DEVICE_SELECT = "1002:1681!";

  # popemkt's personal kb in the browser, as svc:kb-popemkt: their kb home
  # store (kb DESIGN.md → Locations), a root outside any repository that
  # kb ui creates on first start. Not the dotfiles' .kb, which changes only
  # through commits: a live UI there dirtied the checkout with every edit
  # and every kb upgrade's seed nodes, and rebuild refuses a dirty tree.
  # The UI's request guard needs the browser
  # origin, which is that Service's. A request with that Origin acts as
  # popemkt, so the UI listens on a Unix socket only popemkt and root
  # (tailscaled) can reach, not on a loopback port every account can.
  # GAP [[01M5HXHNERZR77Z0HX0SZCQZPP]]: a socket server writes no
  # .kb/ui.json, so the CLI's and MCP's ui.* calls see no tabs; their graph
  # reads and writes, and the page's live view of them, are unaffected.
  my.services.kb = {
    owner = "popemkt";
    socket = "/run/kb-popemkt/kb.sock";
    package = pkgs.kb;
    args = [
      "--root"
      "${config.users.users.popemkt.home}/.local/share/kb/home"
      "ui"
      "--socket"
      config.my.services.kb.socket
      "--no-open"
      "--public-origin"
      config.my.stacks.vpn.services.kb-popemkt.publicOrigin
    ];
  };

  # popemkt's bb server, as svc:bb-popemkt. Its API is unauthenticated and
  # runs commands as popemkt, so the tailnet grant is its access boundary;
  # everyone in my.people here is already root through sudo. BB_APP_URL is
  # the browser origin bb allows and links to; its co-located host daemon
  # stays on loopback 38887.
  my.services.bb = {
    owner = "popemkt";
    port = 38886;
    # bb-app tracks npm's latest release; update-npm-globals restarts it.
    updatedBy.npmGlobal = "bb-app";
    executable = "bb-app";
    args = [
      "--server-port"
      "38886"
      "--host-daemon-port"
      "38887"
      "--no-in-app-updates"
    ];
    environment = {
      BB_APP_URL = config.my.stacks.vpn.services.bb-popemkt.publicOrigin;
      # The address bb gives the machines it enrolls (Settings → Machines →
      # Server URL overrides it when set): the same Service, since bb itself
      # listens only on loopback.
      BB_EXTERNAL_URL = config.my.stacks.vpn.services.bb-popemkt.publicOrigin;
    };
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
