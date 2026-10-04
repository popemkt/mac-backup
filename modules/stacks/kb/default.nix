{
  config,
  lib,
  pkgs,
  ...
}:

let
  mkStack = import ../mk-stack.nix lib;
  cfg = config.my.stacks.kb;
  inherit (config.my) username;
in
{
  options.my.stacks.kb = mkStack {
    description = "Knowledge graph CLI and browser UI";
  };

  config = lib.mkIf cfg.enable {
    home-manager.users.${username}.home.packages = [ pkgs.kb ];
  };
}
