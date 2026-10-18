{ lib, ... }:

# Native server apps placed on a host: what runs, as whom, on which loopback
# port, and whether the tailnet sees it. The app's code and build live in its
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
      Native server apps this host runs, one per entry, each as its owner and
      bound to loopback. The app must listen on 127.0.0.1 at `port`; it is
      started with HOST and PORT set to that address.
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
              type = types.port;
              description = "Loopback port the app listens on (127.0.0.1 only).";
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
              default = "http://127.0.0.1:${toString config.port}";
              description = "Loopback origin the app listens on, derived from its port.";
            };
          };
        }
      )
    );
  };
}
