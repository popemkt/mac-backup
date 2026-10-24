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
# restart goes through one command, `restart-app <unit>`.
#
# An app with an `idleCheck` on any of its units is never restarted mid-work.
# A switch leaves all its units running (restartIfChanged = false). Instead
# each unit records, in /run/app-restart/<unit key>/, a hash of the definition
# it started with (what the app declares, not the generated unit, which
# changes with every nixpkgs bump), and `free` when it started without an
# idleCheck; an activation script that finds a different hash runs
# restart-app, which prints "app-<…>: restart pending until idle". For such
# an app restart-app marks the unit's restart requested and starts
# `app-<app>-restart-when-idle`, a waiter unit run as the owner. It restarts
# all of the app's pending units in one try-restart: at once when none of
# them needs to wait, otherwise once every idleCheck of the app passes
# (checked every 30 s; it gives up after 24 h). A unit needs to wait when its
# new definition has an idleCheck or its running process started under one,
# so a process that runs others' work is never cut off by a definition that
# no longer says so. Being a unit, the waiter runs once per app (starting an
# active unit is a no-op), logs to the journal, and lives outside the app's
# cgroups, so the restart it causes does not kill it. It restarts a unit only
# once the switch's daemon-reload has loaded the new definition, never onto
# the old one. The unit's next start records its new hash and clears the
# request. multi-user.target also wants the waiter, so a switch that first
# adds it, and a boot, check for a pending restart too.
# `sudo systemctl restart app-<…>` forces one.
#
# A companion starts only beside an app process that was started with it
# declared (its record lists the companions). A process from before the
# companion existed may still be doing the companion's work itself (bb's
# launcher ran its host daemon in-process), so the companion waits for that
# process's idle-gated restart rather than running a second copy beside it.
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
      environment = app.environment // c.environment;
      run = c.command;
    }) app.companions
  ) cfg;
  # Apps whose restarts wait for idle: an idleCheck on any of their units.
  idleApps = lib.filterAttrs (name: _: lib.any (u: u.idleCheck != null) unitsOf.${name}) cfg;

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
  # What restart-app knows of each app unit: its waiter, if its app waits for
  # idle.
  restartTable = lib.listToAttrs (
    lib.concatLists (
      lib.mapAttrsToList (
        name: _:
        map (
          u:
          lib.nameValuePair "${u.unit}.service" (
            lib.optionalAttrs (idleApps ? ${name}) {
              inherit (u) key;
              waiter = waiterUnit name;
            }
          )
        ) unitsOf.${name}
      ) cfg
    )
  );
  restartApp = pkgs.writeShellApplication {
    name = "restart-app";
    runtimeInputs = [
      pkgs.jq
      pkgs.coreutils
      config.systemd.package
    ];
    text = ''
      # restart-app <unit>: restart a running my.services unit now or, when
      # its app waits for idle, through the app's waiter.
      [ "$#" -eq 1 ] || { echo "usage: restart-app app-<name>.service" >&2; exit 2; }
      unit="$1"
      entry="$(jq -c --arg u "$unit" '.[$u] // empty' ${pkgs.writeText "app-restarts.json" (builtins.toJSON restartTable)})"
      [ -n "$entry" ] || { echo "restart-app: $unit is not a my.services app" >&2; exit 2; }
      key="$(jq -r '.key // empty' <<<"$entry")"
      if [ -z "$key" ]; then
        echo "Restarting $unit"
        systemctl try-restart "$unit" \
          || { echo "warning: could not restart $unit; run: sudo systemctl restart $unit" >&2; exit 1; }
        exit 0
      fi
      waiter="$(jq -r '.waiter' <<<"$entry")"
      requested="${restartStateDirectory}/$key/requested"
      [ -e "$requested" ] || : >"$requested" \
        || echo "warning: could not write $requested" >&2
      echo "$unit: restart pending until idle (or: sudo systemctl restart $unit)"
      # A waiter this very switch adds is not loaded before its daemon-reload;
      # the switch starts it then, since multi-user.target wants it.
      if [ "$(systemctl show -P LoadState "$waiter")" = loaded ]; then
        systemctl start --no-block "$waiter" \
          || echo "warning: could not start $waiter; run: sudo systemctl start $waiter" >&2
      fi
    '';
  };
  restartAppsUpdatedBy = pkgs.writeShellApplication {
    name = "restart-apps-updated-by";
    runtimeInputs = [
      pkgs.jq
      pkgs.coreutils
      restartApp
    ];
    text = ''
      # restart-apps-updated-by <installer> <tool>...: restart every unit of
      # the caller's my.services apps that declared `updatedBy.<installer> =
      # <tool>`.
      [ "$#" -ge 1 ] || { echo "usage: restart-apps-updated-by <installer> <tool>..." >&2; exit 2; }
      installer="$1"
      shift
      user="$(id -un)"
      for tool in "$@"; do
        jq -r --arg i "$installer" --arg t "$tool" --arg u "$user" \
          '.[] | select(.installer == $i and .tool == $t and .owner == $u) | .unit' \
          ${pkgs.writeText "apps-updated-by.json" (builtins.toJSON updatedApps)}
      done | sort -u | while read -r unit; do
        echo "$unit: $installer upgraded what it runs"
        restart-app "$unit" || true
      done
    '';
  };

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
    # the package's other programs first on PATH.
    script = ''
      export PATH="${
        lib.optionalString (u.companion != null && app.package != null) "${lib.getBin app.package}/bin:"
      }${ownerPath app}:$PATH"
      ${u.run}
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
  # with every nixpkgs bump without changing what the app does.
  definitionHash =
    app: u:
    builtins.hashString "sha256" (
      builtins.unsafeDiscardStringContext (
        builtins.toJSON {
          inherit (app)
            owner
            port
            socket
            workingDirectory
            ;
          inherit (u) run environment;
          package = if app.package == null then null else lib.getExe app.package;
        }
      )
    );
  # Run by each unit, as its owner, once it has started.
  recordStart = pkgs.writeShellScript "app-restart-record" ''
    # app-restart-record <key> <hash> <gated|free> <companion>...: the
    # definition the unit started with, whether it started under an
    # idleCheck, and the companions it started with; the start also fulfils
    # any requested restart.
    dir="${restartStateDirectory}/$1"
    printf '%s\n' "$2" >"$dir/started"
    if [ "$3" = free ]; then : >"$dir/free"; else rm -f "$dir/free"; fi
    shift 3
    printf '%s\n' "$@" >"$dir/companions"
    rm -f "$dir/requested"
  '';
  # A companion's ExecCondition: its app's running process declared it.
  companionCondition = pkgs.writeShellScript "app-companion-condition" ''
    # app-companion-condition <app> <companion>
    if ! ${pkgs.gnugrep}/bin/grep -qxF -- "$2" "${restartStateDirectory}/$1/companions" 2>/dev/null; then
      echo "app-$1 still runs a process from before its $2 companion; starting with its next restart"
      exit 1
    fi
  '';
  # Waits until the app's pending units may restart, then restarts them.
  waiterScript = name: app: ''
    export PATH="${ownerPath app}:$PATH"
    dir=${restartStateDirectory}
    # <unit> <key> <1 when its definition has an idleCheck>
    units=(${
      lib.concatMapStringsSep " " (
        u: lib.escapeShellArg "${u.unit}.service ${u.key} ${if u.idleCheck != null then "1" else "0"}"
      ) unitsOf.${name}
    })
    idle() {
      ${lib.concatMapStringsSep " && " (u: "bash -c ${lib.escapeShellArg u.idleCheck}") (
        lib.filter (u: u.idleCheck != null) unitsOf.${name}
      )}
    }
    announced=
    while [ "$SECONDS" -lt 86400 ]; do
      pending=()
      gated=
      loaded=1
      for entry in "''${units[@]}"; do
        read -r unit key checked <<<"$entry"
        systemctl is-active -q "$unit" || continue
        definition="$(cat "/etc/app-restart/$key.definition")"
        [ -e "$dir/$key/requested" ] || [ "$(cat "$dir/$key/started" 2>/dev/null)" != "$definition" ] || continue
        pending+=("$unit")
        # Its new definition, or the process running now, waits for idle.
        if [ "$checked" = 1 ] || [ ! -e "$dir/$key/free" ]; then gated=1; fi
        # Until the switch's daemon-reload, a restart would start the old
        # definition.
        systemctl show -P ExecStartPost "$unit" | grep -qF -- "$definition" || loaded=
      done
      if [ "''${#pending[@]}" -eq 0 ]; then
        echo "app-${name}: no restart pending"
        exit 0
      fi
      if [ -z "$loaded" ]; then
        sleep 5
        continue
      fi
      if [ -z "$gated" ]; then
        echo "Restarting ''${pending[*]}"
        exec systemctl try-restart "''${pending[@]}"
      fi
      if idle; then
        echo "app-${name} is idle; restarting ''${pending[*]}"
        exec systemctl try-restart "''${pending[@]}"
      fi
      if [ -z "$announced" ]; then
        echo "app-${name} is busy; restarting ''${pending[*]} once it is idle (or: sudo systemctl restart <unit>)"
        announced=1
      fi
      sleep 30
    done
    echo "app-${name}: still busy after 24 h; giving up. Restart its units with: sudo systemctl restart <unit>" >&2
    exit 1
  '';
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
        ++ lib.concatMap (companion: [
          {
            assertion =
              builtins.match "[a-z0-9][a-z0-9-]*" companion != null && companion != "restart-when-idle";
            message = "my.services.${name}.companions.${companion}: companion names may contain only lowercase letters, digits, and hyphens, and are not restart-when-idle.";
          }
          {
            assertion = !(cfg ? "${name}-${companion}");
            message = "my.services.${name}.companions.${companion}: its unit app-${name}-${companion} is also the app ${name}-${companion}'s.";
          }
        ]) (lib.attrNames app.companions)
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
                    # A switch never stops or restarts it, changed or not; the
                    # activation script below leaves the restart to the waiter.
                    restartIfChanged = false;
                    stopIfChanged = false;
                    serviceConfig =
                      unit.serviceConfig
                      // {
                        ExecStartPost = "-${recordStart} ${
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
                        ExecCondition = "${companionCondition} ${name} ${u.companion}";
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
          script = waiterScript name app;
          serviceConfig = {
            User = app.owner;
            WorkingDirectory = homeOf app;
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
    systemd.tmpfiles.rules = lib.optionals (idleApps != { }) (
      [ "d ${restartStateDirectory} 0755 root root -" ]
      ++ lib.concatLists (
        lib.mapAttrsToList (
          name: app: map (u: "d ${restartStateDirectory}/${u.key} 0755 ${app.owner} - -") unitsOf.${name}
        ) idleApps
      )
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
