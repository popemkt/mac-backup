{ config, pkgs, lib, username ? "popemkt", ... }:

{
  imports = [
    ../modules/shared
    ../modules/nixos
  ];

  home.username = username;
  home.homeDirectory = "/home/${username}";
  home.stateVersion = "24.05";

  programs.home-manager.enable = true;
}
