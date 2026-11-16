{
  config,
  lib,
  pkgs,
  ...
}:

# Local proxy: HTTPS for loopback apps at `https://<site>.localhost`, signed
# by a root CA this machine makes for itself. Nothing leaves the machine: a
# `.localhost` name always resolves to loopback (RFC 6761; macOS and every
# browser answer it without DNS), the proxy listens on loopback only, and no
# public CA, domain or DNS record is involved.
#
#   my.stacks.local-proxy = {
#     enable = true;
#     sites.my-app.target = "http://127.0.0.1:3000";   # https://my-app.localhost
#   };
#
# macOS only for now: Caddy runs as a root LaunchDaemon, because macOS lets
# only root bind port 443 on a specific address (an unprivileged process may
# take it only on the wildcard address, which is not loopback-only). Its CA
# is ./ca.sh, its configuration ./caddyfile.nix (both built by
# ./package.nix, which ./tests.nix runs), and making the person's browsers
# trust the CA is an explicit enrollment (./system-setup.nix). How to use it:
# docs/local-proxy.md.
let
  mkStack = import ../mk-stack.nix lib;
  inherit (lib) mkOption types;
  cfg = config.my.stacks.local-proxy;

  inherit (cfg) stateDir;
  caName = "Local Proxy CA (${config.my.hostname})";

  inherit (import ./package.nix { inherit pkgs; }) ca caddyfile;

  # The CA state is disposable and holds a key, so Time Machine skips it: a
  # sticky exclusion on the directory, made before the CA is.
  daemon = pkgs.writeShellApplication {
    name = "local-proxy";
    text = ''
      install -d -m 0755 ${stateDir}
      /usr/bin/tmutil addexclusion ${stateDir} ||
        echo "local-proxy: could not exclude ${stateDir} from Time Machine" >&2
      ${lib.getExe ca} ${
        lib.escapeShellArgs [
          stateDir
          caName
        ]
      }
      exec ${lib.getExe pkgs.caddy} run --adapter caddyfile --config ${
        caddyfile {
          inherit (cfg) sites;
          inherit stateDir caName;
        }
      }
    '';
  };
in
{
  imports = [ ./system-setup.nix ];

  options.my.stacks.local-proxy = mkStack {
    description = "Local HTTPS proxy for loopback apps at *.localhost";
    componentOptions = {
      sites = mkOption {
        default = { };
        description = ''
          Apps the proxy serves. Each attribute name is a site's DNS label:
          `sites.my-app` is served at `https://my-app.localhost`.
        '';
        type = types.attrsOf (
          types.submodule (
            { name, ... }:
            {
              options = {
                target = mkOption {
                  type = types.strMatching "http://(127\\.0\\.0\\.1|\\[::1]|localhost):[0-9]+";
                  example = "http://127.0.0.1:3000";
                  description = "The app's loopback HTTP origin the proxy forwards to.";
                };
                origin = mkOption {
                  type = types.str;
                  readOnly = true;
                  default = "https://${name}.localhost";
                  description = "The browser origin the proxy serves the site at.";
                };
              };
            }
          )
        );
      };
      stateDir = mkOption {
        type = types.str;
        readOnly = true;
        default = "/var/db/local-proxy";
        description = ''
          Root-owned state, outside the store, Git and Time Machine: the CA
          key and Caddy's certificates (docs/backup-strategy.md → Local
          Proxy CA).
        '';
      };
      caCertificate = mkOption {
        type = types.str;
        readOnly = true;
        default = "${cfg.stateDir}/ca/root.crt";
        description = "The root CA certificate (public) that signs every site.";
      };
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = lib.all (name: builtins.match "[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?" name != null) (
          lib.attrNames cfg.sites
        );
        message = "my.stacks.local-proxy.sites: each name is one DNS label (a-z, 0-9, inner hyphens).";
      }
    ];

    launchd.daemons.local-proxy.serviceConfig = {
      ProgramArguments = [ (lib.getExe daemon) ];
      EnvironmentVariables = {
        HOME = stateDir;
        XDG_CONFIG_HOME = "${stateDir}/config";
        XDG_DATA_HOME = "${stateDir}/data";
      };
      RunAtLoad = true;
      KeepAlive = true;
      ThrottleInterval = 10;
      StandardOutPath = "/var/log/local-proxy.log";
      StandardErrorPath = "/var/log/local-proxy.log";
    };
  };
}
