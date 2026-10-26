{
  config,
  lib,
  ...
}:

# Claude Code mods: plugins built on function hooks that add panes and status
# lines to the Claude Code UI. Catalogue: karanb192/awesome-claude-code-mods.
# The executor is modules/darwin/home-manager/agent-plugins/; marketplace
# entries are "name=source".
lib.mkIf config.my.stacks.ai-agents.enable {
  my.pkgs = {
    # The terminal-browser plugin drives this binary (homebrew/cask, upstream
    # zenbu-labs/terminal-browser).
    casks = [ "terminal-browser" ];

    claudeMarketplaces = [
      "terminal-browser=zenbu-labs/terminal-browser"
      "claude-flightdeck=scasella/claude-flightdeck"
      # The repo's own plugins (assets/plugins), as the revision applied
      # has them; `agent-plugins-sync --path` tries a checkout's.
      "dotfiles=./assets/plugins"
    ];
    claudePlugins = [
      # A browser pane beside the conversation: /browser.
      "terminal-browser@terminal-browser"
      # A live, read-only dashboard of agents, permissions and cost: /flightdeck.
      "flightdeck@claude-flightdeck"
      # Every skill, agent, hook, MCP server, plugin and setting in force, and
      # per-repo profiles of them: /artifacts, /agent-profile.
      "agent-artifacts@dotfiles"
    ];
  };
}
