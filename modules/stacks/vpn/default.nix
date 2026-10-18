{ config, lib, ... }:

# VPN stack: the Tailscale mesh. This file owns the schema, which every
# platform shares. The client install and the service-hosting job (active
# when enable && services are declared) are per platform: ./darwin.nix and
# ./nixos.nix, both running ./services-reconcile.nix.
#
#   my.stacks.vpn.enable = true;              # just the app/CLI
#   my.stacks.vpn = {
#     enable = true;
#     services.my-api = { target = "http://127.0.0.1:3000"; };
#   };
let
  mkStack = import ../mk-stack.nix lib;
  inherit (lib) mkOption types;
  cfg = config.my.stacks.vpn;
in
{
  options.my.stacks.vpn = mkStack {
    description = "VPN / Tailscale mesh (app + hosted services)";
    componentOptions = {
      tailnetDomain = mkOption {
        type = types.str;
        example = "example-tailnet.ts.net";
        description = "MagicDNS tailnet domain shared by service hosts and clients.";
      };
      knownDevices = mkOption {
        type = types.attrsOf types.str;
        default = { };
        example = {
          phone = "100.64.0.2";
          tablet = "100.64.0.3";
        };
        description = "Known Tailscale device names and stable IPv4 addresses.";
      };
      tags = mkOption {
        type = types.listOf (types.strMatching "tag:[a-z0-9][a-z0-9-]*");
        default = [ ];
        example = [ "tag:home-server" ];
        description = ''
          Tailscale tags this host's machine record carries. Assigning a tag
          stays a control-plane step (docs/tailscale.md); this records it, so
          the policy's Service auto-approvers can be checked against the hosts
          that advertise each Service.
        '';
      };
      services = mkOption {
        default = { };
        description = ''
          Tailscale Services hosted by this machine. Attribute names become
          service identities such as `svc:my-api`. Declaring any service
          activates the reconcile daemon; leaving this empty installs only
          the app.
        '';
        type = types.attrsOf (
          types.submodule (
            { config, name, ... }: {
              options = {
                target = mkOption {
                  type = types.str;
                  example = "http://127.0.0.1:3000";
                  description = "Loopback URL to which Tailscale forwards service traffic.";
                };

                port = mkOption {
                  type = types.port;
                  default = 443;
                  description = "Port exposed on the service's TailVIP.";
                };

                protocol = mkOption {
                  type = types.enum [
                    "http"
                    "https"
                    "tcp"
                    "tls-terminated-tcp"
                  ];
                  default = "https";
                  description = "Protocol exposed by Tailscale on the service's TailVIP.";
                };

                advertised = mkOption {
                  type = types.bool;
                  default = true;
                  description = "Whether this host accepts new connections for the service.";
                };
                publicOrigin = mkOption {
                  type = types.nullOr types.str;
                  readOnly = true;
                  default =
                    if
                      builtins.elem config.protocol [
                        "http"
                        "https"
                      ]
                    then
                      "${config.protocol}://${name}.${cfg.tailnetDomain}"
                      + lib.optionalString (
                        config.port != (if config.protocol == "https" then 443 else 80)
                      ) ":${toString config.port}"
                    else
                      null;
                  description = "Browser origin derived from the HTTP service identity, protocol, and exposed port.";
                };
              };
            }
          )
        );
      };
    };
  };
}
