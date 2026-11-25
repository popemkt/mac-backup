{
  config,
  lib,
  pkgs,
  ...
}:

# The alerts component (docs/monitoring.md → Alerts). Everything publishes
# through the ntfy stack's publisher for `alerts.server`, which runs the
# unit as root with the owner's token as a credential (no socket or token
# permission is widened; modules/stacks/ntfy).
#
#   - Failed services: a top-level drop-in (service.d/) gives every system
#     service OnFailure=monitoring-unit-failed@<its name>.service, so a
#     service added later is covered with nothing to list. A notifier that
#     fails (ntfy down, no token) must not start a notifier for itself:
#     systemd already drops a template's dependency on its own instances
#     (load-fragment.c, systemd issue 17602), and the notifier's own
#     drop-in, which sorts after it, clears OnFailure= again, so that holds
#     whatever that heuristic does (systemd.unit(5), the failure-handler
#     example). The VM test checks there is no loop.
#   - Health checks: monitoring-health on a timer (./health.sh).
let
  cfg = config.my.stacks.monitoring;
  inherit (cfg) alerts;
  publisher =
    config.my.stacks.ntfy.publishers.${alerts.server}
      or (throw "my.stacks.monitoring.alerts.server: no my.stacks.ntfy.servers.${alerts.server}");
  notifier = "monitoring-unit-failed";

  dropIns = pkgs.runCommand "monitoring-on-failure" { } ''
    mkdir -p "$out/etc/systemd/system/service.d" "$out/etc/systemd/system/${notifier}@.service.d"
    cat > "$out/etc/systemd/system/service.d/10-monitoring-on-failure.conf" <<'EOF'
    [Unit]
    OnFailure=${notifier}@%N.service
    EOF
    cat > "$out/etc/systemd/system/${notifier}@.service.d/90-monitoring-no-recursion.conf" <<'EOF'
    [Unit]
    OnFailure=
    EOF
  '';

  environment = {
    MONITOR_HOST = config.my.hostname;
    TOPIC = alerts.topic;
    IGNORE_UNITS = lib.concatStringsSep "\n" alerts.ignoreUnits;
  };

  # Root (the publisher's way to the owner-only socket), but read-only
  # everywhere except its own state.
  hardening = {
    StateDirectory = "monitoring";
    StateDirectoryMode = "0700";
    ProtectSystem = "strict";
    ProtectHome = "read-only";
    PrivateTmp = true;
    NoNewPrivileges = true;
    ProtectKernelTunables = true;
    ProtectKernelModules = true;
    ProtectControlGroups = true;
    RestrictSUIDSGID = true;
  };

  script =
    name: file: inputs:
    lib.getExe (
      pkgs.writeShellApplication {
        inherit name;
        runtimeInputs = [
          publisher.package
          pkgs.coreutils
          pkgs.gnugrep
          pkgs.util-linux
          config.systemd.package
        ]
        ++ inputs;
        text = builtins.readFile file;
      }
    );
in
lib.mkIf (cfg.enable && alerts.enable) {
  systemd.packages = [ dropIns ];

  systemd.services."${notifier}@" = {
    description = "Alert ntfy that %i.service failed";
    inherit (publisher) unitConfig;
    environment = environment // {
      FAILURE_COOLDOWN = toString alerts.failureCooldown;
      JOURNAL_LINES = toString alerts.journalLines;
    };
    serviceConfig =
      publisher.serviceConfig
      // hardening
      // {
        Type = "oneshot";
        ExecStart = "${script notifier ./unit-failed.sh [ ]} %i";
      };
  };

  systemd.services.monitoring-health = {
    description = "Health checks that alert ntfy on a change";
    inherit (publisher) unitConfig;
    environment = environment // {
      DISK_PERCENT = toString alerts.thresholds.diskPercent;
      MEMORY_AVAILABLE_PERCENT = toString alerts.thresholds.memoryAvailablePercent;
      MEMORY_PRESSURE_PERCENT = toString alerts.thresholds.memoryPressurePercent;
      FAILED_MINUTES = toString alerts.thresholds.failedMinutes;
      SIGNIN_ERRORS = toString alerts.thresholds.signInErrors;
      SIGNIN_WINDOW_MINUTES = toString alerts.thresholds.signInWindowMinutes;
      DRIFT_CHECK = lib.optionalString alerts.funnelDrift "${config.my.stacks.vpn.serveDriftCheck}";
      KEYCLOAK_UNIT = toString alerts.keycloakUnit;
    };
    serviceConfig =
      publisher.serviceConfig
      // hardening
      // {
        Type = "oneshot";
        ExecStart = script "monitoring-health" ./health.sh [
          pkgs.gawk
          pkgs.gnused
        ];
      };
  };

  systemd.timers.monitoring-health = {
    wantedBy = [ "timers.target" ];
    timerConfig = {
      OnBootSec = "5min";
      OnUnitActiveSec = alerts.interval;
    };
  };
}
