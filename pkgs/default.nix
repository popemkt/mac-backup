{
  pkgs,
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

  sources = lib.mapAttrs withHomepage (
    pkgs.callPackage ../_sources/generated.nix { }
    # GAP [[01M56GS17DHFTQ4F64WKSMMAE1]]: kb's pin, by hand until v0.2.0 exists.
    // {
      kb = {
        pname = "kb";
        version = "0.2.0";
        src = pkgs.fetchurl {
          url = "https://github.com/popemkt/kb/releases/download/v0.2.0/kb-0.2.0.tar.gz";
          hash = lib.fakeHash;
        };
      };
    }
  );
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

  logseq = pkgs.callPackage ./logseq {
    inherit sources;
  };

  vite-plus = pkgs.callPackage ./vite-plus {
    inherit sources;
  };

  kb = pkgs.callPackage ./kb {
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
