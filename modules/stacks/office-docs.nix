{
  config,
  pkgs,
  lib,
  ...
}:

# Office document automation and the GenOffice suite. officecli is also
# tagged in ai-agents — multi-stack membership is expected; executors dedupe.
let
  mkStack = import ./mk-stack.nix lib;
  cfg = config.my.stacks.office-docs;
  inherit (config.my) username;
in
{
  options.my.stacks.office-docs = mkStack {
    description = "Office document automation";
  };

  config = lib.mkIf cfg.enable {
    my.pkgs.brews = [
      "officecli"
    ]
    ++ cfg.extra.brews;

    home-manager.users.${username} = {
      home.packages = [ pkgs.genoffice ];
    };
  };
}
