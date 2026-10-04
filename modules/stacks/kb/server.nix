{
  config,
  lib,
  pkgs,
  ...
}:

let
  stack = config.my.stacks.kb;
  cfg = stack.server;
  home = "/Users/${config.my.username}";
in
{
  config = lib.mkIf (stack.enable && cfg.enable) {
    launchd.user.agents.kb-ui.serviceConfig = {
      ProgramArguments = [
        "${pkgs.kb}/bin/kb"
        "--root"
        cfg.root
        "ui"
        "--port"
        (toString cfg.port)
        "--no-open"
      ]
      ++ lib.optionals (cfg.publicOrigin != null) [
        "--public-origin"
        cfg.publicOrigin
      ];
      WorkingDirectory = home;
      EnvironmentVariables = {
        HOME = home;
        PATH = "${
          lib.makeBinPath [
            pkgs.bun
            pkgs.nodejs
            pkgs.git
          ]
        }:/opt/homebrew/bin:/usr/bin:/bin";
      };
      RunAtLoad = true;
      KeepAlive = true;
      ThrottleInterval = 10;
      ProcessType = "Background";
      StandardOutPath = "${home}/Library/Logs/kb-ui.log";
      StandardErrorPath = "${home}/Library/Logs/kb-ui.log";
    };
  };
}
