{
  config,
  lib,
  pkgs,
  ...
}:

# canvas-links: which tldraw offline canvases each agent session (bb thread,
# Claude Code, Codex, Orca) created or edited. The `canvas-link` CLI (./cli)
# is the one writer and reader: agents record links through it (the
# tldraw-conventions skill tells them to), and the bb plugin
# (assets/bb-plugins/canvas-links) lists and opens them through it. The bb
# stack registers that plugin: it installs where the bb server runs
# (shared-server), which does not run this stack.
#
# The log is state, not configuration (docs/backup-strategy.md): each machine
# appends to ~/.local/state/canvas-links/links.jsonl and pushes unsent rows
# over Tailscale SSH to shared-server, which keeps one file per machine.
let
  canvasLink = pkgs.writeShellScriptBin "canvas-link" ''
    export CANVAS_LINK_CENTRAL="''${CANVAS_LINK_CENTRAL-shared-server}"
    exec ${lib.getExe pkgs.nodejs} ${./cli}/canvas-link.mjs "$@"
  '';
in
lib.mkIf config.my.stacks.ai-agents.enable {
  my.everyone.home.packages = [ canvasLink ];
}
