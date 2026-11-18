{
  config,
  osConfig,
  lib,
  pkgs,
  ...
}:

# Executor: MCP servers merged from the intent layer (modules/stacks/*)
# through my.pkgs.mcpServers ({name = {command; args; env;};},
# modules/options/channel-types.nix). Stacks decide which servers a host
# has; this module only registers them, with every agent harness this
# account has (./sync.sh says which, and how each is written).
#
# Home Manager activation runs mcp-servers-sync after the npm globals (Claude
# Code and Codex may arrive in the same rebuild); `mcp-servers-sync --check`
# reports what a harness lacks, for the drift audit. Best effort: a harness
# that is missing or fails warns and the rest go on.
let
  home = config.home.homeDirectory;
  inherit (osConfig.my.pkgs) mcpServers;

  # The sync splits names on whitespace and the harnesses key servers by
  # name, so a name is one word.
  badNames = lib.filter (name: builtins.match "[A-Za-z0-9_-]+" name == null) (
    lib.attrNames mcpServers
  );
  servers = pkgs.writeText "mcp-servers.json" (
    lib.throwIf (badNames != [ ])
      "my.pkgs.mcpServers: names must be letters, digits, _ or - (got ${lib.concatStringsSep ", " badNames})"
      (builtins.toJSON mcpServers)
  );

  mcpServersSync = pkgs.writeShellApplication {
    name = "mcp-servers-sync";
    # Its jq programs are single-quoted on purpose: $names in them are jq's.
    excludeShellChecks = [ "SC2016" ];
    text = ''
      home=${lib.escapeShellArg home}
      servers=${servers}
      state=${lib.escapeShellArg "${config.xdg.stateHome}/dotfiles/mcp-servers"}
      cu=${pkgs.coreutils}/bin
      flock=${pkgs.flock}/bin/flock
      jq=${lib.getExe pkgs.jq}
      # claude and codex are Homebrew's, npm's or their own installers', so
      # they come from PATH; codex is `#!/usr/bin/env node`, and activation
      # inherits no interactive PATH.
      export PATH="${lib.makeBinPath [ pkgs.nodejs ]}:/opt/homebrew/bin:${home}/.local/bin:$PATH"
      export CODEX_HOME="''${CODEX_HOME:-${home}/.codex}"

    ''
    + builtins.readFile ../plugin-sources/sync-lib.sh
    + builtins.readFile ./sync.sh;
  };
in
{
  home = {
    packages = [ mcpServersSync ];

    activation.registerMcpServers = lib.hm.dag.entryAfter [ "writeBoundary" "installNpmGlobals" ] ''
      run ${lib.getExe mcpServersSync} || echo "warning: mcp-servers-sync failed" >&2
    '';
  };
}
