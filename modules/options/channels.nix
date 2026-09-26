# The package channels, as data. pkgs.nix declares one my.pkgs.<name> merge
# target per entry, and mk-stack.nix derives each stack's `extra.*` from the
# same entries, so a channel is named once.
#
# `installedBy` says who installs a channel's members:
# - "executor": a cross-cutting executor reads the merged list and installs
#   it (homebrew.nix, npm-global.nix, bun-global.nix, agent-plugins.nix), so
#   a host can add members through a stack's `extra.<name>`.
# - "owner": the contributing module installs its own members, and the
#   channel only makes membership and pins readable for drift and update
#   checks. A host has nothing to add there, so no `extra.<name>` exists.
{
  taps = {
    description = "Homebrew taps contributed by stacks.";
    installedBy = "executor";
  };
  brews = {
    description = "Homebrew formulae contributed by stacks.";
    installedBy = "executor";
  };
  casks = {
    description = "Homebrew casks contributed by stacks.";
    installedBy = "executor";
  };
  npmGlobals = {
    description = "npm global packages contributed by stacks.";
    installedBy = "executor";
  };
  bunGlobals = {
    description = "Bun global packages contributed by stacks.";
    installedBy = "executor";
  };
  claudeMarketplaces = {
    description = "Claude Code plugin marketplace sources contributed by stacks.";
    installedBy = "executor";
  };
  claudePlugins = {
    description = "Claude Code plugins (plugin@marketplace) contributed by stacks.";
    installedBy = "executor";
  };
  codexMarketplaces = {
    description = "Codex plugin marketplace sources (owner/repo[@ref]) contributed by stacks.";
    installedBy = "executor";
  };
  codexPlugins = {
    description = "Codex plugins (plugin@marketplace) contributed by stacks.";
    installedBy = "executor";
  };
  # Each uv tool needs its own build environment, extras, and --with
  # resolution, so its owning module installs it.
  uvTools = {
    description = "uv tool specs (name[extras]==version) contributed by stacks.";
    installedBy = "owner";
  };
}
