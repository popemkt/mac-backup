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
      ssh = mkOption {
        type = types.bool;
        default = false;
        description = ''
          Run the Tailscale SSH server: whoever the policy's `ssh` rules
          admit logs in with their Tailscale identity, with no keys or sshd.
          Linux only; neither macOS app variant can host it.
        '';
      };
      operator = mkOption {
        type = types.nullOr types.str;
        default = null;
        example = "popemkt";
        description = ''
          The account that may change Tailscale settings, `tailscale serve`
          included (`adhoc`), without root. tailscaled allows exactly one.
          Linux only: on macOS the app already lets the signed-in user do it.
        '';
      };
      sharedAdhoc = mkOption {
        description = ''
          The fixed endpoint for temporary apps that one host serves for
          everyone, which `adhoc --shared` forwards a local port to. It is read
          from that host's own declaration (wired in flake.nix), never
          repeated, so every host agrees with it.
        '';
        type = types.submodule {
          options = {
            host = mkOption {
              type = types.str;
              example = "shared-server";
              description = "Hostname of the machine serving the endpoint.";
            };
            origin = mkOption {
              type = types.str;
              example = "https://adhoc-popemkt.example-tailnet.ts.net";
              description = "The endpoint's public HTTPS origin.";
            };
            target = mkOption {
              type = types.str;
              example = "http://127.0.0.1:9001";
              description = "The loopback address the endpoint proxies to on that host.";
            };
          };
        };
      };
      nodeServe = mkOption {
        default = { };
        example = {
          mcp-edge.target = "http://127.0.0.1:4190";
        };
        description = ''
          HTTPS entries this machine serves on its own tailnet name
          (https://<host>.<tailnetDomain>[:port]), by name: node-level
          `tailscale serve`, not a Service. It needs no grant or
          auto-approver, being reachable from the tailnet wherever the
          machine is, and Funnel can publish it (`funnel`). Reconciled with
          the Services; `adhoc` neither takes nor clears a declared port, and
          the reconcile does not take a port something else already serves
          (an adhoc share, a hand-made `tailscale serve`): it fails, naming
          what is there, and retries until the port is free.
        '';
        type = types.attrsOf (
          types.submodule {
            options = {
              port = mkOption {
                type = types.port;
                default = 443;
                description = "HTTPS port on the machine's tailnet name.";
              };
              target = mkOption {
                type = types.str;
                example = "http://127.0.0.1:4190";
                description = ''
                  Loopback URL tailscaled forwards to: `<target><path>` for
                  each of `paths`, the request's path kept as sent.
                '';
              };
              paths = mkOption {
                type = types.nonEmptyListOf (types.strMatching "/[^[:space:]]*");
                default = [ "/" ];
                example = [
                  "/mcp"
                  "/.well-known/oauth-protected-resource"
                ];
                description = ''
                  The paths tailscaled mounts, each with the paths under it
                  (tailscaled matches a mount and its subpaths); any other
                  path is not served at all. `/` serves every path.
                '';
              };
              funnel = mkOption {
                type = types.bool;
                default = false;
                description = ''
                  Publish this entry on the internet through Tailscale
                  Funnel, at the same paths. The port must be 443, 8443 or
                  10000, and the tailnet policy must grant this machine's tag
                  the `funnel` node attribute (scripts/check-tailscale-policy.sh
                  checks). Funnel comes on only once the port serves exactly
                  the declared mounts. Turning it off takes the port's Funnel
                  down first, before anything else the reconcile does; Funnel
                  on a port the reconcile does not manage is only warned about.
                '';
              };
            };
          }
        );
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
                  description = ''
                    Where Tailscale forwards service traffic: a loopback URL, or
                    `unix:/abs/path` for an HTTP server on a Unix socket.
                  '';
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
