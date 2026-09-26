{ config, ... }:

# Cognee component of the ai-agents stack. The two roles are mutually
# exclusive per host, which this component asserts because it owns both;
# plugins.nix carries the agent plugin membership both roles share.
#
# The Cognee entries in ../system-setup.nix stay there because that file also
# covers CLIProxyAPI and is scoped to the stack rather than this component.
let
  cfg = config.my.stacks.ai-agents.cognee;
in
{
  imports = [
    ./client.nix # thin remote bridge to a Cognee service on another host
    ./plugins.nix # Codex/Claude Code lifecycle plugins for both roles
    ./server.nix # authenticated memory API + UI (loopback :8088)
  ];

  assertions = [
    {
      assertion = !(cfg.server.enable && cfg.client.enable);
      message = "Cognee server and remote client roles cannot both be enabled on one host.";
    }
  ];
}
