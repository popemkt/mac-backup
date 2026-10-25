{ pkgs, ... }:

# bytetum's own Home Manager choices, the same on every host they log in to.
# A person's folder selects; shared behavior lives under modules/.
{
  programs.git.settings.user = {
    name = "bytetum";
    email = "thanhhxse99@gmail.com";
  };

  # Tana's desktop app; its local MCP server listens on 127.0.0.1:8262.
  home.packages = [ pkgs.tana ];
}
