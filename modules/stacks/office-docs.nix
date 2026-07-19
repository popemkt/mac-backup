{ config, lib, ... }:

# Office document automation. officecli is also tagged in ai-agents —
# multi-stack membership is expected; executors dedupe.
let
  cfg = config.my.stacks.office-docs;
in
lib.mkIf cfg.enable {
  my.pkgs.brews = [
    "officecli"
  ]
  ++ cfg.extra.brews;
}
