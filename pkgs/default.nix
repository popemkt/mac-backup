{
  pkgs,
  bun2nix,
  pyproject-build-systems,
  pyproject-nix,
  uv2nix,
}:

let
  inherit (pkgs) lib;

  # A GitHub release source's homepage is its repository, which the pinned
  # release URL already names; derive it instead of restating nvfetcher.toml.
  withHomepage =
    _: source:
    let
      repo = builtins.match "(https://github\\.com/[^/]+/[^/]+)/releases/.*" source.src.url;
    in
    source // lib.optionalAttrs (repo != null) { homepage = builtins.head repo; };

  sources = lib.mapAttrs withHomepage (pkgs.callPackage ../_sources/generated.nix { });
in
{
  chat2db = pkgs.callPackage ./chat2db {
    inherit sources;
  };

  cli-proxy-api = pkgs.callPackage ./cli-proxy-api {
    inherit sources;
  };

  cursor-cli = pkgs.callPackage ./cursor-cli {
    inherit sources;
  };

  genoffice = pkgs.callPackage ./genoffice {
    inherit sources;
  };

  logseq-nightly = pkgs.callPackage ./logseq-nightly {
    inherit sources;
  };

  vite-plus = pkgs.callPackage ./vite-plus {
    inherit sources;
  };

  kb = pkgs.callPackage ./kb {
    bun2nix = bun2nix.packages.${pkgs.stdenv.hostPlatform.system}.default;
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
