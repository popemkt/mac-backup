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
#
# A marketplace whose source is "./<folder>" is a folder of this repo
# (dotfiles=./assets/plugins): its plugins and skills come from its store
# copy (modules/common/home-manager/plugin-sources/, shared with bb plugins),
# never from a person's checkout, through a stable link agent-plugins-sync
# keeps (./sync.sh says how, and how to try a checkout's instead).
let
  home = config.home.homeDirectory;
  codexHome = "${home}/.codex";

  repoRoot = ../../../..;
  source = import ../../../common/home-manager/plugin-sources/source.nix {
    inherit lib;
    kind = "dotfiles-agent";
  };
  state = "${config.xdg.stateHome}/dotfiles/agent-plugins";

  # Each "<name>=./<folder>" entry, as { name; copy; } (copy: the folder in
  # its store copy), or null for any other source. A folder with no
  # marketplace manifest warns rather than failing every evaluation.
  repoFolder =
    entry:
    let
      name = lib.head (lib.splitString "=" entry);
      src = lib.removePrefix "${name}=" entry;
      rel = lib.removePrefix "./" src;
      dir = repoRoot + "/${rel}";
    in
    if !(lib.hasPrefix "./" src) then
      null
    else if builtins.pathExists (dir + "/.claude-plugin/marketplace.json") then
      {
        inherit name;
        copy = "${source dir}/${baseNameOf rel}";
      }
    else
      lib.warn
        "agent plugins: marketplace ${name} names ${src}, which has no .claude-plugin/marketplace.json; it is skipped"
        {
          inherit name;
          copy = null;
        };

  # A repo folder's marketplace is its stable link.
  resolve =
    entry:
    let
      folder = repoFolder entry;
    in
    if folder == null then
      [ entry ]
    else
      lib.optional (folder.copy != null) "${folder.name}=${state}/${folder.name}";

  declared = lib.unique (osConfig.my.pkgs.claudeMarketplaces ++ osConfig.my.pkgs.codexMarketplaces);
  folders = lib.filter (f: f != null && f.copy != null) (map repoFolder declared);

  agentPluginsSync = pkgs.writeShellApplication {
    name = "agent-plugins-sync";
    text = ''
      home=${lib.escapeShellArg home}
      folders=(${lib.concatMapStringsSep " " (f: lib.escapeShellArg "${f.name}=${f.copy}") folders})
      state=${lib.escapeShellArg state}
      legacy=${lib.escapeShellArg "${home}/.dotfiles/assets/plugins"}
      cu=${pkgs.coreutils}/bin
      flock=${pkgs.flock}/bin/flock
      jq=${lib.getExe pkgs.jq}

    ''
    + builtins.readFile ../../../common/home-manager/plugin-sources/sync-lib.sh
    + builtins.readFile ./sync.sh;
  };

  inherit (osConfig.my.pkgs) claudePlugins codexPlugins;
  claudeMarketplaces = lib.concatMap resolve osConfig.my.pkgs.claudeMarketplaces;
  codexMarketplaces = lib.concatMap resolve osConfig.my.pkgs.codexMarketplaces;

  quoted = xs: lib.concatStringsSep " " (map lib.escapeShellArg (lib.unique xs));

  # Runtimes these CLIs need at activation time. Unlike the other executors we
  # cannot invoke the tools by absolute store path — Homebrew and npm own them
  # — so the dependency is declared here instead of assumed from PATH. codex is
  # `#!/usr/bin/env node`, and activation inherits no interactive PATH.
  runtimes = lib.makeBinPath [ pkgs.nodejs ];

  # Shared prelude: the agent CLIs come from Homebrew and npm, not Nix, so
  # every entry point resolves them from PATH and degrades to a warning.
  prelude = ''
    export PATH="${runtimes}:/opt/homebrew/bin:${home}/.local/bin:$PATH"
    export CODEX_HOME=${lib.escapeShellArg codexHome}

    split_name() { printf '%s' "''${1%%=*}"; }
    split_source() { printf '%s' "''${1#*=}"; }
  '';

  # Membership convergence is best effort on purpose: these CLIs are installed
  # by Homebrew and npm during the same rebuild, so on a fresh machine they may
  # not work yet. A missing plugin must never abort system activation.
  #
  # Listing is also the readiness probe. If a list command fails we skip rather
  # than treat empty output as "nothing installed", which would otherwise
  # re-add marketplaces that already exist.
  installScript = ''
    ${lib.getExe agentPluginsSync} || echo "warning: agent-plugins-sync failed" >&2

    claude_plugins() {
      if ! listing="$(claude plugin marketplace list --json 2>/dev/null)"; then
        echo "warning: claude plugin marketplace list failed; skipped its tracked plugins" >&2
        return 0
      fi
      for entry in ${quoted claudeMarketplaces}; do
        name="$(split_name "$entry")"
        source="$(split_source "$entry")"
        # The registered path of a folder marketplace, "-" for another
        # kind, nothing when it is absent.
        if ! registered="$(printf '%s' "$listing" | ${lib.getExe pkgs.jq} -r --arg n "$name" \
          '.[] | select(.name == $n) | .path // "-"')"; then
          echo "warning: cannot read claude's marketplace list; skipped its tracked plugins" >&2
          return 0
        fi
        if [ -z "$registered" ]; then
          echo "Adding Claude Code marketplace: $name"
          claude plugin marketplace add "$source" || {
            echo "warning: failed to add Claude Code marketplace $name" >&2
            continue
          }
        elif [ "''${source#/}" != "$source" ] && [ "$registered" != "$source" ]; then
          # A folder marketplace that moved (the repo's own was read from
          # the checkout before agent-plugins-sync). Adding it under the
          # same name moves it and keeps its plugins and their data, which
          # removing it first would delete.
          echo "Moving Claude Code marketplace $name to $source"
          claude plugin marketplace add "$source" || {
            echo "warning: failed to move Claude Code marketplace $name to $source" >&2
            continue
          }
        fi
      done
      installed="$(claude plugin list 2>/dev/null)" || return 0
      for plugin in ${quoted claudePlugins}; do
        if ! printf '%s' "$installed" | ${pkgs.gnugrep}/bin/grep -qF "$plugin"; then
          echo "Installing Claude Code plugin: $plugin"
          claude plugin install "$plugin" \
            || echo "warning: failed to install $plugin" >&2
        fi
      done
    }

    codex_plugins() {
      if ! listing="$(codex plugin marketplace list 2>/dev/null)"; then
        echo "warning: codex plugin marketplace list failed; skipped its tracked plugins" >&2
        return 0
      fi
      codex features enable hooks >/dev/null 2>&1 || true
      for entry in ${quoted codexMarketplaces}; do
        name="$(split_name "$entry")"
        source="$(split_source "$entry")"
        if ! printf '%s' "$listing" | ${pkgs.gnugrep}/bin/grep -q "^$name[[:space:]]"; then
          echo "Adding Codex marketplace: $name"
          codex plugin marketplace add "$source" || {
            echo "warning: failed to add Codex marketplace $name" >&2
            continue
          }
        fi
      done
      installed="$(codex plugin list 2>/dev/null)" || return 0
      for plugin in ${quoted codexPlugins}; do
        if ! printf '%s' "$installed" \
          | ${pkgs.gnugrep}/bin/grep -q "^$plugin[[:space:]]\+installed,"
        then
          echo "Installing Codex plugin: $plugin"
          codex plugin add "$plugin" \
            || echo "warning: failed to install $plugin" >&2
        fi
      done
    }

    if command -v claude >/dev/null 2>&1; then
      claude_plugins
    else
      echo "warning: claude is unavailable; skipped its tracked plugins" >&2
    fi

    if command -v codex >/dev/null 2>&1; then
      codex_plugins
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
    packages = [
      agentPluginsSync
      updateAgentPlugins
    ];

    # Routine rebuilds only restore missing declarations. `update-system`
    # invokes update-agent-plugins when network-backed upgrades are intentional.
    # After the Bun globals too: Oh My Pi is one.
    activation.installAgentPlugins =
      lib.hm.dag.entryAfter
        [
          "installNpmGlobals"
          "installBunGlobals"
        ]
        ''
          ${prelude}
          ${installScript}
        '';
  };
}
