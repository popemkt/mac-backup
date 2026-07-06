_:

# Personal machine (placeholder until it's set up).
# Only diffs from the shared darwin base go here (personal-only casks, etc.).
{
  imports = [ ../darwin ];

  my.role = "personal";

  # Antigravity's CLI is distributed as a Homebrew cask and provides `agy`.
  homebrew.casks = [
    "antigravity-cli"
  ];
}
