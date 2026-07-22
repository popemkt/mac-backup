{
  pkgs,
  pyproject-build-systems,
  pyproject-nix,
  uv2nix,
}:

let
  sources = pkgs.callPackage ../_sources/generated.nix { };
in
{
  cli-proxy-api = pkgs.callPackage ./cli-proxy-api {
    inherit sources;
  };

  cursor-cli = pkgs.callPackage ./cursor-cli {
    inherit sources;
  };

  logseq-nightly = pkgs.callPackage ./logseq-nightly {
    inherit sources;
  };

  system-setup = pkgs.callPackage ./system-setup {
    inherit
      pyproject-build-systems
      pyproject-nix
      uv2nix
      ;
  };

  system-setup-dev = pkgs.callPackage ./system-setup {
    inherit
      pyproject-build-systems
      pyproject-nix
      uv2nix
      ;
    includeDev = true;
  };
}
