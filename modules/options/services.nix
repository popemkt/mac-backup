{ lib, ... }:

# Native server apps placed on a host: what runs, as whom, where it listens
# (a loopback port or a Unix socket), and whether the tailnet sees it. The app's code and build live in its
# own repository (configs/specs/app-service-contract.md); this is only the
# placement. Every platform shares the schema; each platform's base runs the
# apps (modules/nixos/system/services.nix).
#
#   my.services.notes = {
#     owner = "popemkt";
#     port = 4100;
#     command = "bun run start";
#     workingDirectory = "/home/popemkt/src/notes";
#   };
#
# An app that can listen on a Unix socket sets `socket` instead of `port`:
# the socket's directory is the unit's own, owned by the owner with mode
# 0700, so only they and root (tailscaled, which proxies the Service) can
# reach it. Any account on the host can connect to a loopback port.
#
# An exposed app is published as the Tailscale Service `<app>-<owner>`
# (svc:notes-popemkt), so it still needs its grant and auto-approver in
# configs/tailscale/policy.hujson, which CI checks.
let
  inherit (lib) mkOption types;
in
{
  options.my.services = mkOption {
    default = { };
    description = ''
      Native server apps this host runs, one per entry, each as its owner.
      Each sets exactly one of `port` and `socket`. An app with a `port` must
      listen on 127.0.0.1 there; it is started with HOST and PORT set to that
      address. An app with a `socket` gets neither and listens on that path,
      which its command names.
    '';
    type = types.attrsOf (
      types.submodule (
        { config, ... }:
        {
          options = {
            owner = mkOption {
              type = types.str;
              example = "popemkt";
              description = "Person the app runs as; must be one of the host's `my.people`.";
            };
            port = mkOption {
              type = types.nullOr types.port;
              default = null;
              description = "Loopback port the app listens on (127.0.0.1 only); null for a socket app.";
            };
            socket = mkOption {
              type = types.nullOr types.str;
              default = null;
              example = "/run/kb-popemkt/kb.sock";
              description = ''
                Unix socket the app listens on instead of a port, as
                `/run/<dir>/<file>`. The unit creates `/run/<dir>` for the
                app's run, owned by its owner with mode 0700, and removes it
                when the app stops, so no socket outlives its server.
              '';
            };
            command = mkOption {
              type = types.str;
              example = "bun run start";
              description = ''
                Shell command that starts the app in the foreground. It runs
                under bash with the owner's installed packages on PATH; it does
                not read the owner's interactive shell configuration.
              '';
            };
            environment = mkOption {
              type = types.attrsOf types.str;
              default = { };
              description = "Extra environment variables for the app; these override HOST and PORT.";
            };
            workingDirectory = mkOption {
              type = types.nullOr types.str;
              default = null;
              description = "Directory the app starts in; the owner's home when null.";
            };
            expose = mkOption {
              type = types.bool;
              default = true;
              description = "Publish the app on the tailnet as the Tailscale Service `<app>-<owner>`.";
            };
            listenOrigin = mkOption {
              type = types.str;
              readOnly = true;
              default =
                if config.socket != null then
                  "unix:${config.socket}"
                else
                  "http://127.0.0.1:${toString config.port}";
              description = "Where the app listens, derived from its socket or port: a Tailscale Service target.";
            };
          };
        }
      )
    );
  };
}
