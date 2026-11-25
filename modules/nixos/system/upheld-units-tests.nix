{ pkgs }:

# Eval-only: ./upheld-units-lib.nix on one NixOS evaluation whose units are
# the cases, named for what they show; the services it must find are
# exactly `expected`. And ./upheld-units.nix fails evaluation for them.
let
  inherit (pkgs) lib;
  stub = extra: { script = "true"; } // extra;
  upheldByHolder = extra: stub ({ upheldBy = [ "holder.service" ]; } // extra);
  eval = import (pkgs.path + "/nixos/lib/eval-config.nix") {
    inherit (pkgs.stdenv.hostPlatform) system;
    modules = [
      ./upheld-units.nix
      {
        system.stateVersion = lib.trivial.release;
        boot.isContainer = true;
        systemd.services = {
          holder = stub { };
          off = stub { enable = false; };
          # Found: upheld through each way of declaring it.
          by-upheld-by = upheldByHolder { };
          by-upheld-by-native = stub { upheldBy = [ "not-declared-in-nixos.service" ]; };
          by-target-upholds = stub { };
          by-service-unitconfig = stub { };
          by-target-unitconfig = stub { };
          holder-unitconfig = stub { unitConfig.Upholds = "by-service-unitconfig.service"; };
          # Not found: a switch reloads it, restarts it after the reload, or
          # leaves it alone; it is off; or only off units uphold it.
          reloads = upheldByHolder { reloadIfChanged = true; };
          restarts = upheldByHolder { stopIfChanged = false; };
          untouched = upheldByHolder { restartIfChanged = false; };
          disabled = upheldByHolder { enable = false; };
          by-off-service = stub { upheldBy = [ "off.service" ]; };
          by-off-target = stub { };
          by-off-unitconfig = stub { };
        };
        systemd.targets = {
          holder.upholds = [ "by-target-upholds.service" ];
          holder-unitconfig.unitConfig.Upholds = [ "by-target-unitconfig.service" ];
          off-target = {
            enable = false;
            upholds = [ "by-off-target.service" ];
            unitConfig.Upholds = "by-off-unitconfig.service";
          };
        };
      }
    ];
  };
  found = import ./upheld-units-lib.nix lib eval.config.systemd;
  expected = [
    "by-service-unitconfig"
    "by-target-unitconfig"
    "by-target-upholds"
    "by-upheld-by"
    "by-upheld-by-native"
  ];
  guardFails = lib.any (
    a: !a.assertion && lib.hasPrefix "Upheld services a switch would stop" a.message
  ) eval.config.assertions;
in
assert lib.assertMsg (
  found == expected
) "upheld-units: found ${toString found}, expected ${toString expected}";
assert lib.assertMsg guardFails "upheld-units: the assertion did not fail for the cases";
pkgs.runCommand "upheld-units-check" { } "touch $out"
