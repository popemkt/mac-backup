{ config, lib, ... }:

# monitoring: see the machine and hear when it needs attention
# (docs/monitoring.md). NixOS only. Two components:
#
#   alerts     a failed system service, and the periodic health checks
#              (disk, memory, units stuck failed, Funnel drift, Keycloak
#              sign-in errors), pushed to the owner's phone through the
#              host's ntfy (my.stacks.ntfy's publisher; ./alerts.nix).
#   dashboard  Beszel, read-only metrics and unit states, on the tailnet as
#              a Tailscale Service; the viewer is the Tailscale identity
#              tailscaled vouches for (./dashboard.nix).
#
# Nothing here acts on the machine: no buttons, webhooks or restarts.
# ./tests.nix is the VM test (checks.x86_64-linux.monitoring).
let
  mkStack = import ../mk-stack.nix lib;
  inherit (lib) mkOption mkEnableOption types;
  cfg = config.my.stacks.monitoring;
in
{
  imports = [
    ./alerts.nix
    ./dashboard.nix
  ];

  options.my.stacks.monitoring = mkStack {
    description = "host alerts to ntfy and a Beszel dashboard";
    componentOptions = {
      alerts = {
        enable = mkEnableOption "alerts to ntfy (failed services and health checks)";
        server = mkOption {
          type = types.str;
          default = "ntfy";
          description = "The my.stacks.ntfy.servers entry alerts are published through.";
        };
        topic = mkOption {
          type = types.strMatching "[A-Za-z0-9_-]{1,64}";
          default = "host-attention";
          description = "The ntfy topic every alert goes to.";
        };
        failureCooldown = mkOption {
          type = types.ints.positive;
          default = 3600;
          description = ''
            Seconds after a unit's failure alert during which further
            failures of the same unit are only logged, not sent.
          '';
        };
        journalLines = mkOption {
          type = types.ints.between 1 50;
          default = 15;
          description = "How many of the failed unit's last journal lines an alert carries.";
        };
        ignoreUnits = mkOption {
          type = types.listOf types.str;
          default = [ ];
          example = [ "t3-work-relay.service" ];
          description = ''
            Units whose failure never alerts, neither at once nor as stuck
            failed, by full name (`foo.service`).
          '';
        };
        interval = mkOption {
          type = types.str;
          default = "5min";
          description = "How often the health checks run (a systemd time span).";
        };
        thresholds = {
          diskPercent = mkOption {
            type = types.ints.between 1 100;
            default = 90;
            description = "Alert when a mounted filesystem is at least this full (percent).";
          };
          memoryAvailablePercent = mkOption {
            type = types.ints.between 0 100;
            default = 10;
            description = "Alert when available memory falls below this share of the total (percent).";
          };
          memoryPressurePercent = mkOption {
            type = types.ints.between 1 100;
            default = 20;
            description = ''
              Alert when, over the last minute, every non-idle task was
              stalled on memory at least this share of the time (PSI `full
              avg60`, percent).
            '';
          };
          failedMinutes = mkOption {
            type = types.ints.positive;
            default = 30;
            description = "A unit failed at least this long counts as stuck failed.";
          };
          signInErrors = mkOption {
            type = types.ints.positive;
            default = 10;
            description = "Alert at this many Keycloak error events within `signInWindowMinutes`.";
          };
          signInWindowMinutes = mkOption {
            type = types.ints.positive;
            default = 15;
            description = "The window the Keycloak sign-in errors are counted over.";
          };
        };
        funnelDrift = mkOption {
          type = types.bool;
          default = config.my.stacks.vpn.nodeServe != { };
          defaultText = lib.literalExpression "config.my.stacks.vpn.nodeServe != { }";
          description = ''
            Alert when the node's serve config differs from the declared
            `my.stacks.vpn.nodeServe` entries (the MCP edge's public paths
            among them), or Funnel is on where none is declared.
          '';
        };
        keycloakUnit = mkOption {
          type = types.nullOr types.str;
          default = if config.services.keycloak.enable then "keycloak.service" else null;
          defaultText = lib.literalExpression ''if config.services.keycloak.enable then "keycloak.service" else null'';
          description = ''
            The Keycloak unit whose error events (its default `jboss-logging`
            listener's WARN lines) count as failed sign-ins; null skips the
            check.
          '';
        };
      };

      dashboard = {
        enable = mkEnableOption "the Beszel dashboard (hub and this host's agent)";
        login = mkOption {
          type = types.strMatching "[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+";
          example = "someone@example.com";
          description = ''
            The Tailscale login that may view the dashboard: Beszel's one
            user, matched against the `Tailscale-User-Login` header
            tailscaled sets. Beszel needs it to be an email address, so a
            GitHub login (`name@github`) cannot be the viewer.
          '';
        };
        service = mkOption {
          type = types.str;
          default = "beszel-${config.my.hostname}";
          defaultText = lib.literalExpression ''"beszel-''${config.my.hostname}"'';
          description = ''
            The Tailscale Service (`svc:<service>`) the dashboard is
            published as; it needs its grant and auto-approver in
            configs/tailscale/policy.hujson.
          '';
        };
        port = mkOption {
          type = types.port;
          default = 8090;
          description = ''
            The hub's port on the loopback of its own network namespace,
            which nothing but its socket proxy shares, so it never clashes
            with a port on the host.
          '';
        };
      };
    };
  };

  config.assertions = [
    {
      assertion = (cfg.alerts.enable || cfg.dashboard.enable) -> cfg.enable;
      message = "my.stacks.monitoring components need my.stacks.monitoring.enable.";
    }
  ];
}
