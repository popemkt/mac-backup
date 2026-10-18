{
  config,
  lib,
  pkgs,
  ...
}:

# NixOS side of my.services (modules/options/services.nix): one systemd unit,
# `app-<app>`, per declared app, run as its owner, and a Tailscale Service
# `<app>-<owner>` for each exposed one.
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

  appPorts = lib.mapAttrsToList (_: app: app.port) cfg;
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
          assertion = !builtins.elem app.port reservedPorts;
          message = "my.services.${name}.port ${toString app.port} is already used by a T3 Code server or a Tailscale Service target on this host.";
        }
      ]) cfg
    );

    systemd.services = lib.mapAttrs' (
      name: app:
      let
        inherit (config.users.users.${app.owner}) home;
      in
      lib.nameValuePair "app-${name}" {
        description = "${name}, run as ${app.owner} on 127.0.0.1:${toString app.port}";
        wantedBy = [ "multi-user.target" ];
        wants = [ "network-online.target" ];
        # The owner's Home Manager activation installs what the app runs.
        after = [
          "network-online.target"
          "home-manager-${app.owner}.service"
        ];
        environment = {
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
          ${app.command}
        '';
        serviceConfig = {
          User = app.owner;
          WorkingDirectory = if app.workingDirectory == null then home else app.workingDirectory;
          Restart = "on-failure";
          RestartSec = 10;
        };
      }
    ) cfg;

    my.stacks.vpn.services = lib.mapAttrs' (
      name: app: lib.nameValuePair (serviceName name app) { target = app.listenOrigin; }
    ) exposed;
  };
}
