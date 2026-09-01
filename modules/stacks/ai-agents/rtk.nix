{
  config,
  lib,
  ...
}:

lib.mkIf config.my.stacks.ai-agents.enable {
  # RTK applies the context-budget principle to shell output: Homebrew keeps it
  # current with RTK's frequent upstream releases.
  my.pkgs.brews = [ "rtk" ];

  home-manager.users.${config.my.username} =
    { lib, ... }:
    {
      # Keep Claude Code on RTK's current native hook command. RTK performs an
      # idempotent merge into settings.json, preserving the other agent hooks.
      home.activation.ensureRtkClaudeHook = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        if [ -x /opt/homebrew/bin/rtk ]; then
          $DRY_RUN_CMD /opt/homebrew/bin/rtk init -g --auto-patch
        fi
      '';
    };
}
