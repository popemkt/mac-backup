{ config, pkgs, ... }:

{
  programs.git = {
    enable = true;
    extraConfig = {
      user.name = "Hoang Nguyen Gia";
      user.email = "hoangng71299@gmail.com";
      init.defaultBranch = "main";
      pull.rebase = true;
      push.autoSetupRemote = true;
      core.pager = "delta";
      interactive.diffFilter = "delta --color-only";
      delta = {
        navigate = true;
        light = false;
        line-numbers = true;
      };
      merge.conflictStyle = "diff3";
      diff.colorMoved = "default";
    };
    aliases = {
      s = "status";
      co = "checkout";
      br = "branch";
      ci = "commit";
      lg = "log --oneline --graph --decorate";
    };
  };
}
