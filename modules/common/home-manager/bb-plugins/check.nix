# Flake check: every bb plugin folder in assets/bb-plugins, copied as the
# executor copies it (./source.nix), has every relative path its source
# reaches. It fails when a plugin starts importing code ./source.nix's scan
# does not pick up, before a rebuild installs a copy that cannot build.
{ pkgs, lib }:
let
  root = ../../../../assets/bb-plugins;
  source = import ./source.nix { inherit lib; };
  plugins = lib.attrNames (
    lib.filterAttrs (
      name: type: type == "directory" && builtins.pathExists (root + "/${name}/package.json")
    ) (builtins.readDir root)
  );
in
pkgs.runCommand "bb-plugin-sources-check" { nativeBuildInputs = [ pkgs.nodejs ]; } ''
  node ${./check-imports.mjs} ${
    lib.concatMapStringsSep " " (name: "${source (root + "/${name}")}/${name}") plugins
  }
  touch "$out"
''
