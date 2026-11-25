{
  config,
  lib,
  pkgs,
  ...
}:

# The host applies the `deploy` branch by itself: CI moves `deploy` forward
# to a `main` commit once every gating workflow passed on it
# (.github/workflows/deploy.yml), and this agent polls the branch, builds
# the host from it and switches, then runs rebuild's post-switch steps.
# It never switches to an ancestor of what the host runs, so it never undoes
# a `rebuild` that got ahead of it (scripts/lib/deploy-guard.sh). How it
# flows, how to pause it, and why it is not comin: docs/deploys.md.
#
# Two units, so a failure stays visible without repeating: the poll
# (timer-driven, always succeeds) fetches and starts the apply only for a
# commit it has not failed on; the apply builds and switches, and a failed
# build, switch or hold leaves it a failed unit until a newer commit, a
# manual apply that catches up, or `pull-deploy now`.
let
  inherit (lib) mkOption types;
  cfg = config.my.stacks.pull-deploy;
  stateDir = "/var/lib/pull-deploy";

  cli = pkgs.writeShellApplication {
    name = "pull-deploy";
    runtimeInputs = [
      config.nix.package
      config.systemd.package
      pkgs.coreutils
      pkgs.getent
      pkgs.git
      pkgs.util-linux
    ];
    text = ''
      repository=${lib.escapeShellArg cfg.repository}
      branch=${lib.escapeShellArg cfg.branch}
      main_branch=${lib.escapeShellArg cfg.mainBranch}
      attribute=${lib.escapeShellArg "nixosConfigurations.\"${config.my.hostname}\".config.system.build.toplevel"}
      people=(${lib.escapeShellArgs config.my.people})
      state=${stateDir}
      # shellcheck source=/dev/null
      source ${../../../scripts/lib/deploy-guard.sh}
      # shellcheck source=/dev/null
      source ${../../../scripts/lib/post-switch.sh}

    ''
    + builtins.readFile ./pull-deploy.sh;
  };

  remote = !(lib.hasPrefix "/" cfg.repository || lib.hasPrefix "file://" cfg.repository);
  network = lib.optional remote "network-online.target";
  common = {
    after = network;
    wants = network;
    # A switch never restarts or stops either: the apply is what runs the
    # switch, and a stop would cut it off mid-activation.
    restartIfChanged = false;
    unitConfig = {
      X-StopOnRemoval = false;
      # Oneshots a timer, the poll, `now` and `resume` start: never refuse
      # one for starting often.
      StartLimitIntervalSec = 0;
    };
    environment = {
      HOME = stateDir;
      XDG_CACHE_HOME = "/var/cache/pull-deploy";
    };
  };
in
{
  options.my.stacks.pull-deploy = (import ../mk-stack.nix lib) {
    description = "applying the deploy branch to this host by itself";
    componentOptions = {
      repository = mkOption {
        type = types.str;
        default = "https://github.com/popemkt/mac-backup.git";
        description = "Git URL the agent fetches (public: no credentials).";
      };
      branch = mkOption {
        type = types.str;
        default = "deploy";
        description = "Branch whose newest commit the host applies (moved by .github/workflows/deploy.yml).";
      };
      mainBranch = mkOption {
        type = types.str;
        default = "main";
        description = ''
          Branch `rebuild` applies from. The agent fetches it too, so it knows
          the commits a manual rebuild may have put on the host.
        '';
      };
      interval = mkOption {
        type = types.str;
        default = "2min";
        description = "Time between polls (systemd.time), after the last one ended.";
      };
    };
  };

  config = lib.mkIf cfg.enable {
    environment.systemPackages = [ cli ];

    systemd.services.pull-deploy-poll = common // {
      description = "Look for a new commit on the ${cfg.branch} branch";
      serviceConfig = {
        Type = "oneshot";
        ExecStart = "${lib.getExe cli} poll";
        StateDirectory = "pull-deploy";
        CacheDirectory = "pull-deploy";
      };
    };
    systemd.timers.pull-deploy-poll = {
      description = "Poll the ${cfg.branch} branch";
      wantedBy = [ "timers.target" ];
      timerConfig = {
        OnBootSec = "2min";
        OnUnitInactiveSec = cfg.interval;
      };
    };

    systemd.services.pull-deploy = common // {
      description = "Apply the ${cfg.branch} branch's newest commit to this host";
      serviceConfig = {
        Type = "oneshot";
        ExecStart = "${lib.getExe cli} apply";
        StateDirectory = "pull-deploy";
        CacheDirectory = "pull-deploy";
        # A build from scratch after a nixpkgs bump takes a while.
        TimeoutStartSec = "3h";
      };
    };
  };
}
