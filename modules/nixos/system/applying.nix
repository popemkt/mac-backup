{ config, lib, ... }:

# What scripts/rebuild and the pull agent (modules/stacks/pull-deploy) read
# on a NixOS host to apply this repository safely (scripts/lib/deploy-guard.sh,
# docs/deploys.md).
let
  shared = lib.length config.my.people > 1;
in
{
  # Not system.configurationRevision: that one also goes into nixos-version,
  # hence system-path, and polkit, accounts-daemon and dbus restart or reload
  # whenever system-path changes, so every commit would restart them.
  options.my.revision = lib.mkOption {
    type = lib.types.nullOr lib.types.str;
    default = null;
    description = "The commit the system is built from; flake.nix sets it (`<rev>-dirty` for uncommitted changes).";
  };

  config = {
    # A host several people apply from: scripts/rebuild reads this marker and
    # switches only from a clean checkout at origin/main, so no one's stale or
    # uncommitted tree rolls back what the others applied.
    environment.etc."dotfiles/shared-host" = lib.mkIf shared {
      text = lib.concatStringsSep "\n" config.my.people + "\n";
    };

    # The lock rebuild and the pull agent hold from their last check to the
    # end of a switch. Root's, readable by everyone: flock needs only a
    # read-only open.
    systemd.tmpfiles.rules = lib.mkIf shared [ "f /run/dotfiles-apply.lock 0644 root root -" ];

    # The commit this system was built from, in the system itself, so
    # /run/current-system/configuration-revision always names the commit the
    # host runs. Both read it to never switch backwards.
    system.systemBuilderCommands = lib.mkIf (config.my.revision != null) ''
      printf '%s' ${lib.escapeShellArg config.my.revision} > "$out/configuration-revision"
    '';
  };
}
