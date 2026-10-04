{ config, lib, ... }:

let
  stack = config.my.stacks.kb;
  cfg = stack.server;
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
      integrations.kb-ui = {
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
