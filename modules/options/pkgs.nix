{ lib, ... }:

# Channel merge targets for the intent layer. Stacks (modules/stacks/*)
# contribute software into these lists; executors (homebrew.nix,
# npm-global.nix, bun-global.nix) read the merged lists and install — they
# never decide membership. A package may appear in several stacks
# (tag-style); executors dedupe with lib.unique.
#
# The per-stack toggles (my.stacks.<name>) are NOT declared here — each
# stack module declares its own option (via modules/stacks/mk-stack.nix),
# so schema lives next to behavior.
let
  strList = lib.mkOption {
    type = lib.types.listOf lib.types.str;
    default = [ ];
  };
in
{
  # Home Manager executors read these via osConfig.my.pkgs.* (options live
  # at system level; HM modules can read but not declare system options).
  options.my.pkgs = {
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
}
