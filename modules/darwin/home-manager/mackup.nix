{ pkgs, ... }:

{
  home = {
    packages = [ pkgs.mackup ];

    file.".mackup.cfg".text = ''
      [storage]
      engine = icloud

      [applications_to_sync]
      alt-tab
      karabiner-elements
      warp
      zed
      vscode
      telegram_macos
      claude-code
      macosx
    '';
  };
}
