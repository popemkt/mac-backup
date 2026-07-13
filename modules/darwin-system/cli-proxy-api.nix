{
  config,
  pkgs,
  ...
}:

let
  inherit (config.my) username;
  home = "/Users/${username}";
  port = 8317;
  configPath = "${home}/.config/cli-proxy-api/config.yaml";

  configFile = (pkgs.formats.yaml { }).generate "cli-proxy-api.yaml" {
    host = "127.0.0.1";
    inherit port;

    tls.enable = false;

    remote-management = {
      allow-remote = false;
      secret-key = "";
      disable-control-panel = true;
    };

    auth-dir = "${home}/.local/share/cli-proxy-api";
    # Deliberately trust local clients. The service is loopback-only and this
    # machine is operated as a single-user workstation.
    api-keys = [ ];

    debug = false;
    logging-to-file = false;
    usage-statistics-enabled = false;
  };
in
{
  home-manager.users.${username} =
    { lib, ... }:
    {
      home.packages = [ pkgs.cli-proxy-api ];
      home.file.".config/cli-proxy-api/config.yaml".source = configFile;
      home.activation.ensureCliProxyApiState = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        $DRY_RUN_CMD ${pkgs.coreutils}/bin/install -d -m 0700 \
          "${home}/.local/share/cli-proxy-api"
      '';
    };

  # CLIProxyAPI exposes OAuth-backed providers through a local API. Keep the
  # generic OpenAI/Anthropic base URL variables unset globally so clients opt in
  # explicitly and continue working when this service is unavailable.
  launchd.user.agents.cli-proxy-api = {
    serviceConfig = {
      ProgramArguments = [
        "${pkgs.cli-proxy-api}/bin/cli-proxy-api"
        "-config"
        configPath
      ];
      RunAtLoad = true;
      KeepAlive.SuccessfulExit = false;
      ThrottleInterval = 30;
      WorkingDirectory = home;
      StandardOutPath = "${home}/Library/Logs/cli-proxy-api.out.log";
      StandardErrorPath = "${home}/Library/Logs/cli-proxy-api.err.log";
      EnvironmentVariables.HOME = home;
    };
  };
}
