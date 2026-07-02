_:

# Work machine.
# Only diffs from the shared darwin base go here (work-only casks, etc.).
{
  imports = [ ../darwin ];

  my.role = "work";

  # Work-only GUI apps; merged with the base list in hosts/darwin.
  homebrew.casks = [ "microsoft-outlook" ];
}
