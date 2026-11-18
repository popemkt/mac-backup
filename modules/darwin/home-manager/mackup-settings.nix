# Data shared by the Home Manager renderer and the staged backup-ownership
# check. It evaluates without loading nixpkgs or building a host.
{
  engine = "icloud";
  applications = [
    "karabiner-elements"
    "warp"
    "zed"
    "vscode"
    "telegram_macos"
    "claude-code"
    "kb"
    "snapzy"
    "t3-code"
    "tinycast"
    "macosx"
  ];
  kbFiles = [
    ".dotfiles/.kb/assets"
    ".dotfiles/.kb/trust.json"
  ];
}
