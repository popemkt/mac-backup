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
#     package = pkgs.notes;      # runs its main program, by store path
#     args = [ "serve" ];
#   };
#
# An app always says what upgrades it, so an upgrade restarts it:
#   - `package`: a Nix package. The unit names the program by store path, so
#     a switch that changes the package changes the unit and restarts it.
#   - `updatedBy`: a tool a non-Nix installer owns, with `executable` the
#     program on the owner's PATH, e.g. `updatedBy.npmGlobal = "bb-app"`.
#     That installer, after it upgrades the tool, runs the shared hook
#     `restart-apps-updated-by <installer> <tool>...` (my.restartAppsUpdatedBy),
#     which restarts the caller's apps that declared it. An installer passes
#     its own name and what it changed; it never names an app.
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
      which its arguments name. Each also sets exactly one of `package` and
      `updatedBy`, so whatever upgrades it restarts it.
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
            package = mkOption {
              type = types.nullOr types.package;
              default = null;
              description = ''
                Nix package the app runs: the unit starts its main program
                (`meta.mainProgram`) by store path, so a switch that changes the
                package restarts the app.
              '';
            };
            updatedBy = mkOption {
              type = types.nullOr (
                types.attrTag {
                  npmGlobal = mkOption {
                    type = types.str;
                    description = "An npm global (my.pkgs.npmGlobals); update-npm-globals upgrades it.";
                  };
                }
              );
              default = null;
              example = {
                npmGlobal = "bb-app";
              };
              description = ''
                For an app installed outside Nix: the installer and the tool it
                upgrades. After upgrading that tool, the installer restarts the
                app through `restart-apps-updated-by`. Set `executable` with it.
              '';
            };
            executable = mkOption {
              type = types.nullOr types.str;
              default = null;
              example = "bb-app";
              description = ''
                Program an `updatedBy` app runs: a name on the owner's PATH or
                an absolute path. A `package` app runs its package's instead.
              '';
            };
            args = mkOption {
              type = types.listOf types.str;
              default = [ ];
              description = ''
                Arguments to the program, which runs in the foreground with the
                owner's installed packages on PATH (so it can start the tools
                they have), not their interactive shell configuration.
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
            program = mkOption {
              type = types.nullOr types.str;
              readOnly = true;
              default = if config.package != null then lib.getExe config.package else config.executable;
              description = "What the unit runs, derived from `package` or `executable`.";
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

  options.my.restartAppsUpdatedBy = mkOption {
    type = types.nullOr types.package;
    default = null;
    internal = true;
    description = ''
      The hook an installer runs after upgrading tools:
      `restart-apps-updated-by <installer> <tool>...` restarts the calling
      person's my.services apps whose `updatedBy` names one of those tools.
      Set by the platform that runs my.services; null where none does.
    '';
  };
}
