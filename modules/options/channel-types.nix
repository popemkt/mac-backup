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

  # MCP servers by name. Contributions merge by name; two stacks declaring
  # one name with different values is an evaluation error.
  mcpServers = {
    type = types.attrsOf (
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
    );
    default = { };
  };
}
