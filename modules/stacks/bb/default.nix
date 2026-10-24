{ config, lib, ... }:

# bb (get-bb/bb): an agent IDE whose server drives the provider CLIs already
# signed in on the machine. This file owns the schema every platform shares;
# ./darwin.nix and ./nixos.nix are the platform sides. A server a host runs
# for someone is placement, declared with `my.services` on that host.
let
  mkStack = import ../mk-stack.nix lib;
in
{
  options.my.stacks.bb = mkStack {
    description = "bb agent IDE";
  };

  config = lib.mkIf config.my.stacks.bb.enable {
    # The repo's own bb plugins, installed in place from each person's
    # checkout by modules/common/home-manager/bb-plugins.nix.
    my.pkgs.bbPlugins = [
      # What shapes a thread's agent, and Claude Code's own view of its
      # workspace: the `Agent artifacts` panel tab and `bb artifacts`.
      "assets/bb-plugins/agent-artifacts"
      # Quick, subtle motion for bb on any theme (press, rows rising in,
      # menu springs, send and status pulses), honouring reduced motion,
      # plus the optional Lively palettes.
      "assets/bb-plugins/bb-lively"
      # Vim-style keyboard navigation of bb: link hints (alt+f, f),
      # j/k/gg/G scrolling, gi to the composer.
      "assets/bb-plugins/bbim"
      # The `Canvases` panel tab: tldraw canvases linked to a thread, its
      # project, or everything, read through each machine's `canvas-link`
      # (modules/stacks/ai-agents/canvas-links).
      "assets/bb-plugins/canvas-links"
      # The Context composer page: what feeds a thread's agent, with
      # token weights; keep, drop or add, a trajectory side chat, and
      # spawn with the composition. Reads the inventory through
      # agent-artifacts; `bb composer`.
      "assets/bb-plugins/context-composer"
      # The person's kb beside a thread, and agent tools (kb_call,
      # kb_screen, kb_manifest) that act in that kb tab. Its page URL and
      # socket come from the bb server's KB_URL and KB_SOCKET, set where
      # a host places both.
      "assets/bb-plugins/kb"
      # Threads a host daemon restart or lost connection interrupted get a
      # short continuation message, at most 3 in a row per thread.
      "assets/bb-plugins/restart-resume"
    ];

    # No anonymous usage telemetry (PostHog) from any bb server or host
    # daemon: the desktop app's and a bb-app's alike. bb reads its managed
    # env, ~/.bb/env.json (`bb-app env`), over the process environment, so
    # the key is merged there; `bb-app env set` keeps working for the rest.
    my.everyone =
      { lib, pkgs, ... }:
      {
        home.activation.bbTelemetryOff = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
          env_file="$HOME/.bb/env.json"
          $DRY_RUN_CMD mkdir -p "$HOME/.bb"
          [ -s "$env_file" ] || $DRY_RUN_CMD sh -c 'umask 077; echo "{}" > "$1"' _ "$env_file"
          if [ -z "''${DRY_RUN_CMD:-}" ]; then
            tmp="$(mktemp)"
            ${lib.getExe pkgs.jq} '.env = ((.env // {}) + {BB_TELEMETRY: "false"})' "$env_file" > "$tmp"
            command cat "$tmp" > "$env_file"
            rm -f "$tmp"
          fi
        '';
      };
  };
}
