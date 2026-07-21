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
      snapzy
      macosx
    '';

    # Snapzy has no upstream Mackup definition. Sync only portable preferences
    # (shortcuts, history limits, editor behavior); its Application Support
    # database contains capture history, file paths, and cloud-upload keys.
    file.".config/mackup/applications/snapzy.cfg".text = ''
      [application]
      name = Snapzy

      [configuration_files]
      Library/Preferences/com.trongduong.snapzy.plist
    '';
  };
}
