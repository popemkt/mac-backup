_:

# Work machine.
# Only diffs from the shared darwin base go here (work-only casks, etc.).
{
  imports = [ ../darwin ];

  my.role = "work";

  # Work-only GUI apps; merged with the base list in hosts/darwin.
  homebrew.casks = [
    "microsoft-outlook"
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
