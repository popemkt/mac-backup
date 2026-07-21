{
  config,
  pkgs,
  lib,
  ...
}:

let
  inherit (config.my) username;
  headroomPort = "8787";

  # Declarative uv tool installs owned by the Headroom service boundary.
  #
  # Audited by scripts/audit-system-discrepancies.sh (anchor: uvTools).
  #
  # [all] enables every compression algorithm (hnswlib, torch, HuggingFace).
  # Requires SDKROOT set for native extension builds.
  uvTools = [
    "headroom-ai[all]"
  ];
in
lib.mkIf config.my.stacks.ai-agents.enable {
  # RTK applies the same context-budget principle to shell output. Keep the
  # Homebrew formula in this behavior module so Headroom tooling is restored as
  # one unit and Homebrew can follow RTK's frequent upstream releases.
  my.pkgs.brews = [ "rtk" ];

  # Headroom proxy endpoint, exposed to all apps. Apps opt in by routing their
  # provider base_url here (e.g. package.json `*:proxy` scripts read
  # HEADROOM_PROXY). NOT setting ANTHROPIC_BASE_URL/OPENAI_BASE_URL globally on
  # purpose; that would force-route every client through the proxy and break
  # them if the daemon is down.
  launchd.user.envVariables = {
    HEADROOM_PROXY = "http://localhost:${headroomPort}";
    HEADROOM_PORT = headroomPort;
  };

  # Headroom context-compression proxy - always-on user daemon. KeepAlive
  # retries until the uv tool install lands on a fresh machine.
  launchd.user.agents.headroom-proxy = {
    serviceConfig = {
      ProgramArguments = [
        "/Users/${username}/.local/bin/headroom"
        "proxy"
        "--port"
        headroomPort
      ];
      RunAtLoad = true;
      KeepAlive = true;
      StandardOutPath = "/Users/${username}/Library/Logs/headroom-proxy.out.log";
      StandardErrorPath = "/Users/${username}/Library/Logs/headroom-proxy.err.log";
      EnvironmentVariables = {
        PATH = "/Users/${username}/.local/bin:${pkgs.uv}/bin:/usr/bin:/bin:/usr/sbin:/sbin";
      };
    };
  };

  home-manager.users.${username} =
    { lib, ... }:
    {
      # Install Headroom during activation for cross-machine bootstrap. Only
      # installs tools that are missing; never force-reinstalls or upgrades.
      home.activation.installHeadroomUvTools = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        # CLT-only macOS doesn't set SDKROOT; without it clang can't find C/C++
        # headers and packages with native extensions can fail to build.
        export SDKROOT="$(xcrun --sdk macosx --show-sdk-path 2>/dev/null || true)"

        for spec in ${lib.concatStringsSep " " (map lib.escapeShellArg uvTools)}; do
          name="''${spec%%==*}"
          name="''${name%%[*}"
          if ! ${pkgs.uv}/bin/uv tool list 2>/dev/null | ${pkgs.gnugrep}/bin/grep -q "^$name "; then
            $DRY_RUN_CMD ${pkgs.uv}/bin/uv tool install --python ${pkgs.python3}/bin/python3 "$spec"
          fi
        done
      '';

      # Keep Claude Code on RTK's current native hook command. RTK performs an
      # idempotent merge into settings.json, preserving the other agent hooks.
      home.activation.ensureRtkClaudeHook = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        if [ -x /opt/homebrew/bin/rtk ]; then
          $DRY_RUN_CMD /opt/homebrew/bin/rtk init -g --auto-patch
        fi
      '';
    };
}
