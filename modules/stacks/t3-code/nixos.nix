{
  config,
  lib,
  pkgs,
  ...
}:

# T3 Code on NixOS: one headless server per declared instance, run as its
# user. The servers and the agents they drive (Claude Code, Codex) come from
# npm, so they track the latest releases; npm ships them as prebuilt
# binaries, which run through nix-ld.
let
  cfg = config.my.stacks.t3-code;

  # Shell helper for the person who owns an instance, aimed at its own unit.
  # The web UI's terminal lives in the unit's cgroup, so the restart is handed
  # to a transient timer outside it. sudo is passwordless for wheel on hosts
  # that run agents (see hosts/shared-server), and everyone here is in wheel.
  mkHelpers = unit: ''
    t3-restart() {
      sudo systemd-run --quiet --collect --on-active=2 \
        systemctl restart ${unit}.service || return
      echo "${unit} restarts in ~2s. The UI will disconnect and reconnect."
      echo "Any agent turn in progress is lost."
      echo "After update-npm-globals, run t3-restart to pick up the new version."
    }
  '';
in
{
  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = config.programs.nix-ld.enable;
        message = "my.stacks.t3-code needs programs.nix-ld.enable: t3, claude and codex are prebuilt npm binaries.";
      }
    ]
    ++ [
      {
        assertion =
          lib.length (lib.unique (lib.mapAttrsToList (_: i: i.user) cfg.instances))
          == lib.length (lib.attrNames cfg.instances);
        message = "my.stacks.t3-code: each user may own one instance; the t3-restart helper targets a single unit.";
      }
    ]
    ++ lib.mapAttrsToList (name: instance: {
      assertion = config.users.users ? ${instance.user};
      message = "my.stacks.t3-code.instances.${name}.user names ${instance.user}, which is not a declared account.";
    }) cfg.instances;

    # T3's built-in browser is a prebuilt Chromium headless shell; these are the
    # libraries it reports missing (`ldd` on it), and nix-ld exposes them to it.
    # at-spi2-core carries atk, atk-bridge and atspi.
    my.pkgs.nixLdLibraries = [
      "alsa-lib"
      "at-spi2-core"
      "dbus"
      "expat"
      "glib"
      "libgbm"
      "libx11"
      "libxcb"
      "libxcomposite"
      "libxdamage"
      "libxext"
      "libxfixes"
      "libxkbcommon"
      "libxrandr"
      "nspr"
      "nss"
      "systemdLibs"
    ];

    # Installed per user by the npm executor (modules/common/home-manager/npm-global.nix).
    my.pkgs.npmGlobals = [
      "t3"
      "@anthropic-ai/claude-code"
      "@openai/codex"
    ];

    systemd.services = lib.mapAttrs' (
      name: instance:
      let
        inherit (config.users.users.${instance.user}) home;
      in
      lib.nameValuePair "t3-code-${name}" {
        description = "T3 Code server for ${instance.user}";
        wantedBy = [ "multi-user.target" ];
        wants = [ "network-online.target" ];
        # Home Manager's activation installs the npm globals this runs.
        after = [
          "network-online.target"
          "home-manager-${instance.user}.service"
        ];
        path = with pkgs; [
          bash
          coreutils
          git
          nodejs
        ];
        script = ''
          export PATH="${home}/.local/bin:$PATH"
          exec t3 serve --host 127.0.0.1 --port ${toString instance.port} --no-browser
        '';
        serviceConfig = {
          User = instance.user;
          WorkingDirectory = home;
          Restart = "on-failure";
          RestartSec = 10;
        };
      }
    ) cfg.instances;

    home-manager.users = lib.mapAttrs' (
      name: instance:
      lib.nameValuePair instance.user {
        programs.zsh.initContent = lib.mkAfter (mkHelpers "t3-code-${name}");
      }
    ) cfg.instances;
  };
}
