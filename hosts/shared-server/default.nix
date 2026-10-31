{
  config,
  lib,
  pkgs,
  ...
}:

# Shared server: one NixOS host, two people, both administrators. Each runs
# their own T3 Code server, published on the tailnet. Why it has this shape:
# docs/shared-nixos-server-plan.md#decision.
let
  # A person's kb home store served as the my.services app `kb`, published as
  # svc:kb-<person> on an owner-only socket; why it has this shape is beside
  # the entries below. extraArgs follow the shared `kb ui` arguments.
  kbHome =
    person: extraArgs:
    let
      socket = "/run/kb-${person}/kb.sock";
    in
    {
      app = "kb";
      owner = person;
      inherit socket;
      package = pkgs.kb;
      args = [
        "--root"
        "${config.users.users.${person}.home}/.local/share/kb/home"
        "ui"
        "--socket"
        socket
        "--no-open"
        "--public-origin"
        config.my.stacks.vpn.services."kb-${person}".publicOrigin
      ]
      ++ extraArgs;
    };
in
{
  imports = [
    ./hardware-configuration.nix
    ../../modules/nixos/system
  ];

  # Carried over from the installer configuration.
  boot = {
    loader = {
      systemd-boot = {
        enable = true;
        # A boot-menu entry to test the RAM: a sync flood this often is
        # a failing DIMM or a marginal link until proven otherwise (below).
        memtest86.enable = true;
      };
      efi.canTouchEfiVariables = true;
    };
    kernelPackages = pkgs.linuxPackages_latest;
    # From 2026-10-21 this G14 (GA402RK: a 680M plus an RX 6800S) reset every
    # few minutes, each time an "uncorrected error caused a data fabric sync
    # flood event" (the reset reason the kernel logs at boot). The dGPU's
    # runtime power management is this model's usual trigger, so it stays
    # powered: with it, resets dropped from every few minutes to one in about
    # seven hours. PCIe link power saving (ASPM), the other common AMD
    # trigger, is off too. Neither stopped them: from 2026-10-28 to 10-30 four
    # more resets, each a sync flood, at idle and under load, no panic and no
    # log line before it (a hardware reset leaves nothing for pstore or kdump
    # to save). The two kernel panics efi_pstore did catch (2026-10-16 in
    # tmigr_cpu_deactivate at idle, 2026-10-21 in update_se, both on CPU 6)
    # died in core scheduler/timer code on garbage state, which points at
    # the hardware too: RAM first, then the CPU or its power.
    kernelParams = [
      "amdgpu.runpm=0"
      "pcie_aspm=off"
    ];
  };
  # Records machine checks, PCIe AER and memory errors with timestamps
  # (ras-mc-ctl --errors), so corrected errors before the next flood show up.
  hardware.rasdaemon.enable = true;
  networking.networkmanager.enable = true;
  time.timeZone = "Asia/Ho_Chi_Minh";
  i18n.defaultLocale = "en_US.UTF-8";
  # Set once at install time; it is a compatibility marker, never an upgrade knob.
  system.stateVersion = "26.05";

  # A laptop serving as a server: closing the lid never suspends it, and a
  # short power-key press suspends instead of powering off (a press at
  # 2026-10-24 10:09 shut it down mid-rebuild). Holding the key still forces
  # power-off in firmware.
  services.logind.settings.Login = {
    HandlePowerKey = "suspend";
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
    # Blender, and `blender-mcp` for agents: one headless Blender per MCP
    # session (modules/stacks/blender).
    blender.enable = true;
    # The kb CLI for everyone: agents working in ~/.dotfiles keep its graph.
    kb.enable = true;
    # Sandboxes for agent work, under 8 cores, 12 GiB and 3 at once
    # (the stack's defaults); only popemkt's bb runs them for now
    # (modules/stacks/sandboxes).
    sandboxes = {
      enable = true;
      people = [ "popemkt" ];
    };
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
      # `adhoc <port>` publishes on this host's own tailnet name; tailscaled
      # lets root and one operator do that, and popemkt is the one who does.
      operator = "popemkt";
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

  # Each person's personal kb in the browser, as svc:kb-<person> (kbHome
  # above): their kb home store (kb DESIGN.md → Locations), a root outside
  # any repository that kb ui creates on first start. Not the dotfiles' .kb,
  # which changes only through commits: a live UI there dirtied the checkout
  # with every edit and every kb upgrade's seed nodes, and rebuild refuses a
  # dirty tree. The UI's request guard needs the browser origin, which is
  # that Service's. A request with that Origin acts as the person, so the UI
  # listens on a Unix socket only they and root (tailscaled) can reach, not
  # on a loopback port every account can.
  my.services.kb = kbHome "popemkt" [
    # bb frames the page beside a thread (assets/bb-plugins/kb), and the
    # framed page tells bb its tab session (kb DESIGN.md → Surfaces →
    # Embedding the page). No other page may frame it.
    "--embed-origin"
    config.my.stacks.vpn.services.bb-popemkt.publicOrigin
    # Framed by bb, the page loads bbim's hint bridge from bb itself, so
    # bb's keyboard hints, gi, gs and j/k reach into it and bb's chords
    # typed in it come back (assets/bb-plugins/bbim/core/README.md →
    # Iframes). Needs kb with `--embed-script`.
    "--embed-script"
    "${config.my.stacks.vpn.services.bb-popemkt.publicOrigin}/api/v1/plugins/bbim/http/bridge.js"
  ];
  # bytetum runs no bb, so nothing frames their page.
  my.services.kb-bytetum = kbHome "bytetum" [ ];

  # popemkt's bb server, as svc:bb-popemkt. Its API is unauthenticated and
  # runs commands as popemkt, so the tailnet grant is its access boundary;
  # everyone in my.people here is already root through sudo. BB_APP_URL is
  # the browser origin bb allows and links to.
  #
  # bb runs as two units, so that a server restart never interrupts a
  # thread: app-bb, the server alone, and the companion app-bb-daemon, this
  # machine's host daemon on loopback 38887, which every agent thread here
  # runs under. A thread survives a server restart: the daemon keeps it
  # running, queues its events and reconnects, and the server keeps a thread
  # active across a reconnect from the same daemon process (bb 0.46.1,
  # start-server.js handleHostSessionOpened). So a change to the server's own
  # definition (its command or environment) restarts it within seconds; one
  # to the daemon's waits for idle. The daemon shares the data directory
  # ~/.bb, and with it the machine's identity (host-id and auth.json), so it
  # needs no enrolment. bb-app's launcher used to run both in one process
  # tree; the first switch to this left that running until bb was idle, then
  # started the two units (the companion rule in services.nix).
  #
  # The server accepts only a daemon of its own protocol version, which most
  # bb releases bump. Both units run one pinned copy of bb-app
  # (app-npm-pin), so an npm upgrade, a server crash, or
  # `sudo systemctl restart app-bb` alone keeps the server on the daemon's
  # version. update-npm-globals restarts both together once bb is idle,
  # which moves the copy to the new version. To take an upgrade at once,
  # restart both in one command, which interrupts every thread:
  # `sudo systemctl restart app-bb app-bb-daemon`.
  my.services.bb = {
    owner = "popemkt";
    port = 38886;
    updatedBy.npmGlobal = "bb-app";
    # bb-server has no in-app updates to turn off.
    command = "bb-server --server-port 38886";
    companions.daemon = {
      # bb-host-daemon hands the daemon process what bb-app's launcher did
      # (NODE_ENV, BB_APP_VERSION, BB_CLI_DIR, BB_BRIDGE_DIR, BB_DATA_DIR,
      # BB_HOST_DAEMON_PORT, BB_SERVER_URL: bb-host-daemon.js
      # createDaemonEnv). Without --auto-update it never reinstalls bb over a
      # protocol mismatch; it logs one and keeps retrying.
      command = "bb-host-daemon --server-url ${config.my.services.bb.listenOrigin} --host-daemon-port 38887";
      # The daemon links threads to the app's origin.
      environment.BB_APP_URL = config.my.stacks.vpn.services.bb-popemkt.publicOrigin;
      # A daemon restart cuts every thread on this machine off ("host daemon
      # disconnected"). Neither a rebuild nor an upgrade restarts it until no
      # thread on this machine, hidden ones included, is running a turn, a
      # background agent, a background command, or a workflow. Threads on
      # other machines (the Macs' own daemons) only see the server blink, so
      # they do not count. If bb or the host id cannot answer, it counts as
      # busy.
      # GAP [[01M5P0D3VP9RXH16D7VJV282BT]]: it asks the server, so a daemon
      # the server cannot see (down) never counts as idle.
      idleCheck = ''
        host=$(cat "$HOME/.bb/host-id") && [ -n "$host" ] || exit 1
        bb thread list --include-hidden --json | jq -e --arg host "$host" '
          type == "array" and all(.[] | select(.environmentHostId == $host);
            .status != "active"
            and ([.activity // {} | (.activeBackgroundAgentCount, .activeBackgroundCommandCount, .activeWorkflowCount) // 0] | add) == 0)
        ' >/dev/null
      '';
    };
    # The server's environment; the daemon inherits none of it.
    environment = {
      BB_APP_URL = config.my.stacks.vpn.services.bb-popemkt.publicOrigin;
      # The address bb gives the machines it enrolls (Settings → Machines →
      # Server URL overrides it when set): the same Service, since bb itself
      # listens only on loopback.
      BB_EXTERNAL_URL = config.my.stacks.vpn.services.bb-popemkt.publicOrigin;
      # The kb plugin's defaults (assets/bb-plugins/kb, read by its server
      # side): the kb page its
      # thread panel frames, and kb's owner-only socket, which its agent
      # tools call as popemkt, who owns both servers.
      KB_URL = config.my.stacks.vpn.services.kb-popemkt.publicOrigin;
      KB_SOCKET = config.my.services.kb.socket;
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
