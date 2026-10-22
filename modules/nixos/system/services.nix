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
# the installer needs no sudo.
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
  restartAppsUpdatedBy = pkgs.writeShellApplication {
    name = "restart-apps-updated-by";
    runtimeInputs = [
      pkgs.jq
      pkgs.coreutils
      config.systemd.package
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
        echo "Restarting $unit: $installer upgraded what it runs"
        systemctl try-restart "$unit" \
          || echo "warning: could not restart $unit; run: sudo systemctl restart $unit" >&2
      done
    '';
  };
  listensOn =
    app: if app.socket != null then "socket ${app.socket}" else "127.0.0.1:${toString app.port}";
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
          assertion = app.package == null || app.executable == null;
          message = "my.services.${name}: a package app runs its package's main program; drop executable.";
        }
        {
          assertion = app.updatedBy == null || app.executable != null;
          message = "my.services.${name}: an updatedBy app needs executable, the program it runs.";
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

    systemd.services = lib.mapAttrs' (
      name: app:
      let
        inherit (config.users.users.${app.owner}) home;
        socketDirectory = runtimeDirectory app.socket;
      in
      lib.nameValuePair "app-${name}" {
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
        # The owner's installed packages, as their login shell would find them.
        script = ''
          export PATH="${home}/.local/bin:/etc/profiles/per-user/${app.owner}/bin:/run/wrappers/bin:/run/current-system/sw/bin:$PATH"
          exec ${lib.escapeShellArgs ([ app.program ] ++ app.args)}
        '';
        serviceConfig = {
          User = app.owner;
          WorkingDirectory = if app.workingDirectory == null then home else app.workingDirectory;
          Restart = "on-failure";
          RestartSec = 10;
        }
        // lib.optionalAttrs (app.socket != null) {
          RuntimeDirectory = socketDirectory;
          RuntimeDirectoryMode = "0700";
        };
      }
    ) cfg;

    my.restartAppsUpdatedBy = restartAppsUpdatedBy;
    environment.systemPackages = [ restartAppsUpdatedBy ];

    # Each owner may restart their own apps' units: the installers that
    # upgrade them run as that person.
    security.polkit.enable = true;
    security.polkit.extraConfig = ''
      polkit.addRule(function (action, subject) {
        var owners = ${
          builtins.toJSON (lib.mapAttrs' (name: app: lib.nameValuePair "app-${name}.service" app.owner) cfg)
        };
        if (action.id == "org.freedesktop.systemd1.manage-units"
            && owners[action.lookup("unit")] === subject.user
            && ["restart", "try-restart"].indexOf(action.lookup("verb")) >= 0) {
          return polkit.Result.YES;
        }
      });
    '';

    my.stacks.vpn.services = lib.mapAttrs' (
      name: app: lib.nameValuePair (serviceName name app) { target = app.listenOrigin; }
    ) exposed;
  };
}
