# Flake check: every plugin folder this repo installs, copied as its executor
# copies it (./source.nix), has every relative path its source reaches: each
# bb plugin in assets/bb-plugins (one copy per plugin), and each agent plugin
# in assets/plugins (one copy of the whole folder, the `dotfiles`
# marketplace). It fails when a plugin starts importing code ./source.nix's
# scan does not pick up, before a rebuild installs a copy that cannot load.
{ pkgs, lib }:
let
  # The folders under root that hold marker.
  pluginsIn =
    root: marker:
    lib.attrNames (
      lib.filterAttrs (
        name: type: type == "directory" && builtins.pathExists (root + "/${name}/${marker}")
      ) (builtins.readDir root)
    );

  bbRoot = ../../../../assets/bb-plugins;
  bbSource = import ./source.nix {
    inherit lib;
    kind = "bb-plugin";
  };
  bbPlugins = map (name: "${bbSource (bbRoot + "/${name}")}/${name}") (
    pluginsIn bbRoot "package.json"
  );

  agentRoot = ../../../../assets/plugins;
  agentCopy = import ./source.nix {
    inherit lib;
    kind = "dotfiles-agent";
  } agentRoot;
  agentPlugins = map (name: "${agentCopy}/plugins/${name}") (
    pluginsIn agentRoot ".claude-plugin/plugin.json"
  );
in
pkgs.runCommand "plugin-sources-check" { nativeBuildInputs = [ pkgs.nodejs ]; } ''
  node ${./check-imports.mjs} ${lib.concatStringsSep " " (bbPlugins ++ agentPlugins)}
  touch "$out"
''
