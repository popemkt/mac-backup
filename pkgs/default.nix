{ pkgs }:

let
  sources = pkgs.callPackage ../_sources/generated.nix { };
in
{
  cli-proxy-api = pkgs.callPackage ./cli-proxy-api {
    inherit sources;
  };
}
