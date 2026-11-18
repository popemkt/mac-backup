# The package channels, as data. pkgs.nix declares one my.pkgs.<name> merge
# target per entry, and mk-stack.nix derives each stack's `extra.*` from the
# same entries, so a channel is named once.
#
# `type` names the value a channel holds (./channel-types.nix); absent, a
# list of strings.
#
# An executor records its effective members at my.packageExecutors.<name>
# in the named scope. Owner-installed channels expose membership only.
{
  taps = {
    description = "Homebrew taps contributed by stacks.";
    executor = "darwinSystem";
  };
  brews = {
    description = "Homebrew formulae contributed by stacks.";
    executor = "darwinSystem";
  };
  casks = {
    description = "Homebrew casks contributed by stacks.";
    executor = "darwinSystem";
  };
  npmGlobals = {
    description = "npm global packages contributed by stacks.";
    executor = "home";
  };
  bunGlobals = {
    description = "Bun global packages contributed by stacks.";
    executor = "darwinHome";
  };
  claudeMarketplaces = {
    description = "Claude Code plugin marketplace sources contributed by stacks.";
    executor = "home";
  };
  claudePlugins = {
    description = "Claude Code plugins (plugin@marketplace) contributed by stacks.";
    executor = "home";
  };
  codexMarketplaces = {
    description = "Codex plugin marketplace sources (owner/repo[@ref]) contributed by stacks.";
    executor = "home";
  };
  codexPlugins = {
    description = "Codex plugins (plugin@marketplace) contributed by stacks.";
    executor = "home";
  };
  # Registered by modules/common/home-manager/mcp-servers/ with every agent
  # harness on the host that has one: Claude Code (user scope), Codex,
  # Cursor, opencode, Gemini CLI, Oh My Pi and Hermes.
  mcpServers = {
    description = "MCP servers (by name: command, args, env or HTTP url) contributed by stacks, registered with every agent harness on the host.";
    executor = "home";
    type = "mcpServers";
  };
  # "<name>=<folder>": a folder whose subfolders are skills (each with a
  # SKILL.md), such as one a package ships; linked into every agent's skills
  # by agent-plugins-sync (modules/common/home-manager/agent-plugins/). A
  # folder that is not there is skipped, so a package may ship it later.
  agentSkills = {
    description = "Folders of agent skills (name=<folder of skill folders>, often in a package) contributed by stacks, linked into every agent's skills.";
    executor = "home";
  };
  bbPlugins = {
    description = "bb plugins kept in this repo (folders relative to the repo root, installed from the Nix store) contributed by stacks.";
    executor = "home";
  };
  # Attribute names in nixpkgs. NixOS's system module hands them to nix-ld,
  # so prebuilt binaries (npm, browser downloads) find them at run time.
  nixLdLibraries = {
    description = "nixpkgs attribute names of shared libraries nix-ld exposes to prebuilt binaries, contributed by stacks.";
    executor = "nixosSystem";
  };
  # Each uv tool needs its own build environment, extras, and --with
  # resolution, so its owning module installs it.
  uvTools = {
    description = "uv tool specs (name[extras]==version) contributed by stacks.";
  };
}
