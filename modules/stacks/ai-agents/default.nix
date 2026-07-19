{ config, lib, ... }:

# AI coding agent toolchain: agent CLIs, desktop apps, orchestrators, the
# tools agents call (officecli is also tagged in office-docs), plus the
# local AI service daemons (proxies, agent runtime env).
#
# Folder stack: heavier per-tool behavior (daemons, config, activation)
# lives in sibling files gated on the same toggle; simple install-only
# entries stay in the my.pkgs lists below.
#
# Customizable: `cfg.ollama` / `cfg.archon` component toggles drop optional
# members; `cfg.extra.*` folds in host-specific additions.
let
  cfg = config.my.stacks.ai-agents;
  inherit (lib) optionals;
in
{
  imports = [
    ./cli-proxy-api.nix # local OAuth provider proxy (loopback :8317)
    ./headroom.nix # context-compression proxy (:8787) + uv tool install
    ./hermes.nix # agent runtime env (HERMES_HOME, Copilot ACP)
  ];

  config = lib.mkIf cfg.enable {
    my.pkgs = {
      taps = optionals cfg.archon [ "coleam00/archon" ] ++ [ "stablyai/orca" ] ++ cfg.extra.taps;

      brews = [
        # Read/edit/automate Office docs (.docx/.xlsx/.pptx) — agent tool set.
        # Self-contained binary in homebrew-core; deps dotnet.
        "officecli"
      ]
      # Archon: agent command center; tap-qualified name.
      ++ optionals cfg.archon [ "coleam00/archon/archon" ]
      # Local model runtime.
      ++ optionals cfg.ollama [ "ollama" ]
      ++ cfg.extra.brews;

      casks = [
        "antigravity-cli"
        "chatgpt"
        "claude"
        "claude-code@latest"
        "copilot-cli" # GitHub Copilot CLI (agentic terminal assistant)
        # Use the fully-qualified tap path. Bare "orca" is the unrelated Plotly cask.
        "stablyai/orca/orca"
      ]
      ++ cfg.extra.casks;

      npmGlobals = [
        "@earendil-works/pi-coding-agent"
        "@fission-ai/openspec"
        "@openai/codex"
        "claude-code-templates" # component/agent scaffolding for Claude Code (cct)
        "cline"
        "gitnexus"
      ]
      ++ cfg.extra.npmGlobals;

      bunGlobals = [
        "@oh-my-pi/pi-coding-agent"
      ]
      ++ cfg.extra.bunGlobals;
    };
  };
}
