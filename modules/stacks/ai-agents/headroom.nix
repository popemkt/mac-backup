{
  config,
  pkgs,
  lib,
  ...
}:

let
  inherit (config.my) username;
  headroomPort = "8787";
  headroomVersion = config.my.uvPins."headroom-ai".version;
  headroomPython = "/Users/${username}/.local/share/uv/tools/headroom-ai/bin/python";

  # Declarative uv tool installs owned by the Headroom service boundary.
  # Contributed to my.pkgs.uvTools below so drift and update checks can read
  # the pin; the install itself stays here because it needs SDKROOT.
  #
  # [all] enables every compression algorithm (hnswlib, torch, HuggingFace).
  uvTools = [
    "headroom-ai[all]==${headroomVersion}"
  ];
in
lib.mkIf config.my.stacks.ai-agents.enable {
  # RTK applies the same context-budget principle to shell output. Keep the
  # Homebrew formula in this behavior module so Headroom tooling is restored as
  # one unit and Homebrew can follow RTK's frequent upstream releases.
  my.pkgs = {
    brews = [ "rtk" ];
    inherit uvTools;
  };

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
        "/bin/zsh"
        "-l"
        "-c"
        "exec /Users/${username}/.local/bin/headroom proxy --port ${headroomPort}"
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
      # Reconcile both the pinned package and its interpreter. uv keeps the
      # dependency environment isolated, while Nix owns the Python version.
      home.activation.installHeadroomUvTools = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        # CLT-only macOS doesn't set SDKROOT; without it clang can't find C/C++
        # headers and packages with native extensions can fail to build.
        # Prefer Apple's toolchain over any Nix clang/ar on PATH — maturin/cc-rs
        # need a matching ar next to /usr/bin/clang (litellm's rust bridge).
        export SDKROOT="$(xcrun --sdk macosx --show-sdk-path 2>/dev/null || true)"
        export PATH="/usr/bin:/bin:$PATH"
        export CC=/usr/bin/clang
        export CXX=/usr/bin/clang++
        export AR=/usr/bin/ar
        export RANLIB=/usr/bin/ranlib
        export CARGO_TARGET_AARCH64_APPLE_DARWIN_LINKER=/usr/bin/clang

        for spec in ${lib.concatStringsSep " " (map lib.escapeShellArg uvTools)}; do
          name="''${spec%%==*}"
          name="''${name%%[*}"
          if ! ${pkgs.uv}/bin/uv tool list 2>/dev/null \
              | ${pkgs.gnugrep}/bin/grep -q "^$name v${headroomVersion}$" \
            || [[ ! -x "${headroomPython}" ]] \
            || [[ "$("${headroomPython}" -c 'import platform; print(platform.python_version())' 2>/dev/null || true)" != "${pkgs.python313.version}" ]]
          then
            $DRY_RUN_CMD ${pkgs.uv}/bin/uv tool install \
              --force \
              --python ${pkgs.python313}/bin/python3 \
              "$spec"
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
