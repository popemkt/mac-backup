{ lib, ... }:

# Intent layer schema. Stacks are vertical slices (functionality); the
# channel lists below are the merge targets they contribute to. Executors
# (homebrew.nix, npm-global.nix, bun-global.nix) read the merged lists and
# install — they never decide membership.
#
# A package may appear in several stacks (tag-style); executors dedupe
# with lib.unique.
let
  packageList = lib.mkOption {
    type = lib.types.listOf lib.types.str;
    default = [ ];
  };
in
{
  options.my = {
    # Per-host toggles: hosts/<name>/default.nix flips these on.
    stacks = {
      ai-agents = lib.mkEnableOption "AI coding agent toolchain";
      office-docs = lib.mkEnableOption "Office document automation";
      vpn = lib.mkEnableOption "VPN / Tailscale mesh (app + hosted services)";
    };

    # Channel lists stacks contribute to. Home Manager executors read these
    # via osConfig.my.pkgs.* (options live at system level; HM modules can
    # read but not declare system options).
    pkgs = {
      taps = packageList // {
        description = "Homebrew taps contributed by stacks.";
      };
      brews = packageList // {
        description = "Homebrew formulae contributed by stacks.";
      };
      casks = packageList // {
        description = "Homebrew casks contributed by stacks.";
      };
      npmGlobals = packageList // {
        description = "npm global packages contributed by stacks.";
      };
      bunGlobals = packageList // {
        description = "Bun global packages contributed by stacks.";
      };
    };
  };
}
