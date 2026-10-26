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
#   - `updatedBy`: a tool a non-Nix installer owns, with `command` the shell
#     command that runs it from the owner's PATH, e.g.
#     `updatedBy.npmGlobal = "bb-app"`.
#     That installer, after it upgrades the tool, runs the shared hook
#     `restart-apps-updated-by <installer> <tool>...` (my.restartAppsUpdatedBy),
#     which restarts the caller's apps that declared it. An installer passes
#     its own name and what it changed; it never names an app.
# An app that runs others' work (bb runs every agent thread) sets
# `idleCheck`, a command that says when it may restart; then neither kind of
# upgrade restarts it mid-work, only once it is idle.
#
# An app made of more than one process declares the others as `companions`,
# each its own unit `app-<app>-<name>` with its own command, environment and
# idleCheck, so each restarts only for its own reasons (bb: a server that may
# restart at any time, and a host daemon, where the threads run, that waits
# for idle). An upgrade restarts all of an app's units together.
#
# An app that can listen on a Unix socket sets `socket` instead of `port`:
# the socket's directory is the unit's own, owned by the owner with mode
# 0700, so only they and root (tailscaled, which proxies the Service) can
# reach it. Any account on the host can connect to a loopback port.
#
# An exposed app is published as the Tailscale Service `<app>-<owner>`
# (svc:notes-popemkt), so it still needs its grant and auto-approver in
# configs/tailscale/policy.hujson, which CI checks. `<app>` is the entry's
# name unless it sets `app`, which lets a second person run the same app on
# one host under an entry of their own:
#
#   my.services.kb-bytetum = { app = "kb"; owner = "bytetum"; ... };  # svc:kb-bytetum
let
  inherit (lib) mkOption types;
  # One meaning for an app's unit and each companion's: what may restart it.
  idleCheckOption =
    unit:
    mkOption {
      type = types.nullOr types.str;
      default = null;
      example = "bb thread list --json | jq -e 'all(.[]; .status != \"active\")' >/dev/null";
      description = ''
        Shell command, run under bash as the owner with their installed
        packages and jq on PATH, that exits 0 when `${unit}` may be restarted
        now, e.g. when no work of anyone's is running in it. When any unit of
        an app sets one, nothing restarts that unit while the app is busy (the
        app is idle once every idleCheck it declares passes): a switch that
        changes the unit's definition, and the installer's upgrade, each leave
        a restart pending that a waiter unit, `app-<app>-restart-when-idle`,
        carries out (checking every 30 s, for up to 24 h). The app's other
        units restart through that waiter too. It restarts all the units
        pending at the time together: at once when none of them needs to
        wait, otherwise once the app is idle; so a change to an unchecked
        unit alone applies within seconds, and an upgrade, which restarts
        them all, waits. A process started under an idleCheck keeps waiting
        for idle even if the new definition drops it. `sudo systemctl restart
        ${unit}` restarts it at once. Null on every unit of an app restarts
        each as soon as something changes it.
      '';
    };
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
        { config, name, ... }:
        {
          options = {
            app = mkOption {
              type = types.str;
              default = name;
              defaultText = lib.literalMD "the entry's name";
              example = "kb";
              description = ''
                The app this entry runs, which names its Tailscale Service
                `<app>-<owner>`. Set it when a second person runs an app the
                host already places, under an entry of their own: popemkt's
                `my.services.kb` is svc:kb-popemkt, and
                `my.services.kb-bytetum` with `app = "kb"` is svc:kb-bytetum.
                Units are always named after the entry (`app-kb-bytetum`).
              '';
            };
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
                app through `restart-apps-updated-by`. Set `command` with it.
                An npm global's units run a copy of the package taken when the
                app's own unit starts with none of its companions running, so
                every unit runs one version until the whole app restarts, and
                none loads files npm rewrote under it.
              '';
            };
            command = mkOption {
              type = types.nullOr types.str;
              default = null;
              example = "bb-app --server-port 38886";
              description = ''
                Shell command that starts an `updatedBy` app in the foreground,
                finding its program on the owner's PATH. A `package` app sets
                `args` instead.
              '';
            };
            args = mkOption {
              type = types.listOf types.str;
              default = [ ];
              description = ''
                Arguments to a `package` app's main program. Either way the app
                runs in the foreground under bash with the owner's installed
                packages on PATH (so it can start the tools they have), not
                their interactive shell configuration.
              '';
            };
            idleCheck = idleCheckOption "app-<app>";
            companions = mkOption {
              default = { };
              example = {
                daemon = {
                  command = "bb-host-daemon --server-url http://127.0.0.1:38886";
                  idleCheck = "bb thread list --json | jq -e 'all(.[]; .status != \"active\")' >/dev/null";
                };
              };
              description = ''
                The app's other processes, each run as the owner in its own
                unit `app-<app>-<name>`, started with the app (which Wants it;
                it starts After it, and nothing stops or restarts one because
                the other did). Its own command, environment and idleCheck
                decide when it restarts. An upgrade by `updatedBy` restarts
                all of the app's units together, so they never run different
                versions; when any of them has an idleCheck, every one waits
                until the app is idle.
              '';
              type = types.attrsOf (
                types.submodule {
                  options = {
                    command = mkOption {
                      type = types.str;
                      example = "bb-host-daemon --host-daemon-port 38887";
                      description = ''
                        Shell command that starts the companion in the
                        foreground, run like the app's (bash, the owner's
                        installed packages on PATH, after a `package` app's
                        own programs).
                      '';
                    };
                    environment = mkOption {
                      type = types.attrsOf types.str;
                      default = { };
                      description = ''
                        Its environment. It inherits none of the app's
                        `environment` (so a change there restarts only the
                        app's unit) and gets no HOST or PORT, which are the
                        app's address.
                      '';
                    };
                    idleCheck = idleCheckOption "app-<app>-<name>";
                  };
                }
              );
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
              description = "Publish the app on the tailnet as the Tailscale Service `<app>-<owner>` (`app`, then `owner`).";
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
