{
  config,
  osConfig,
  lib,
  pkgs,
  ...
}:

# Executor: agent plugin channels merged from the intent layer
# (modules/stacks/*). Stacks declare membership through
# my.pkgs.{claude,codex}{Marketplaces,Plugins}; this module only installs.
#
# Marketplace entries are "name=source", because the agents' own marketplace
# listings report the resolved name rather than the source they came from, and
# plugin ids are "plugin@marketplace". Codex sources may carry a git ref as
# "owner/repo@ref"; Claude Code has no ref surface, so it always tracks the
# marketplace default branch.
let
  home = config.home.homeDirectory;
  codexHome = "${home}/.codex";

  inherit (osConfig.my.pkgs)
    claudeMarketplaces
    claudePlugins
    codexMarketplaces
    codexPlugins
    ;

  quoted = xs: lib.concatStringsSep " " (map lib.escapeShellArg (lib.unique xs));

  # Shared prelude: the agent CLIs come from Homebrew and npm, not Nix, so
  # every entry point resolves them from PATH and degrades to a warning.
  prelude = ''
    export PATH="/opt/homebrew/bin:${home}/.local/bin:$PATH"
    export CODEX_HOME=${lib.escapeShellArg codexHome}

    split_name() { printf '%s' "''${1%%=*}"; }
    split_source() { printf '%s' "''${1#*=}"; }
  '';

  installScript = ''
    if command -v claude >/dev/null 2>&1; then
      for entry in ${quoted claudeMarketplaces}; do
        name="$(split_name "$entry")"
        source="$(split_source "$entry")"
        if ! claude plugin marketplace list 2>/dev/null \
          | ${pkgs.gnugrep}/bin/grep -q "$name\$"
        then
          echo "Adding Claude Code marketplace: $name"
          claude plugin marketplace add "$source"
        fi
      done
      for plugin in ${quoted claudePlugins}; do
        if ! claude plugin list 2>/dev/null \
          | ${pkgs.gnugrep}/bin/grep -qF "$plugin"
        then
          echo "Installing Claude Code plugin: $plugin"
          claude plugin install "$plugin"
        fi
      done
    else
      echo "warning: claude is unavailable; skipped its tracked plugins" >&2
    fi

    if command -v codex >/dev/null 2>&1; then
      codex features enable hooks >/dev/null 2>&1 || true
      for entry in ${quoted codexMarketplaces}; do
        name="$(split_name "$entry")"
        source="$(split_source "$entry")"
        if ! codex plugin marketplace list 2>/dev/null \
          | ${pkgs.gnugrep}/bin/grep -q "^$name[[:space:]]"
        then
          echo "Adding Codex marketplace: $name"
          codex plugin marketplace add "$source"
        fi
      done
      for plugin in ${quoted codexPlugins}; do
        if ! codex plugin list 2>/dev/null \
          | ${pkgs.gnugrep}/bin/grep -q "^$plugin[[:space:]]\+installed,"
        then
          echo "Installing Codex plugin: $plugin"
          codex plugin add "$plugin"
        fi
      done
    else
      echo "warning: codex is unavailable; skipped its tracked plugins" >&2
    fi
  '';

  updateAgentPlugins = pkgs.writeShellScriptBin "update-agent-plugins" ''
    set -euo pipefail
    ${prelude}

    # Converge membership first so a newly declared plugin is present before
    # the upgrade pass runs over it.
    ${installScript}

    if command -v claude >/dev/null 2>&1; then
      claude plugin marketplace update
      for plugin in ${quoted claudePlugins}; do
        echo "Upgrading tracked Claude Code plugin: $plugin"
        claude plugin update "$plugin"
      done
    fi

    if command -v codex >/dev/null 2>&1; then
      echo "Refreshing tracked Codex marketplaces"
      codex plugin marketplace upgrade
    fi
  '';
in
{
  home = {
    packages = [ updateAgentPlugins ];

    # Routine rebuilds only restore missing declarations. `update-system`
    # invokes update-agent-plugins when network-backed upgrades are intentional.
    activation.installAgentPlugins = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
      ${prelude}
      ${installScript}
    '';
  };
}
