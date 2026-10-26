{
  config,
  lib,
  pkgs,
  ...
}:

# bb on macOS: the desktop app, which runs its own local server, and the
# typefaces bb's pages name.
#
# A page's fonts resolve on the machine that draws it, so they are installed
# where bb is viewed: the Macs, whether the page comes from the local server
# or from shared-server's. The NixOS side installs none: its bb server only
# serves pages, and the headless Chromium agents drive there is for the
# pages under test, not bb's own.
let
  # Josefin Sans (bb-lively's Cloudbank lettering) and Federant (the title
  # face of kb's Transistor, Cloudbank's counterpart, for lively's planned
  # display face), both under the SIL Open Font License, which travels with
  # them. Google Fonts' own build (pkgs.google-fonts) unpacks the whole
  # google/fonts repository, about 3 GB, for any one family, so these come
  # from it file by file, at the revision nixpkgs pins.
  googleFonts = "https://raw.githubusercontent.com/google/fonts/5174b3333331c966c38f4355d50b03ca1c1df2f9/ofl";
  files = [
    {
      name = "JosefinSans-wght.ttf";
      url = "josefinsans/JosefinSans%5Bwght%5D.ttf";
      hash = "sha256-klWr2185O8UeEBq70Hpxapd/0+FUcrG4SyYPQmo0K/0=";
      dest = "share/fonts/truetype/JosefinSans-wght.ttf";
    }
    {
      name = "JosefinSans-Italic-wght.ttf";
      url = "josefinsans/JosefinSans-Italic%5Bwght%5D.ttf";
      hash = "sha256-witCymkL5+oH0EQVrHC0hgPf+I6FRzjLpL2HAnuQXvE=";
      dest = "share/fonts/truetype/JosefinSans-Italic-wght.ttf";
    }
    {
      name = "Federant-Regular.ttf";
      url = "federant/Federant-Regular.ttf";
      hash = "sha256-1AywnIURTCsMlEJjZBLpl9glizg+HRpoTn4ysh0HpcI=";
      dest = "share/fonts/truetype/Federant-Regular.ttf";
    }
    {
      name = "JosefinSans-OFL.txt";
      url = "josefinsans/OFL.txt";
      hash = "sha256-ruWkCB6KUvgEKLMPF4txnRFfGNrT4foVqYYWPhB4qFs=";
      dest = "share/doc/josefin-sans/OFL.txt";
    }
    {
      name = "Federant-OFL.txt";
      url = "federant/OFL.txt";
      hash = "sha256-F9en9dnwE5U17OxRaYjExzouwPIlmHKI8/1u4mItRFA=";
      dest = "share/doc/federant/OFL.txt";
    }
  ];
  cloudbankGoogleFonts = pkgs.runCommandLocal "cloudbank-google-fonts" { } (
    lib.concatMapStrings (f: ''
      install -m 444 -D ${
        pkgs.fetchurl {
          inherit (f) name hash;
          url = "${googleFonts}/${f.url}";
        }
      } "$out/${f.dest}"
    '') files
  );
in
{
  config = lib.mkIf config.my.stacks.bb.enable {
    # Official cask.
    my.pkgs.casks = [ "bb" ];

    # The faces bb-lively's Cloudbank preset names
    # (assets/bb-plugins/bb-lively/core/src/domain/presets.ts): Jost
    # (nixpkgs' build of its upstream release) for reading, Josefin Sans for
    # lettering; without them it falls back to Avenir Next and Futura.
    fonts.packages = [
      pkgs.jost
      cloudbankGoogleFonts
    ];
  };
}
