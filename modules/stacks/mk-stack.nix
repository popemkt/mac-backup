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

  # One list per channel an executor installs (../options/channels.nix).
  # ./default.nix folds every enabled stack's lists into my.pkgs, so a stack
  # never wires its own extras.
  extraChannels = types.submodule {
    options = lib.mapAttrs (_: _: strList) (
      lib.filterAttrs (_: channel: channel.installedBy == "executor") (import ../options/channels.nix)
    );
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
