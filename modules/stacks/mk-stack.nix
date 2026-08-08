lib:

# Shared shape for a stack option. Each stack module declares its own
# `options.my.stacks.<name>` with this helper, so schema lives next to the
# behavior it governs. `enable` is the only required knob (stack gate for core
# always-on behavior). `extra` folds host-specific packages into the stack's
# channels. `componentOptions` are optional / host-split / mutually exclusive
# sub-toggles (e.g. ai-agents.ollama, ai-agents.cognee.server, vpn.services).
# See AGENTS.md "Stack enable vs component gates".
let
  inherit (lib) mkOption mkEnableOption types;

  strList = mkOption {
    type = types.listOf types.str;
    default = [ ];
  };

  extraChannels = types.submodule {
    options = {
      taps = strList;
      brews = strList;
      casks = strList;
      npmGlobals = strList;
      bunGlobals = strList;
      claudeMarketplaces = strList;
      claudePlugins = strList;
      codexMarketplaces = strList;
      codexPlugins = strList;
      uvTools = strList;
    };
  };
in
{
  description,
  componentOptions ? { },
}:
mkOption {
  inherit description;
  default = { };
  type = types.submodule {
    options = {
      enable = mkEnableOption description;
      extra = mkOption {
        type = extraChannels;
        default = { };
        description = "Host-specific packages folded into this stack's channels.";
      };
    }
    // componentOptions;
  };
}
