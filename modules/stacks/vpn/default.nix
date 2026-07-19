{ config, lib, ... }:

# VPN stack: the Tailscale mesh. Comprehensive — owns its schema, the app
# cask (install-only, gated on enable), and the service-hosting daemon
# (tailscale-services.nix, active when enable && services are declared).
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
  imports = [
    ./tailscale-services.nix
  ];

  options.my.stacks.vpn = mkStack {
    description = "VPN / Tailscale mesh (app + hosted services)";
    componentOptions = {
      services = mkOption {
        default = { };
        description = ''
          Tailscale Services hosted by this machine. Attribute names become
          service identities such as `svc:my-api`. Declaring any service
          activates the reconcile daemon; leaving this empty installs only
          the app.
        '';
        type = types.attrsOf (
          types.submodule (_: {
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
            };
          })
        );
      };
    };
  };

  config = lib.mkIf cfg.enable {
    my.pkgs.casks = [
      "tailscale-app"
    ]
    ++ cfg.extra.casks;
  };
}
