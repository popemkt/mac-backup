{ config, lib, ... }:

# Office document automation. officecli is also tagged in ai-agents —
# multi-stack membership is expected; executors dedupe.
lib.mkIf config.my.stacks.office-docs {
  my.pkgs.brews = [
    "officecli"
  ];
}
