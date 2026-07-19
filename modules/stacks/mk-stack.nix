lib:

# Shared shape for a stack option. Each stack module declares its own
# `options.my.stacks.<name>` with this helper, so schema lives next to the
# behavior it governs. `enable` is the only required knob; `extra` folds
# host-specific packages into the stack's channels; `componentOptions` are
# per-stack sub-toggles or config (e.g. ai-agents.ollama, vpn.services).
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
