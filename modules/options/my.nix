{ lib, ... }:

# Typed options shared by every host. Declared once here, defined per host
# (hosts/<name>/default.nix sets `my.role`; flake.nix sets username/hostname).
# Modules read them via `config.my.*` (system) or `osConfig.my.*` (home-manager)
# instead of untyped specialArgs.
{
  options.my = {
    username = lib.mkOption {
      type = lib.types.str;
      description = "Primary user account name.";
    };

    hostname = lib.mkOption {
      type = lib.types.str;
      description = "Host name; must match the darwinConfigurations attribute name.";
    };

    role = lib.mkOption {
      type = lib.types.enum [
        "work"
        "personal"
      ];
      description = "Machine role, for conditional config (lib.mkIf (config.my.role == \"work\") ...).";
    };

    tailscaleServices = {
      enable = lib.mkEnableOption "declarative Tailscale Services hosted by this machine";

      services = lib.mkOption {
        default = { };
        description = ''
          Tailscale Services hosted by this machine. Attribute names become
          service identities such as `svc:my-api`.
        '';
        type = lib.types.attrsOf (
          lib.types.submodule (_: {
            options = {
              target = lib.mkOption {
                type = lib.types.str;
                example = "http://127.0.0.1:3000";
                description = "Loopback URL to which Tailscale forwards service traffic.";
              };

              port = lib.mkOption {
                type = lib.types.port;
                default = 443;
                description = "Port exposed on the service's TailVIP.";
              };

              protocol = lib.mkOption {
                type = lib.types.enum [
                  "http"
                  "https"
                  "tcp"
                  "tls-terminated-tcp"
                ];
                default = "https";
                description = "Protocol exposed by Tailscale on the service's TailVIP.";
              };

              advertised = lib.mkOption {
                type = lib.types.bool;
                default = true;
                description = "Whether this host accepts new connections for the service.";
              };
            };
          })
        );
      };
    };
  };
}
