{ lib, pkgs, ... }:

# Linux-specific Home Manager settings, for every user of a NixOS host.
{
  # Git over HTTPS authenticates with the person's `gh` login. Linux has no
  # Git Credential Manager here; the empty entry drops any inherited helper.
  programs.git.settings.credential."https://github.com".helper = [
    ""
    "!${lib.getExe pkgs.gh} auth git-credential"
  ];
}
