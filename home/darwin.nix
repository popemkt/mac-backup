{ config, pkgs, lib, ... }:

{
  home.username = "popemkt";
  home.homeDirectory = "/Users/popemkt";
  home.stateVersion = "24.05";

  programs.home-manager.enable = true;

  # Minimal test - just git
  programs.git = {
    enable = true;
    userName = "Hoang Nguyen Gia";
    userEmail = "hoangng71299@gmail.com";
  };
}
