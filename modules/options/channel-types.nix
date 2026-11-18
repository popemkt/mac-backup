lib:

# The value types a channel in ./channels.nix can hold, by the name its
# `type` gives (absent: "strings"). pkgs.nix declares each my.pkgs.<name>
# with its channel's type, and mk-stack.nix each stack's extra.<name>, so a
# channel's shape is named once and every reader agrees on it.
let
  inherit (lib) mkOption types;
in
{
  # Package names, specs or sources, one string each; executors dedupe them.
  strings = {
    type = types.listOf types.str;
    default = [ ];
  };

  # MCP servers by name. Servers from several stacks merge by name, but each
  # server is declared once, whole: a second declaration of a name is an
  # evaluation error rather than a merge of two servers' args and env
  # (../common/home-manager/mcp-servers/tests.nix checks it).
  mcpServers = {
    type = types.attrsOf (
      types.unique { message = "An MCP server is declared once, whole: declare it in one module."; } (
        types.submodule {
          options = {
            command = mkOption {
              type = types.str;
              description = "The server's program, by absolute path (a store path), started over stdio.";
            };
            args = mkOption {
              type = types.listOf types.str;
              default = [ ];
              description = "Arguments the program is started with.";
            };
            env = mkOption {
              type = types.attrsOf types.str;
              default = { };
              description = "Environment variables the program is started with.";
            };
          };
        }
      )
    );
    default = { };
  };
}
