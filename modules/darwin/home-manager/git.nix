_:

# Git credentials on macOS: Git Credential Manager (Homebrew) backed by the
# login keychain.
{
  programs.git.settings.credential = {
    helper = "manager";
    credentialStore = "keychain";
  };
}
