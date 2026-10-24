{
  config,
  lib,
  pkgs,
  ...
}:

# NixOS side of my.services (modules/options/services.nix): one systemd unit,
# `app-<app>`, per declared app, run as its owner, and a Tailscale Service
# `<app>-<owner>` for each exposed one. A socket app's unit owns the socket's
# directory as its RuntimeDirectory: created (owner-only) when it starts and
# removed when it stops, so a crash leaves nothing that blocks the restart.
#
# Upgrades restart apps. A `package` app's unit names its program by store
# path, so a switch to a new package restarts it. An `updatedBy` app is
# restarted by its installer through `restart-apps-updated-by`, which reads
# the table below; polkit lets each owner restart their own `app-*` units, so
# the installer needs no sudo. Every such restart goes through one command,
# `restart-app <unit>`.
#
# An app with an `idleCheck` is never restarted mid-work. A switch leaves its
# unit running (restartIfChanged = false). Instead the unit records, in
# /run/app-restart/<app>/started, a hash of the definition it started with
# (what the app declares, not the generated unit, which changes with every
# nixpkgs bump);
# an activation script that finds a different hash runs restart-app, which
# prints "app-<app>: restart pending until idle". For such an app restart-app
# marks a restart requested and starts `app-<app>-restart-when-idle`, a waiter
# unit run as the owner: every 30 s it runs the idleCheck and, once it passes,
# try-restarts the app; it gives up after 24 h. Being a unit, it runs once per
# app (starting an active unit is a no-op), logs to the journal, and lives
# outside the app's cgroup, so the restart it causes does not kill it. It
# restarts the app only once the switch's daemon-reload has loaded the new
# definition, never onto the old one. The app's next start records its new
# hash and clears the request. multi-user.target also wants the waiter, so a
# switch that first adds it, and a boot, check for a pending restart too.
# `sudo systemctl restart app-<app>` forces one.
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
  # What each installer `updatedBy` can name declares: its own channel.
  installerTools = {
    npmGlobal = config.my.pkgs.npmGlobals;
  };
  updatedApps = lib.concatLists (
    lib.mapAttrsToList (
      name: app:
      lib.optionals (app.updatedBy != null) (
        lib.mapAttrsToList (installer: tool: {
          inherit installer tool;
          inherit (app) owner;
          unit = "app-${name}.service";
        }) app.updatedBy
      )
    ) cfg
  );
  idleApps = lib.filterAttrs (_: app: app.idleCheck != null) cfg;
  restartStateDirectory = "/run/app-restart";
  waiterUnit = name: "app-${name}-restart-when-idle.service";
  # What restart-app knows of each app unit: its waiter, if it waits for idle.
  restartTable = lib.mapAttrs' (
    name: app:
    lib.nameValuePair "app-${name}.service" (
      lib.optionalAttrs (app.idleCheck != null) {
        inherit name;
        waiter = waiterUnit name;
      }
    )
  ) cfg;
  restartApp = pkgs.writeShellApplication {
    name = "restart-app";
    runtimeInputs = [
      pkgs.jq
      pkgs.coreutils
      config.systemd.package
    ];
    text = ''
      # restart-app <unit>: restart a running my.services app now or, when it
      # has an idleCheck, once that check passes.
      [ "$#" -eq 1 ] || { echo "usage: restart-app app-<name>.service" >&2; exit 2; }
      unit="$1"
      entry="$(jq -c --arg u "$unit" '.[$u] // empty' ${pkgs.writeText "app-restarts.json" (builtins.toJSON restartTable)})"
      [ -n "$entry" ] || { echo "restart-app: $unit is not a my.services app" >&2; exit 2; }
      name="$(jq -r '.name // empty' <<<"$entry")"
      if [ -z "$name" ]; then
        echo "Restarting $unit"
        systemctl try-restart "$unit" \
          || { echo "warning: could not restart $unit; run: sudo systemctl restart $unit" >&2; exit 1; }
        exit 0
      fi
      waiter="$(jq -r '.waiter' <<<"$entry")"
      requested="${restartStateDirectory}/$name/requested"
      [ -e "$requested" ] || : >"$requested" \
        || echo "warning: could not write $requested" >&2
      echo "app-$name: restart pending until idle (or: sudo systemctl restart app-$name)"
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
      # restart-apps-updated-by <installer> <tool>...: restart the caller's
      # my.services apps that declared `updatedBy.<installer> = <tool>`.
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
  listensOn =
    app: if app.socket != null then "socket ${app.socket}" else "127.0.0.1:${toString app.port}";
  homeOf = app: config.users.users.${app.owner}.home;
  # The owner's installed packages, as their login shell would find them.
  ownerPath =
    app:
    "${homeOf app}/.local/bin:/etc/profiles/per-user/${app.owner}/bin:/run/wrappers/bin:/run/current-system/sw/bin";

  # The app's unit, before what idleCheck adds.
  appUnit = name: app: {
    description = "${name}, run as ${app.owner} on ${listensOn app}";
    wantedBy = [ "multi-user.target" ];
    wants = [ "network-online.target" ];
    # The owner's Home Manager activation installs what the app runs.
    after = [
      "network-online.target"
      "home-manager-${app.owner}.service"
    ];
    environment =
      lib.optionalAttrs (app.port != null) {
        HOST = "127.0.0.1";
        PORT = toString app.port;
      }
      // app.environment;
    path = with pkgs; [
      bash
      coreutils
    ];
    script = ''
      export PATH="${ownerPath app}:$PATH"
      ${
        if app.package != null then
          "exec ${lib.escapeShellArgs ([ (lib.getExe app.package) ] ++ app.args)}"
        else
          app.command
      }
    '';
    serviceConfig = {
      User = app.owner;
      WorkingDirectory = if app.workingDirectory == null then homeOf app else app.workingDirectory;
      Restart = "on-failure";
      RestartSec = 10;
    }
    // lib.optionalAttrs (app.socket != null) {
      RuntimeDirectory = runtimeDirectory app.socket;
      RuntimeDirectoryMode = "0700";
    };
  };
  # What the app was declared to run, as one hash: a switch that changes it
  # leaves a restart pending. Only the declaration, not the generated unit,
  # whose script and PATH name bash and coreutils by store path and so change
  # with every nixpkgs bump without changing what the app does.
  definitionHash =
    app:
    builtins.hashString "sha256" (
      builtins.unsafeDiscardStringContext (
        builtins.toJSON {
          inherit (app)
            owner
            port
            socket
            command
            args
            environment
            workingDirectory
            ;
          package = if app.package == null then null else lib.getExe app.package;
        }
      )
    );
  definitionFile = name: "/etc/app-restart/${name}.definition";
  # Run by the unit, as its owner, once it has started.
  recordStart = pkgs.writeShellScript "app-restart-record" ''
    # app-restart-record <app> <hash>: the definition <app> started with;
    # the start also fulfils any requested restart.
    printf '%s\n' "$2" >"${restartStateDirectory}/$1/started"
    rm -f "${restartStateDirectory}/$1/requested"
  '';
  # Waits for an idleCheck app to report idle, then restarts it.
  waiterScript = name: app: ''
    export PATH="${ownerPath app}:$PATH"
    unit=app-${name}.service
    dir=${restartStateDirectory}/${name}
    definition() { cat ${definitionFile name}; }
    pending() {
      [ -e "$dir/requested" ] || [ "$(cat "$dir/started" 2>/dev/null)" != "$(definition)" ]
    }
    announced=
    for ((i = 0; i < 2880; i++)); do
      systemctl is-active -q "$unit" || { echo "$unit is not running; nothing to restart"; exit 0; }
      pending || { echo "$unit: no restart pending"; exit 0; }
      if ! systemctl show -P ExecStartPost "$unit" | grep -qF -- "$(definition)"; then
        # The switch has not yet run daemon-reload: a restart now would
        # start the old definition.
        :
      elif bash -c ${lib.escapeShellArg app.idleCheck}; then
        echo "$unit is idle; restarting it"
        exec systemctl try-restart "$unit"
      elif [ -z "$announced" ]; then
        echo "$unit is busy; restarting it once it is idle (or: sudo systemctl restart $unit)"
        announced=1
      fi
      sleep 30
    done
    echo "$unit: still busy after 24 h; giving up. Restart it with: sudo systemctl restart $unit" >&2
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
      lib.mapAttrsToList (name: app: [
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
      ]) cfg
    );

    systemd.services =
      lib.mapAttrs' (
        name: app:
        lib.nameValuePair "app-${name}" (
          let
            unit = appUnit name app;
          in
          if app.idleCheck == null then
            unit
          else
            unit
            // {
              # A switch never stops or restarts it, changed or not; the
              # activation script below leaves the restart to its waiter.
              restartIfChanged = false;
              stopIfChanged = false;
              serviceConfig = unit.serviceConfig // {
                ExecStartPost = "-${recordStart} ${name} ${definitionHash app}";
              };
            }
        )
      ) cfg
      // lib.mapAttrs' (
        name: app:
        lib.nameValuePair "app-${name}-restart-when-idle" {
          description = "Restart app-${name} once it is idle";
          # So a switch that adds it, and a boot, look for a pending restart.
          wantedBy = [ "multi-user.target" ];
          after = [ "app-${name}.service" ];
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

    environment.etc = lib.mapAttrs' (
      name: app: lib.nameValuePair "app-restart/${name}.definition" { text = definitionHash app; }
    ) idleApps;
    systemd.tmpfiles.rules = lib.optionals (idleApps != { }) (
      [ "d ${restartStateDirectory} 0755 root root -" ]
      ++ lib.mapAttrsToList (
        name: app: "d ${restartStateDirectory}/${name} 0755 ${app.owner} - -"
      ) idleApps
    );
    # A switch that changed an idleCheck app's running definition leaves its
    # restart pending until the app is idle. Not at boot: no unit runs yet.
    system.activationScripts.app-restart = lib.mkIf (idleApps != { }) {
      deps = [ "etc" ];
      text = ''
        ${config.systemd.package}/bin/systemd-tmpfiles --create --prefix=${restartStateDirectory} || true
        ${lib.concatStrings (
          lib.mapAttrsToList (name: app: ''
            if ${config.systemd.package}/bin/systemctl is-active -q app-${name}.service 2>/dev/null \
              && [ "$(cat ${restartStateDirectory}/${name}/started 2>/dev/null)" != ${definitionHash app} ]; then
              ${lib.getExe restartApp} app-${name}.service || true
            fi
          '') idleApps
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
            lib.mapAttrs' (
              name: app:
              lib.nameValuePair "app-${name}.service" {
                inherit (app) owner;
                verbs = [
                  "restart"
                  "try-restart"
                ];
              }
            ) cfg
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
