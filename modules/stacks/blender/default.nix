{
  config,
  lib,
  pkgs,
  ...
}:

# Blender for people and for agents on a NixOS host: Blender itself from
# nixpkgs, and `blender-mcp`, a stdio MCP server that gives each agent session
# its own headless Blender (./mcp-stdio.py). The MCP server inside Blender is
# dcc-mcp-blender, the one Blender MCP server that runs in background mode
# (`blender -b`) with no add-on or GUI; why it, and not the add-on servers
# that need a running Blender UI: docs/research/2026-10-31-sandboxes.md
# (Blender). Its pin is a uv pin (_sources/uv-pins.json); uv installs it on
# first use into a venv over Blender's own Python, one per pin, under
# ~/.local/state/blender-mcp.
#
# `blender-mcp` is on every account's PATH; registering it with an agent
# harness is the person's: `claude mcp add --scope user blender -- blender-mcp`.
# GAP [[01M684KYXJ51NYTKYRRN6QPA55]] no channel registers MCP servers with
# agent harnesses.
let
  mkStack = import ../mk-stack.nix lib;
  pin = config.my.uvPins."dcc-mcp-blender".version;
  spec = "dcc-mcp-blender==${pin}";

  blenderMcp = pkgs.writeShellApplication {
    name = "blender-mcp";
    text = ''
      export BLENDER_MCP_BLENDER=${lib.getExe pkgs.blender}
      export BLENDER_MCP_PYTHON=${pkgs.blender.pythonPackages.python.interpreter}
      export BLENDER_MCP_UV=${lib.getExe pkgs.uv}
      export BLENDER_MCP_SPEC=${lib.escapeShellArg spec}
      exec ${lib.getExe pkgs.python3} ${./mcp-stdio.py} "$@"
    '';
  };
in
{
  options.my.stacks.blender = mkStack {
    description = "Blender, with a headless MCP server for agents";
  };

  config = lib.mkIf config.my.stacks.blender.enable {
    environment.systemPackages = [
      pkgs.blender
      blenderMcp
    ];

    # The pin, readable by the uv update and drift checks; blender-mcp
    # installs it itself, per person, on first use.
    my.pkgs.uvTools = [ spec ];
  };
}
