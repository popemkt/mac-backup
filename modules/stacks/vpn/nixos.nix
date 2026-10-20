{
  config,
  lib,
  pkgs,
  ...
}:

# NixOS side of the vpn stack: tailscaled (with its SSH server when
# `ssh` is set), and the systemd job that
# reconciles the declared Tailscale Services.
let
  cfg = config.my.stacks.vpn;
  reconcile = import ./services-reconcile.nix {
    inherit lib pkgs cfg;
    tailscale = "${config.services.tailscale.package}/bin/tailscale";
    stateDir = "/var/lib/tailscale-services";
  };
in
{
  config = lib.mkMerge [
    (lib.mkIf cfg.enable {
      services.tailscale = {
        enable = true;
        # The UDP port for direct peer connections.
        openFirewall = true;
        # Applied with `tailscale set` once tailscaled is up.
        extraSetFlags = lib.optional cfg.ssh "--ssh";
      };
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
