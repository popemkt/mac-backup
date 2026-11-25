{ config, lib, ... }:

# What scripts/rebuild and the pull agent (modules/stacks/pull-deploy) read
# on a NixOS host to apply this repository safely (scripts/lib/deploy-guard.sh,
# docs/deploys.md).
let
  shared = lib.length config.my.people > 1;
in
{
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

  # The commit this system was built from (flake.nix sets
  # system.configurationRevision), in the system itself, so
  # /run/current-system/configuration-revision always names the commit the
  # host runs. Both read it to never switch backwards.
  system.systemBuilderCommands = lib.mkIf (config.system.configurationRevision != null) ''
    printf '%s' ${lib.escapeShellArg config.system.configurationRevision} > "$out/configuration-revision"
  '';
}
