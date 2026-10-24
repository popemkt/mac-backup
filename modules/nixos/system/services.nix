{
  config,
  lib,
  pkgs,
  ...
}:

# NixOS side of my.services (modules/options/services.nix): one systemd unit,
# `app-<app>`, per declared app, and one more, `app-<app>-<name>`, per
# companion, all run as the app's owner, and a Tailscale Service
# `<app>-<owner>` for each exposed app. A socket app's unit owns the socket's
# directory as its RuntimeDirectory: created (owner-only) when it starts and
# removed when it stops, so a crash leaves nothing that blocks the restart.
# The app's unit Wants its companions and they start After it; neither ever
# stops or restarts the other.
#
# Upgrades restart apps. A `package` app's unit names its program by store
# path, so a switch to a new package restarts it. An `updatedBy` app is
# restarted by its installer through `restart-apps-updated-by`, which reads
# the table below and restarts every unit of the app; polkit lets each owner
# restart their own `app-*` units, so the installer needs no sudo. Every such
# restart goes through one command, `restart-app <unit>`; `restart-app
# --status` lists what is still pending (rebuild prints it).
#
# An `updatedBy.npmGlobal` app runs a copy of the package (app-npm-pin), not
# the installed one, which npm rewrites in place: all its units run the same
# version until the whole app restarts. Only its own unit, starting with none
# of its companions running, moves the copy to the installed version.
#
# An app with an `idleCheck` on any of its units is never restarted mid-work.
# A switch leaves all its units running (restartIfChanged = false), and a
# switch that drops them, or a rollback to before them, leaves them running
# too (X-StopOnRemoval = false; stop them by hand once idle). Instead each
# unit records, in /run/app-restart/<unit key>/, a hash of the definition it
# started with (what the app declares, not the generated unit, which changes
# with every nixpkgs bump), and `free` when it started without an idleCheck;
# an activation script that finds a different hash runs restart-app. For
# such an app restart-app marks the unit's restart requested and starts
# `app-<app>-restart-when-idle`, a waiter unit run as the owner. It restarts
# all of the app's pending units in one try-restart: at once when none of
# them needs to wait, otherwise once every idleCheck of the app passes
# (checked every 30 s). A unit needs to wait when its new definition has an
# idleCheck or its running process started under one, so a process that runs
# others' work is never cut off by a definition that no longer says so.
# Being a unit, the waiter runs once per app (starting an active unit is a
# no-op), logs to the journal, and lives outside the app's cgroups, so the
# restart it causes does not kill it. It restarts a unit only once the
# switch's daemon-reload has loaded the new definition, never onto the old
# one. The unit's next start records its new hash and clears the request.
# multi-user.target also wants the waiter, so a switch that first adds it,
# and a boot, check for a pending restart too; it gives up after 24 h (a
# failed unit) and a timer starts it again hourly.
# `sudo systemctl restart <unit>` forces a restart.
#
# A companion starts only beside an app process that was started with it
# declared (its record lists the companions): a process from before the
# companion existed may still do the companion's work itself, so the
# companion waits for that process's restart rather than running a second
# copy beside it. Adding a companion changes the app unit's definition, so
# that restart follows.
let
  cfg = config.my.services;
  exposed = lib.filterAttrs (_: app: app.expose) cfg;
  serviceName = name: app: "${name}-${app.owner}";

  # Loopback ports something else on this host already declares: T3 Code
  # servers, and every Tailscale Service target that is not one of these apps.
  ownServiceNames = lib.mapAttrsToList serviceName exposed;
  targetPort =
    target:
    let
      port = builtins.match "[a-z]+://[^/]+:([0-9]+)(/.*)?" target;
    in
    lib.optionals (port != null) [ (lib.toInt (builtins.head port)) ];
  reservedPorts =
    lib.optionals config.my.stacks.t3-code.enable (
      lib.mapAttrsToList (_: instance: instance.port) config.my.stacks.t3-code.instances
    )
    ++ lib.concatLists (
      lib.mapAttrsToList (
        name: service: lib.optionals (!builtins.elem name ownServiceNames) (targetPort service.target)
      ) config.my.stacks.vpn.services
    );

  appPorts = lib.concatLists (
    lib.mapAttrsToList (_: app: lib.optionals (app.port != null) [ app.port ]) cfg
  );
  # `/run/<dir>/<file>` → <dir>, the RuntimeDirectory; null for any other path.
  runtimeDirectory =
    socket:
    let
      parts = builtins.match "/run/([a-z0-9][a-z0-9_.-]*)/[^/]+" socket;
    in
    if parts == null then null else builtins.head parts;
  listensOn =
    app: if app.socket != null then "socket ${app.socket}" else "127.0.0.1:${toString app.port}";
  homeOf = app: config.users.users.${app.owner}.home;
  # The owner's installed packages, as their login shell would find them.
  ownerPath =
    app:
    "${homeOf app}/.local/bin:/etc/profiles/per-user/${app.owner}/bin:/run/wrappers/bin:/run/current-system/sw/bin";
  # The npm prefix update-npm-globals installs into
  # (modules/common/home-manager/npm-global.nix).
  npmPrefix = app: "${homeOf app}/.local";
  npmPackage = app: if app.updatedBy != null then app.updatedBy.npmGlobal or null else null;

  scripts = import ./app-restart/scripts.nix {
    inherit pkgs;
    systemctl = config.systemd.package;
  };

  # Every unit an app runs: its own, then one per companion. `key` names the
  # unit's restart state and definition; the app's own is the app's name.
  unitsOf = lib.mapAttrs (
    name: app:
    [
      {
        key = name;
        unit = "app-${name}";
        companion = null;
        description = "${name}, run as ${app.owner} on ${listensOn app}";
        inherit (app) idleCheck;
        environment =
          lib.optionalAttrs (app.port != null) {
            HOST = "127.0.0.1";
            PORT = toString app.port;
          }
          // app.environment;
        run =
          if app.package != null then
            "exec ${lib.escapeShellArgs ([ (lib.getExe app.package) ] ++ app.args)}"
          else
            app.command;
      }
    ]
    ++ lib.mapAttrsToList (companion: c: {
      key = "${name}-${companion}";
      unit = "app-${name}-${companion}";
      inherit companion;
      description = "${name}'s ${companion}, run as ${app.owner}";
      inherit (c) idleCheck;
      inherit (c) environment;
      run = c.command;
    }) app.companions
  ) cfg;
  # Apps whose restarts wait for idle: an idleCheck on any of their units.
  idleApps = lib.filterAttrs (name: _: lib.any (u: u.idleCheck != null) unitsOf.${name}) cfg;
  allUnitNames =
    lib.concatMap (name: map (u: u.unit) unitsOf.${name}) (lib.attrNames cfg)
    ++ map (name: "app-${name}-restart-when-idle") (lib.attrNames idleApps);

  # What each installer `updatedBy` can name declares: its own channel.
  installerTools = {
    npmGlobal = config.my.pkgs.npmGlobals;
  };
  updatedApps = lib.concatLists (
    lib.mapAttrsToList (
      name: app:
      lib.optionals (app.updatedBy != null) (
        lib.concatMap (
          u:
          lib.mapAttrsToList (installer: tool: {
            inherit installer tool;
            inherit (app) owner;
            unit = "${u.unit}.service";
          }) app.updatedBy
        ) unitsOf.${name}
      )
    ) cfg
  );
  restartStateDirectory = "/run/app-restart";
  waiterUnit = name: "app-${name}-restart-when-idle.service";
  # What restart-app knows of each app unit (scripts.nix restartApp).
  restartTable = lib.listToAttrs (
    lib.concatLists (
      lib.mapAttrsToList (
        name: _:
        map (
          u:
          lib.nameValuePair "${u.unit}.service" (
            lib.optionalAttrs (idleApps ? ${name}) {
              inherit (u) key;
              checked = u.idleCheck != null;
              waiter = waiterUnit name;
            }
            // lib.optionalAttrs (u.companion != null) { main = "app-${name}.service"; }
          )
        ) unitsOf.${name}
      ) cfg
    )
  );
  restartApp = scripts.restartApp restartTable;
  restartAppsUpdatedBy = scripts.restartAppsUpdatedBy restartApp updatedApps;

  # A unit of the app, before what waiting for idle adds.
  appUnit = name: app: u: {
    inherit (u) description environment;
    # Starting the app starts its companions; a companion starts after it.
    # Nothing binds them: a restart of one never stops the other.
    wantedBy = lib.optionals (u.companion == null) [ "multi-user.target" ];
    wants = [
      "network-online.target"
    ]
    ++ lib.optionals (u.companion == null) (
      map (c: "app-${name}-${c}.service") (lib.attrNames app.companions)
    );
    # The owner's Home Manager activation installs what the app runs.
    after = [
      "network-online.target"
      "home-manager-${app.owner}.service"
    ]
    ++ lib.optionals (u.companion != null) [ "app-${name}.service" ];
    path = with pkgs; [
      bash
      coreutils
    ];
    # A package app runs its own program by store path; its companions find
    # the package's other programs first on PATH. An npm app's units find
    # the pinned copy's programs first.
    script = ''
      export PATH="${
        lib.optionalString (u.companion != null && app.package != null) "${lib.getBin app.package}/bin:"
      }${ownerPath app}:$PATH"
      ${
        lib.optionalString (npmPackage app != null) ''
          pinned="$(${lib.getExe scripts.npmPin} ${
            lib.escapeShellArgs (
              [
                name
                (npmPackage app)
                (npmPrefix app)
                (if u.companion == null then "1" else "0")
              ]
              ++ lib.optionals (u.companion == null) (
                map (c: "app-${name}-${c}.service") (lib.attrNames app.companions)
              )
            )
          })"
          export PATH="$pinned:$PATH"
        ''
      }${u.run}
    '';
    serviceConfig = {
      User = app.owner;
      WorkingDirectory = if app.workingDirectory == null then homeOf app else app.workingDirectory;
      Restart = "on-failure";
      RestartSec = 10;
    }
    // lib.optionalAttrs (u.companion == null && app.socket != null) {
      RuntimeDirectory = runtimeDirectory app.socket;
      RuntimeDirectoryMode = "0700";
    };
  };
  # What the unit was declared to run, as one hash: a switch that changes it
  # leaves a restart pending. Only the declaration, not the generated unit,
  # whose script and PATH name bash and coreutils by store path and so change
  # with every nixpkgs bump without changing what the app does. The app's own
  # unit also hashes its companions' names, so adding one restarts it, and
  # its restart starts the companion.
  definitionHash =
    app: u:
    builtins.hashString "sha256" (
      builtins.unsafeDiscardStringContext (
        builtins.toJSON (
          {
            inherit (app)
              owner
              port
              socket
              workingDirectory
              updatedBy
              ;
            inherit (u) run environment;
            package = if app.package == null then null else lib.getExe app.package;
          }
          // lib.optionalAttrs (u.companion == null) { companions = lib.attrNames app.companions; }
        )
      )
    );
