{
  config,
  lib,
  pkgs,
  ...
}:

# macOS side of the vpn stack: the Tailscale app cask and the launchd job
# that reconciles the declared Tailscale Services.
let
  cfg = config.my.stacks.vpn;
  reconcile = import ./services-reconcile.nix {
    inherit lib pkgs cfg;
    tailscale = "/usr/local/bin/tailscale";
    stateDir = "/var/db/tailscale-services";
  };
in
{
  config = lib.mkMerge [
    (lib.mkIf cfg.enable {
      my.pkgs.casks = [ "tailscale-app" ];
      assertions = [
        {
          assertion = !cfg.ssh;
          message = "my.stacks.vpn.ssh: the Tailscale app cannot host Tailscale SSH on macOS; only the open source tailscaled can.";
        }
      ];
    })

    (lib.mkIf reconcile.enable {
      inherit (reconcile) assertions;

      launchd.daemons.tailscale-services = {
        inherit (reconcile) script;
        serviceConfig = {
          RunAtLoad = true;
          KeepAlive.SuccessfulExit = false;
          ThrottleInterval = 30;
          StandardOutPath = "/var/log/tailscale-services.log";
          StandardErrorPath = "/var/log/tailscale-services.log";
        };
      };
    })
  ];
}
