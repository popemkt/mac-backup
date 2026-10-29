{
  config,
  lib,
  pkgs,
  ...
}:

# bb on NixOS: the `bb-app` launcher and the `bb` CLI from npm, so they track
# the latest release. Its native add-ons (better-sqlite3, node-pty,
# @parcel/watcher) come prebuilt and run through nix-ld. A host serves it for
# someone with a `my.services` entry running `bb-app` as them. It is no Nix
# package, so that entry declares `updatedBy.npmGlobal = "bb-app"`:
# update-npm-globals, the one thing that upgrades it, restarts the entry's
# unit when the installed version changes. The Macs run the bb cask instead.
#
# The `opencode` CLI comes along: bb drives it as its acp-opencode provider,
# and its prebuilt binary runs through nix-ld like bb-app's add-ons. The
# nixpkgs package lags upstream by a minor release, so it takes the npm path
# the other agent CLIs here take (t3-code/nixos.nix). Each person runs
# `opencode auth login` themselves; no credential is declared.
{
  config = lib.mkIf config.my.stacks.bb.enable {
    assertions = [
      {
        assertion = config.programs.nix-ld.enable;
        message = "my.stacks.bb needs programs.nix-ld.enable: bb-app's native add-ons are prebuilt binaries.";
      }
    ];

    # Installed per user by the npm executor (modules/common/home-manager/npm-global.nix).
    my.pkgs.npmGlobals = [
      "bb-app"
      "opencode-ai"
    ];

    # The Chrome bb's built-in browser-automation plugin drives for local and
    # headless sessions: it looks for `chromium` on its server's PATH, which
    # includes the system profile. The Macs have the desktop browser.
    environment.systemPackages = [ pkgs.chromium ];
  };
}
