_:

# Work machine.
# Only diffs from the shared Darwin system module go here.
{
  imports = [ ../../modules/darwin/system ];

  my.role = "work";

  # Work-only GUI apps; merged with the shared Homebrew module.
  homebrew.casks = [
    "microsoft-outlook"
    "microsoft-teams"
    "onedrive"
    "slack"
  ];

  # Autostart Outlook at login (-g = don't focus, -j = launch hidden).
  # RunAtLoad also fires once at rebuild activation, not just login.
  launchd.user.agents.outlook-autostart = {
    serviceConfig = {
      ProgramArguments = [
        "/usr/bin/open"
        "-gj"
        "-a"
        "Microsoft Outlook"
      ];
      RunAtLoad = true;
    };
  };
}
