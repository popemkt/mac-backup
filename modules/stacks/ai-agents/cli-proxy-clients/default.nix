{
  config,
  lib,
  pkgs,
  ...
}:

# Desktop apps whose AI connection points at the local CLIProxyAPI. The apps
# are installed outside Nix and keep their settings in mutable stores;
# `cli-proxy-clients apply` (converge.py) merges only the connection into each
# one and leaves every other setting, including which model to use, to the app.
# Activation applies it; system-setup checks each app with
# `cli-proxy-clients check <app>`.
let
  inherit (config.my) username;
  home = config.users.users.${username}.home;
  cfg = config.my.stacks.ai-agents;
  clients = cfg.cliProxyClients;
  apps = {
    tinycast = {
      name = "Tinycast";
      description = "Launcher whose AI chat uses a CLIProxyAPI connection.";
      statePaths = [ "${home}/Library/Preferences/com.tinycast.app.plist" ];
      # The keyword arguments of its client class in converge.py.
      settings = { inherit (clients.tinycast) models; };
    };
  };
  enabled = lib.filter (name: clients.${name}.enable) (lib.attrNames apps);
  cliProxyClients = pkgs.writeShellScriptBin "cli-proxy-clients" ''
    exec ${pkgs.python313}/bin/python3 -I ${./converge.py} ${
      pkgs.writeText "cli-proxy-clients.json" (
        builtins.toJSON {
          baseUrl = "http://127.0.0.1:${toString cfg.cliProxyApi.port}/v1";
          clients = lib.genAttrs enabled (app: apps.${app}.settings);
        }
      )
    } "$@"
  '';
  bin = "${cliProxyClients}/bin/cli-proxy-clients";
in
lib.mkIf (cfg.enable && enabled != [ ]) {
  home-manager.users.${username} =
    { lib, ... }:
    {
      home.packages = [ cliProxyClients ];
      home.activation.applyCliProxyClients = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        $DRY_RUN_CMD ${bin} apply || true
      '';
    };

  my.systemSetup = {
    components = lib.genAttrs enabled (app: {
      inherit (apps.${app}) name description;
      managedBy = "hybrid";
    });

    integrations = lib.listToAttrs (
      map (
        app:
        lib.nameValuePair "cli-proxy-client-${app}" {
          name = "${apps.${app}.name} via CLIProxyAPI";
          description = "Prove ${apps.${app}.name} is connected to CLIProxyAPI and the proxy answers.";
          required = false;
          requiredBy = [ "${apps.${app}.name} AI features (optional)" ];
          connections = [
            {
              source = app;
              target = "cli-proxy-api";
            }
          ];
          check = {
            kind = "command";
            argv = [
              bin
              "check"
              app
            ];
            success_detail = "${apps.${app}.name} is connected to CLIProxyAPI";
          };
          enrollment = {
            kind = "command";
            instructions = ''
              Launch ${apps.${app}.name} once so its settings exist, then connect it.
              Rebuild does the same. Restart the app afterwards to load the change.
            '';
            argv = [
              bin
              "apply"
              app
            ];
          };
          inherit (apps.${app}) statePaths;
          secretPolicy = "No secrets: CLIProxyAPI trusts loopback clients, so no API key is stored.";
          recovery = "Run this enrollment again; the connection is recreated from Nix.";
        }
      ) enabled
    );
  };
}
