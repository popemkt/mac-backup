{ lib, ... }:

# Intent layer schema. Stacks are vertical slices (functionality); the
# channel lists below are the merge targets they contribute to. Executors
# (homebrew.nix, npm-global.nix, bun-global.nix) read the merged lists and
# install — they never decide membership.
#
# A package may appear in several stacks (tag-style); executors dedupe
# with lib.unique.
#
# Each stack is a submodule, not a bare bool — same mechanism nixpkgs uses
# for `services.*`/`programs.*`. `enable` is the only knob a host must set;
# component sub-options and `extra` are defaulted, overridden only when
# wanted:
#
#   my.stacks.ai-agents.enable = true;        # all defaults
#
#   my.stacks.ai-agents = {
#     enable = true;
#     ollama = false;                         # drop a component
#     extra.npmGlobals = [ "work-only-cli" ]; # host addition
#   };
let
  inherit (lib) mkOption mkEnableOption types;

  strList = mkOption {
    type = types.listOf types.str;
    default = [ ];
  };

  # Host-side additions folded into a stack's channel contributions. Same
  # five channels the executors read; kept per-stack so an addition is
  # colocated with the intent it belongs to.
  extraChannels = types.submodule {
    options = {
      taps = strList;
      brews = strList;
      casks = strList;
      npmGlobals = strList;
      bunGlobals = strList;
    };
  };

  # A stack option: a submodule whose only required knob is `enable`.
  # `componentOptions` are per-stack sub-toggles (e.g. ai-agents.ollama);
  # everything is defaulted, so a host sets only what it wants to change.
  mkStack =
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
    };
in
{
  options.my = {
    # Per-host stacks: hosts/<name>/default.nix enables and customizes these.
    stacks = {
      ai-agents = mkStack {
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
        };
      };
      office-docs = mkStack {
        description = "Office document automation";
      };
      vpn = mkStack {
        description = "VPN / Tailscale mesh (app + hosted services)";
      };
    };

    # Channel lists stacks contribute to. Home Manager executors read these
    # via osConfig.my.pkgs.* (options live at system level; HM modules can
    # read but not declare system options).
    pkgs = {
      taps = strList // {
        description = "Homebrew taps contributed by stacks.";
      };
      brews = strList // {
        description = "Homebrew formulae contributed by stacks.";
      };
      casks = strList // {
        description = "Homebrew casks contributed by stacks.";
      };
      npmGlobals = strList // {
        description = "npm global packages contributed by stacks.";
      };
      bunGlobals = strList // {
        description = "Bun global packages contributed by stacks.";
      };
    };
  };
}
