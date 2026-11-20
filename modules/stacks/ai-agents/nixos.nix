{
  config,
  lib,
  pkgs,
  ...
}:

# NixOS side of the AI coding agent toolchain.
#
# On macOS, Antigravity CLI (`agy`) comes from the Homebrew cask
# (`antigravity-cli` in ./darwin.nix). On Linux it is packaged from Google's
# official release tarball (pkgs/antigravity-cli) and placed on every user's
# PATH via my.everyone so both login shells and bb's host daemon find `agy`
# (for `agy acp`). Each person signs in once themselves (`agy` or
# `agy acp --login`); no credential is declared.
let
  cfg = config.my.stacks.ai-agents;
in
{
  config = lib.mkIf cfg.enable {
    my.everyone = {
      home.packages = [ pkgs.antigravity-cli ];
    };
  };
}
