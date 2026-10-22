{ config, lib, ... }:

# bb on NixOS: the `bb-app` launcher and the `bb` CLI from npm, so they track
# the latest release. Its native add-ons (better-sqlite3, node-pty,
# @parcel/watcher) come prebuilt and run through nix-ld. A host serves it for
# someone with a `my.services` entry running `bb-app` as them. It is no Nix
# package, so that entry declares `updatedBy.npmGlobal = "bb-app"`:
# update-npm-globals, the one thing that upgrades it, restarts the entry's
# unit when the installed version changes. The Macs run the bb cask instead.
{
  config = lib.mkIf config.my.stacks.bb.enable {
    assertions = [
      {
        assertion = config.programs.nix-ld.enable;
        message = "my.stacks.bb needs programs.nix-ld.enable: bb-app's native add-ons are prebuilt binaries.";
      }
    ];

    # Installed per user by the npm executor (modules/common/home-manager/npm-global.nix).
    my.pkgs.npmGlobals = [ "bb-app" ];
  };
}
