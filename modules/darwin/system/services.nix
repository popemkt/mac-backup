{ config, lib, ... }:

# my.services (modules/options/services.nix) has no macOS implementation yet,
# so a Mac that declares an app fails here instead of silently not running it.
# GAP [[01M5791R8EWJ0NB0Z3ENAFVMEH]] my.services runs native apps on NixOS only.
{
  assertions = [
    {
      assertion = config.my.services == { };
      message = "my.services is NixOS-only for now; run ${lib.concatStringsSep ", " (lib.attrNames config.my.services)} as a launchd agent with a my.stacks.vpn.services entry.";
    }
  ];
}
