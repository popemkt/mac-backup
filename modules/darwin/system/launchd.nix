{ config, lib, ... }:

# Every launchd job this configuration declares waits for the Nix store.
#
# At boot launchd starts daemons before the Nix volume is mounted, so a job
# whose program is a /nix/store path fails to exec, exits 78 (EX_CONFIG)
# and lands in launchd's penalty box until someone kickstarts it. The local
# proxy did exactly that. nix-darwin's `command` and `script` start the
# program as `/bin/sh -c "/bin/wait4path /nix/store && exec <command>"`;
# a raw `serviceConfig.Program` or `ProgramArguments` naming a store path
# skips that wait. This module refuses those, for daemons and for agents
# alike (an agent can start before the volume too, at an early login), so
# `command` (with lib.escapeShellArgs for arguments) or `script` stays the
# one way a job runs store software.
let
  jobs =
    lib.mapAttrsToList (name: job: {
      name = "launchd.daemons.${name}";
      inherit job;
    }) config.launchd.daemons
    ++ lib.mapAttrsToList (name: job: {
      name = "launchd.agents.${name}";
      inherit job;
    }) config.launchd.agents
    ++ lib.mapAttrsToList (name: job: {
      name = "launchd.user.agents.${name}";
      inherit job;
    }) config.launchd.user.agents;

  program =
    { serviceConfig, ... }:
    if serviceConfig.Program != null then
      serviceConfig.Program
    else if serviceConfig.ProgramArguments != null && serviceConfig.ProgramArguments != [ ] then
      lib.head serviceConfig.ProgramArguments
    else
      "";

  unwaited = lib.filter ({ job, ... }: lib.hasPrefix builtins.storeDir (toString (program job))) jobs;
in
{
  assertions = [
    {
      assertion = unwaited == [ ];
      message = "${
        lib.concatMapStringsSep ", " (j: j.name) unwaited
      } start a /nix/store program directly, so at boot launchd runs it before the Nix volume is mounted and gives up (exit 78). Declare it with `command` (lib.escapeShellArgs for arguments) or `script`, which wait for /nix/store (modules/darwin/system/launchd.nix).";
    }
  ];
}
