{ config, lib, ... }:

let
  inherit (config.my) username;
  hermesHome = "/stuff/workspace/repos/_brain/.agents/hermes/profile/popemkt";
in
lib.mkIf config.my.stacks.ai-agents.enable {
  # Global launchd user-domain env vars are inherited by apps launched from
  # Dock/Spotlight and by user launchd jobs.
  launchd.user.envVariables = {
    HERMES_HOME = hermesHome;
  };

  home-manager.users.${username} = {
    home.sessionVariables = {
      # Hermes auxiliary ACP uses the Homebrew Copilot CLI on macOS.
      HERMES_COPILOT_ACP_COMMAND = "/opt/homebrew/bin/copilot";

      # Mirrors launchd.user.envVariables.HERMES_HOME for interactive shells.
      HERMES_HOME = hermesHome;
    };
  };
}
