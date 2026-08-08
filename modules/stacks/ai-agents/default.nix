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
  mkStack = import ../mk-stack.nix lib;
  cfg = config.my.stacks.ai-agents;
  inherit (lib)
    mkEnableOption
    mkOption
    optionals
    types
    ;
in
{
  imports = [
    ./cli-proxy-api.nix # local OAuth provider proxy (loopback :8317)
    ./cognee # server and remote-client roles, plus their agent plugins
    ./headroom.nix # context compression: proxy (:8787), RTK, uv tool install
    ./hermes.nix # agent runtime env (HERMES_HOME, Copilot ACP)
  ];

  options.my.stacks.ai-agents = mkStack {
    description = "AI coding agent toolchain";
    componentOptions = {
      ollama = mkOption {
        type = types.bool;
        default = true;
        description = "Install the local Ollama model runtime.";
      };
      archon = mkOption {
        type = types.bool;
        default = true;
        description = "Install the Archon agent command center (tap + formula).";
      };
      cognee = mkOption {
        default = { };
        description = "Cognee server and remote client roles.";
        type = types.submodule {
          options = {
            server = mkOption {
              default = { };
              description = "Stateful Cognee API, UI, databases, models, and gateway.";
              type = types.submodule {
                options = {
                  enable = mkEnableOption "the central Cognee server";
                };
              };
            };
            client = mkOption {
              default = { };
              description = "Thin agent client for a Cognee service hosted on another tailnet machine.";
              type = types.submodule {
                options = {
                  enable = mkEnableOption "the remote Cognee agent client";
                  dataset = mkOption {
                    type = types.str;
                    default = "main_dataset";
                    example = "work";
                    description = "Dataset used by the Codex and Claude Code lifecycle plugins.";
                  };
                };
              };
            };
          };
        };
      };
    };
  };

  config = lib.mkIf cfg.enable {
    my.pkgs = {
      taps =
        optionals cfg.archon [ "coleam00/archon" ]
        ++ [
          "stablyai/orca"
          "vorssaint/tap"
        ]
        ++ cfg.extra.taps;

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
        # Modular menu-bar utility suite from vorssaint/vorssaint-utils.
        "vorssaint/tap/vorssaint"
      ]
      ++ cfg.extra.casks;

      npmGlobals = [
        "@earendil-works/pi-coding-agent"
        "@fission-ai/openspec"
        "@openai/codex"
        "claude-code-templates" # component/agent scaffolding for Claude Code (cct)
        "cline"
        "command-code" # Command Code agent (cmd)
        "gitnexus"
        "reasonix" # DeepSeek-native coding agent
      ]
      ++ cfg.extra.npmGlobals;

      bunGlobals = [
        "@oh-my-pi/pi-coding-agent"
      ]
      ++ cfg.extra.bunGlobals;

      # Stack-owned plugin membership lives with its component (see
      # cognee-plugins.nix); these fold in host-specific additions only.
      claudeMarketplaces = cfg.extra.claudeMarketplaces;
      claudePlugins = cfg.extra.claudePlugins;
      codexMarketplaces = cfg.extra.codexMarketplaces;
      codexPlugins = cfg.extra.codexPlugins;
    };
  };
}
