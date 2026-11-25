{
  config,
  lib,
  pkgs,
  ...
}:

# NixOS side of the vpn stack: tailscaled (with its SSH server when
# `ssh` is set), the `adhoc` command on top of it, and the systemd job that
# reconciles the declared Tailscale Services.
let
  cfg = config.my.stacks.vpn;
  adhoc = import ./adhoc.nix {
    inherit pkgs cfg;
    inherit (config.my) hostname;
    tailscale = "${config.services.tailscale.package}/bin/tailscale";
    ssh = "${pkgs.openssh}/bin/ssh";
  };
  reconcile = import ./services-reconcile.nix {
    inherit lib pkgs cfg;
    tailscale = "${config.services.tailscale.package}/bin/tailscale";
    stateDir = "/var/lib/tailscale-services";
  };
in
{
  # NixOS only: the drift check over the declared node-level entries
  # (./services-reconcile.nix `driftScript`), which the monitoring stack's
  # health check runs.
  options.my.stacks.vpn = lib.mkOption {
    type = lib.types.submodule {
      options.serveDriftCheck = lib.mkOption {
        type = lib.types.package;
        readOnly = true;
        internal = true;
        description = ''
          Exits 0 when this machine's node-level serve config is exactly
          `nodeServe` (each port's mounts, and Funnel only where declared), 1
          printing each difference, 2 when tailscaled cannot be read. Run as
          root.
        '';
      };
    };
  };

  config = lib.mkMerge [
    {
      my.stacks.vpn.serveDriftCheck = pkgs.writeShellScript "tailscale-serve-drift" reconcile.driftScript;
    }

    (lib.mkIf cfg.enable {
      services.tailscale = {
        enable = true;
        # The UDP port for direct peer connections.
        openFirewall = true;
        # Applied with `tailscale set` once tailscaled is up.
        extraSetFlags =
          lib.optional cfg.ssh "--ssh" ++ lib.optional (cfg.operator != null) "--operator=${cfg.operator}";
      };
      my.everyone.home.packages = [ adhoc ];
    })

    (lib.mkIf reconcile.enable {
      inherit (reconcile) assertions;

      systemd.services.tailscale-services = {
        description = "Reconcile the declared Tailscale Services";
        wantedBy = [ "multi-user.target" ];
        wants = [ "tailscaled.service" ];
        after = [ "tailscaled.service" ];
        inherit (reconcile) script;
        serviceConfig = {
          Type = "oneshot";
          RemainAfterExit = true;
          Restart = "on-failure";
          RestartSec = 30;
        };
      };
    })
  ];
}
