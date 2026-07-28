{ config, lib, ... }:

# Cognee's agent-side lifecycle plugins. Both Cognee roles consume the same
# two plugins from one upstream repository, so membership lives here rather
# than in either role file; the roles are mutually exclusive and only ever one
# of them is active.
#
# The executor is modules/darwin/home-manager/agent-plugins.nix. Marketplace
# entries are "name=source" because both CLIs list marketplaces by resolved
# name, not by source. Codex pins its ref with the "@main" suffix its CLI
# accepts; Claude Code exposes no ref surface.
let
  cfg = config.my.stacks.ai-agents;
  cogneeEnabled = cfg.enable && (cfg.cognee.server.enable || cfg.cognee.client.enable);
in
{
  config = lib.mkIf cogneeEnabled {
    my.pkgs = {
      claudeMarketplaces = [
        "cognee=topoteretes/cognee-integrations"
      ];
      claudePlugins = [
        "cognee-memory@cognee"
      ];
      codexMarketplaces = [
        "cognee=topoteretes/cognee-integrations@main"
      ];
      codexPlugins = [
        "cognee@cognee"
      ];
    };
  };
}
