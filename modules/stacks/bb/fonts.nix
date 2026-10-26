{ pkgs, lib }:

# Josefin Sans (bb-lively's Cloudbank lettering) and Federant (the title face
# of kb's Transistor, Cloudbank's counterpart, for lively's planned display
# face), both under the SIL Open Font License; ./darwin.nix installs them.
#
# Google Fonts' own build (pkgs.google-fonts) unpacks the whole google/fonts
# repository, about 3 GB, for any one family, so these come from it file by
# file, at the revision that build pins. When nixpkgs moves that pin, these
# stay where they are; to move them, set rev to its src.rev and refresh each
# hash with nix-prefetch-url.
let
  rev = "5174b3333331c966c38f4355d50b03ca1c1df2f9";
  files = [
    {
      name = "JosefinSans-wght.ttf";
      path = "josefinsans/JosefinSans%5Bwght%5D.ttf";
      hash = "sha256-klWr2185O8UeEBq70Hpxapd/0+FUcrG4SyYPQmo0K/0=";
    }
    {
      name = "JosefinSans-Italic-wght.ttf";
      path = "josefinsans/JosefinSans-Italic%5Bwght%5D.ttf";
      hash = "sha256-witCymkL5+oH0EQVrHC0hgPf+I6FRzjLpL2HAnuQXvE=";
    }
    {
      name = "Federant-Regular.ttf";
      path = "federant/Federant-Regular.ttf";
      hash = "sha256-1AywnIURTCsMlEJjZBLpl9glizg+HRpoTn4ysh0HpcI=";
    }
  ];
in
pkgs.runCommandLocal "cloudbank-google-fonts" { } (
  lib.concatMapStrings (f: ''
    install -m 444 -D ${
      pkgs.fetchurl {
        inherit (f) name hash;
        url = "https://raw.githubusercontent.com/google/fonts/${rev}/ofl/${f.path}";
      }
    } "$out/share/fonts/truetype/${f.name}"
  '') files
)
