{
  config,
  lib,
  ...
}:

let
  inherit (config.my) hostname;
  inherit (lib) mapAttrs' mkIf nameValuePair;
  cfg = config.my.stacks.vpn;

  serviceComponents = mapAttrs' (
    name: _service:
    nameValuePair "tailscale-service-${name}" {
      name = "Tailscale service: svc:${name}";
      description = "Tailnet service identity routing to this host.";
      managedBy = "hybrid";
    }
  ) cfg.services;

  serviceIntegrations = mapAttrs' (
    name: service:
    nameValuePair "tailscale-service-${name}" {
      name = "Tailscale service: svc:${name}";
      description = "Define, approve, and route the stable ${name} Tailnet Service endpoint.";
      required = service.advertised;
      requiredBy = [ "https://${name}.${cfg.tailnetDomain}" ];
      dependsOn = [ "tailscale-device" ];
      connection = {
        source = "tailscale-control-plane";
        target = "tailscale-service-${name}";
      };
      check = {
        kind = "tailscale_service";
        service = "svc:${name}";
        inherit (service) target;
      };
      enrollment = {
        kind = "manual";
        instructions = ''
          Create svc:${name} once in the Tailscale Services console if it does not exist.
          Then reapply the tracked policy; its auto-approver attaches the tagged host ${hostname}.
        '';
        url = "https://console.tailscale.com/admin/services";
      };
      statePaths = [ ];
      secretPolicy = "The Service identity and host approval remain Tailscale control-plane state.";
      recovery = "Recreate svc:${name}, reapply the tracked policy, and rebuild this host.";
    }
  ) cfg.services;
in

{
  config = mkIf cfg.enable {
    my.systemSetup = {
      components = {
        "tailscale-control-plane" = {
          name = "Tailscale control plane";
          description = "External device identity, policy, and Tailnet Service ownership.";
          managedBy = "external";
        };
      }
      // serviceComponents;

      integrations = {
        "tailscale-device" = {
          name = "Tailscale device identity";
          description = "Enroll this Mac in the configured tailnet.";
          requiredBy = [ "Private service connectivity" ];
          connection = {
            source = "local-host";
            target = "tailscale-control-plane";
          };
          check.kind = "tailscale_device";
          enrollment = {
            kind = "command";
            instructions = "Authenticate this Mac with Tailscale in its interactive browser flow.";
            argv = [
              "/usr/local/bin/tailscale"
              "login"
            ];
          };
          statePaths = [ ];
          secretPolicy = "Tailscale owns the device key; never copy it into Git.";
          recovery = "Sign in again, then restore the declared machine tag in the admin console.";
        };
      }
      // serviceIntegrations;
    };
  };
}
