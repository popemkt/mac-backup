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
      kb
      snapzy
      t3-code
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

    # kb has no upstream Mackup definition and its source of truth (nodes.jsonl,
    # queries/, views/) is committed in this repo. Only the opaque media
    # directory .kb/assets/ is owned by Mackup: it is gitignored (never commit
    # binaries) and copied to iCloud by the standard `mackup backup`/`restore`
    # flow. The flow is copy-based — no symlink is created — so restore is a
    # plain directory copy and cannot produce a symlink loop. The HOME-relative
    # path assumes the repo lives at ~/.dotfiles (a repo invariant). Do not add
    # nodes.jsonl here; it is committed source of truth, not a backup concern.
    # Guarded by scripts/check-kb-assets-backup.sh (pre-commit + drift audit).
    file.".config/mackup/applications/kb.cfg".text = ''
      [application]
      name = kb

      [configuration_files]
      .dotfiles/.kb/assets
    '';

    # T3 Code: agent harness control surface (pingdotgg/t3code). Sync only
    # portable config files; transient worktrees in ~/.t3/worktrees stay local.
    file.".config/mackup/applications/t3-code.cfg".text = ''
      [application]
      name = T3 Code

      [configuration_files]
      Library/Application Support/t3-code/config.json
      Library/Application Support/t3/config.json
      .t3/config.json
    '';
  };
}