in
{
  config = lib.mkIf (cfg != { }) {
    assertions = [
      {
        assertion = lib.length (lib.unique appPorts) == lib.length appPorts;
        message = "my.services: two apps declare the same port.";
      }
      {
        assertion = exposed == { } || config.my.stacks.vpn.enable;
        message = "my.services: an exposed app needs my.stacks.vpn.enable.";
      }
      {
        assertion = lib.length (lib.unique allUnitNames) == lib.length allUnitNames;
        message = "my.services: two apps, companions or waiters share a unit name: ${
          toString (lib.unique (lib.filter (n: lib.count (m: m == n) allUnitNames > 1) allUnitNames))
        }.";
      }
    ]
    ++ lib.concatLists (
      lib.mapAttrsToList (
        name: app:
        [
          {
            assertion = builtins.match "[a-z0-9][a-z0-9-]*" name != null;
            message = "my.services.${name}: app names may contain only lowercase letters, digits, and hyphens.";
          }
          {
            assertion = builtins.elem app.owner config.my.people;
            message = "my.services.${name}.owner is ${app.owner}, who is not one of this host's my.people.";
          }
          {
            assertion = (app.port == null) != (app.socket == null);
            message = "my.services.${name}: set exactly one of port and socket.";
          }
          {
            assertion = (app.package == null) != (app.updatedBy == null);
            message = "my.services.${name}: set exactly one of package (a Nix package) and updatedBy (the installer that upgrades it), so an upgrade restarts it.";
          }
          {
            assertion = app.package == null || app.command == null;
            message = "my.services.${name}: a package app runs its package's main program with args; drop command.";
          }
          {
            assertion = app.updatedBy == null || (app.command != null && app.args == [ ]);
            message = "my.services.${name}: an updatedBy app needs command, the shell command it runs (args are for package apps).";
          }
          {
            assertion =
              app.updatedBy == null
              || lib.all (installer: builtins.elem app.updatedBy.${installer} installerTools.${installer}) (
                lib.attrNames app.updatedBy
              );
            message = "my.services.${name}.updatedBy names a tool its installer's channel does not declare (${builtins.toJSON app.updatedBy}).";
          }
          {
            assertion = app.socket == null || runtimeDirectory app.socket != null;
            message = "my.services.${name}.socket must be /run/<dir>/<file>; the unit owns /run/<dir>.";
          }
          {
            assertion = app.port == null || !builtins.elem app.port reservedPorts;
            message = "my.services.${name}.port ${toString app.port} is already used by a T3 Code server or a Tailscale Service target on this host.";
          }
        ]
        ++ map (companion: {
          assertion = builtins.match "[a-z0-9][a-z0-9-]*" companion != null;
          message = "my.services.${name}.companions.${companion}: companion names may contain only lowercase letters, digits, and hyphens.";
        }) (lib.attrNames app.companions)
        # A switch that drops a unit of an app that waits for idle must not
        # stop it: switch-to-configuration stops a removed unit unless its
        # running definition says X-StopOnRemoval=false.
        ++ lib.optionals (idleApps ? ${name}) (
          map (u: {
            assertion = (config.systemd.services.${u.unit}.unitConfig."X-StopOnRemoval" or null) == false;
            message = "my.services.${name}: ${u.unit} waits for idle, so it must keep X-StopOnRemoval = false; a switch that removes it would stop it mid-work.";
          }) unitsOf.${name}
        )
      ) cfg
    );

    systemd.services =
      lib.listToAttrs (
        lib.concatLists (
          lib.mapAttrsToList (
            name: app:
            map (
              u:
              lib.nameValuePair u.unit (
                let
                  unit = appUnit name app u;
                in
                if !(idleApps ? ${name}) then
                  unit
                else
                  unit
                  // {
                    # A switch never stops or restarts it, changed, removed
                    # or not; the activation script below leaves the restart
                    # to the waiter.
                    restartIfChanged = false;
                    stopIfChanged = false;
                    unitConfig."X-StopOnRemoval" = false;
                    serviceConfig =
                      unit.serviceConfig
                      // {
                        ExecStartPost = "-${scripts.recordStart} ${
                          lib.escapeShellArgs (
                            [
                              u.key
                              (definitionHash app u)
                              (if u.idleCheck != null then "gated" else "free")
                            ]
                            ++ lib.optionals (u.companion == null) (lib.attrNames app.companions)
                          )
                        }";
                      }
                      // lib.optionalAttrs (u.companion != null) {
                        ExecCondition = "${scripts.companionCondition} ${name} ${u.companion}";
                      };
                  }
              )
            ) unitsOf.${name}
          ) cfg
        )
      )
      // lib.mapAttrs' (
        name: app:
        lib.nameValuePair "app-${name}-restart-when-idle" {
          description = "Restart app-${name}'s units once it is idle";
          # So a switch that adds it, and a boot, look for a pending restart.
          wantedBy = [ "multi-user.target" ];
          after = map (u: "${u.unit}.service") unitsOf.${name};
          # A switch leaves a waiting waiter waiting.
          restartIfChanged = false;
          path = [
            pkgs.bash
            pkgs.coreutils
            pkgs.gnugrep
            pkgs.jq
            config.systemd.package
          ];
          script = "exec ${
            scripts.waiter {
              inherit name;
              units = map (u: {
                unit = "${u.unit}.service";
                inherit (u) key;
                checked = u.idleCheck != null;
              }) unitsOf.${name};
              idleChecks = lib.concatMap (u: lib.optional (u.idleCheck != null) u.idleCheck) unitsOf.${name};
              path = ownerPath app;
              pinned = if npmPackage app != null then name else null;
            }
          }";
          serviceConfig = {
            User = app.owner;
            WorkingDirectory = homeOf app;
          };
        }
      ) idleApps;

    # A waiter that gave up (24 h busy) or was never started looks again.
    systemd.timers = lib.mapAttrs' (
      name: _:
      lib.nameValuePair "app-${name}-restart-when-idle" {
        description = "Look for app-${name}'s pending restarts hourly";
        wantedBy = [ "timers.target" ];
        timerConfig = {
          OnBootSec = "1h";
          OnUnitInactiveSec = "1h";
        };
      }
    ) idleApps;

    environment.etc = lib.listToAttrs (
      lib.concatLists (
        lib.mapAttrsToList (
          name: app:
          map (
            u: lib.nameValuePair "app-restart/${u.key}.definition" { text = definitionHash app u; }
          ) unitsOf.${name}
        ) idleApps
      )
    );
    systemd.tmpfiles.rules =
      lib.optionals (idleApps != { }) (
        [ "d ${restartStateDirectory} 0755 root root -" ]
        ++ lib.concatLists (
          lib.mapAttrsToList (
            name: app: map (u: "d ${restartStateDirectory}/${u.key} 0755 ${app.owner} - -") unitsOf.${name}
          ) idleApps
        )
      )
      ++ lib.mapAttrsToList (name: app: "d /var/lib/app-pins/${name} 0755 ${app.owner} - -") (
        lib.filterAttrs (_: app: npmPackage app != null) cfg
      );
    # A switch that changed a running unit's definition, in an app that waits
    # for idle, leaves its restart to the waiter. Not at boot: no unit runs yet.
    system.activationScripts.app-restart = lib.mkIf (idleApps != { }) {
      deps = [ "etc" ];
      text = ''
        ${config.systemd.package}/bin/systemd-tmpfiles --create --prefix=${restartStateDirectory} || true
        ${lib.concatStrings (
          lib.mapAttrsToList (
            name: app:
            lib.concatMapStrings (u: ''
              if ${config.systemd.package}/bin/systemctl is-active -q ${u.unit}.service 2>/dev/null \
                && [ "$(cat ${restartStateDirectory}/${u.key}/started 2>/dev/null)" != ${definitionHash app u} ]; then
                ${lib.getExe restartApp} ${u.unit}.service || true
              fi
            '') unitsOf.${name}
          ) idleApps
        )}
      '';
    };

    my.restartAppsUpdatedBy = restartAppsUpdatedBy;
    environment.systemPackages = [
      restartApp
      restartAppsUpdatedBy
    ];

    # Each owner may restart their own apps' units, and start their waiters:
    # the installers that upgrade them, and the waiters, run as that person.
    security.polkit.enable = true;
    security.polkit.extraConfig = ''
      polkit.addRule(function (action, subject) {
        var units = ${
          builtins.toJSON (
            lib.listToAttrs (
              lib.concatLists (
                lib.mapAttrsToList (
                  name: app:
                  map (
                    u:
                    lib.nameValuePair "${u.unit}.service" {
                      inherit (app) owner;
                      verbs = [
                        "restart"
                        "try-restart"
                      ];
                    }
                  ) unitsOf.${name}
                ) cfg
              )
            )
            // lib.mapAttrs' (
              name: app:
              lib.nameValuePair (waiterUnit name) {
                inherit (app) owner;
                verbs = [ "start" ];
              }
            ) idleApps
          )
        };
        var unit = units[action.lookup("unit")];
        if (action.id == "org.freedesktop.systemd1.manage-units"
            && unit && unit.owner === subject.user
            && unit.verbs.indexOf(action.lookup("verb")) >= 0) {
          return polkit.Result.YES;
        }
      });
    '';

    my.stacks.vpn.services = lib.mapAttrs' (
      name: app: lib.nameValuePair (serviceName name app) { target = app.listenOrigin; }
    ) exposed;
  };
}
