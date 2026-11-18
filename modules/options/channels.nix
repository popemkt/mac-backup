# The package channels, as data. pkgs.nix declares one my.pkgs.<name> merge
# target per entry, and mk-stack.nix derives each stack's `extra.*` from the
# same entries, so a channel is named once.
#
# `type` names the value a channel holds (./channel-types.nix); absent, a
# list of strings.
#
# `installedBy` says who installs a channel's members:
# - "executor": a cross-cutting executor reads the merged list and installs
#   it (homebrew.nix, npm-global.nix, bun-global.nix, agent-plugins/,
#   bb-plugins/), so a host can add members through a stack's
#   `extra.<name>`.
# - "owner": the contributing module installs its own members, and the
#   channel only makes membership and pins readable for drift and update
#   checks. A host has nothing to add there, so no `extra.<name>` exists.
#
# GAP [[01M3E9V4VV52HJPW181Y74AR0J]] no check proves each executor installs
# its channel.
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
  # Registered by modules/common/home-manager/mcp-servers/ with every agent
  # harness on the host that has one: Claude Code (user scope), Codex,
  # Cursor, opencode, Gemini CLI and Oh My Pi.
  mcpServers = {
    description = "MCP servers (by name: command, args, env) contributed by stacks, registered with every agent harness on the host.";
    installedBy = "executor";
    type = "mcpServers";
  };
  # "<name>=<folder>": a folder whose subfolders are skills (each with a
  # SKILL.md), such as one a package ships; linked into every agent's skills
  # by agent-plugins-sync (modules/darwin/home-manager/agent-plugins/). A
  # folder that is not there is skipped, so a package may ship it later.
  agentSkills = {
    description = "Folders of agent skills (name=<folder of skill folders>, often in a package) contributed by stacks, linked into every agent's skills.";
    installedBy = "executor";
  };
  bbPlugins = {
    description = "bb plugins kept in this repo (folders relative to the repo root, installed from the Nix store) contributed by stacks.";
    installedBy = "executor";
  };
  # Attribute names in nixpkgs. NixOS's system module hands them to nix-ld,
  # so prebuilt binaries (npm, browser downloads) find them at run time.
  nixLdLibraries = {
    description = "nixpkgs attribute names of shared libraries nix-ld exposes to prebuilt binaries, contributed by stacks.";
    installedBy = "executor";
  };
  # Each uv tool needs its own build environment, extras, and --with
  # resolution, so its owning module installs it.
  uvTools = {
    description = "uv tool specs (name[extras]==version) contributed by stacks.";
    installedBy = "owner";
  };
}
