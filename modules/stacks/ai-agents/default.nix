{ config, lib, ... }:

# AI coding agent toolchain: agent CLIs, desktop apps, orchestrators, the
# tools agents call (officecli is also tagged in office-docs), plus the
# local AI service daemons (proxies, agent runtime env).
#
# Folder stack: heavier per-tool behavior (daemons, config, activation)
# lives in sibling files gated on the same toggle; simple install-only
# entries stay in the my.pkgs lists below.
{
  imports = [
    ./cli-proxy-api.nix # local OAuth provider proxy (loopback :8317)
    ./headroom.nix # context-compression proxy (:8787) + uv tool install
    ./hermes.nix # agent runtime env (HERMES_HOME, Copilot ACP)
  ];

  config = lib.mkIf config.my.stacks.ai-agents {
    my.pkgs = {
      taps = [
        "coleam00/archon"
        "stablyai/orca"
      ];

      brews = [
        # Archon: agent command center; tap-qualified name.
        "coleam00/archon/archon"
        # Read/edit/automate Office docs (.docx/.xlsx/.pptx) — agent tool set.
        # Self-contained binary in homebrew-core; deps dotnet.
        "officecli"
        # Local model runtime.
        "ollama"
      ];

      casks = [
        "antigravity-cli"
        "chatgpt"
        "claude"
        "claude-code@latest"
        "copilot-cli" # GitHub Copilot CLI (agentic terminal assistant)
        # Use the fully-qualified tap path. Bare "orca" is the unrelated Plotly cask.
        "stablyai/orca/orca"
      ];

      npmGlobals = [
        "@earendil-works/pi-coding-agent"
        "@fission-ai/openspec"
        "@openai/codex"
        "claude-code-templates" # component/agent scaffolding for Claude Code (cct)
        "cline"
        "gitnexus"
      ];

      bunGlobals = [
        "@oh-my-pi/pi-coding-agent"
      ];
    };
  };
}
