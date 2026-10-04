{
  config,
  lib,
  pkgs,
  ...
}:

let
  stack = config.my.stacks.kb;
  cfg = stack.server;
  agent = config.launchd.user.agents.kb-ui.serviceConfig;
  origin = if cfg.publicOrigin == null then cfg.listenOrigin else cfg.publicOrigin;
in
{
  config = lib.mkIf (stack.enable && cfg.enable) {
    my.systemSetup = {
      components.kb-ui = {
        name = "kb browser UI";
        description = "Packaged graph UI supervised by this user's launchd session.";
        managedBy = "nix";
      };
      integrations.kb-ui-process = {
        name = "kb supervised listener";
        description = "The declared launchd job owns the kb listening port.";
        requiredBy = [ origin ];
        connections = [
          {
            source = "local-host";
            target = "kb-ui";
          }
        ];
        check = {
          kind = "launchd_listener";
          label = agent.Label;
          expected_argv = agent.ProgramArguments;
          inherit (cfg) port;
        };
        enrollment = {
          kind = "manual";
          instructions = ''
            Rebuild installs the kb user agent. macOS must allow it to read the graph
            and packaged runtime. If it stalls on file access, add
            ${pkgs.kb}/bin/kb to Privacy & Security > Full Disk Access, then restart
            org.nixos.kb-ui. Nix package changes may require renewing this approval.
          '';
          url = "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";
        };
        statePaths = [ ];
        secretPolicy = "macOS owns privacy approvals; they are not copied into Git.";
        recovery = "Rebuild, authorize file access if requested, and restart the kb-ui job; inspect ~/Library/Logs/kb-ui.log.";
      };
      integrations.kb-ui = {
        dependsOn = [ "kb-ui-process" ];
        name = "kb browser UI";
        description = "The declared browser origin serves the expected graph through the API guard.";
        requiredBy = [ origin ];
        connections = [
          {
            source = "local-host";
            target = "kb-ui";
          }
        ];
        check = {
          kind = "http_json";
          url = "${origin}/api/identity";
          headers = {
            Origin = origin;
          };
          expected.root = cfg.root;
          success_detail = "kb API accepts ${origin} and serves ${cfg.root}";
        };
        enrollment = {
          kind = "none";
          instructions = "Rebuild starts the declared kb UI; restore its graph checkout if missing.";
        };
        statePaths = [ "${cfg.root}/.kb" ];
        secretPolicy = "Graph content and agent credentials remain user state, outside the service declaration.";
        recovery = "Restore the graph checkout, rebuild, and check the kb-ui launchd agent and ~/Library/Logs/kb-ui.log.";
      };
    };
  };
}
