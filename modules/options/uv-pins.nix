{ lib, ... }:

# uv tool version pins, generated into _sources/uv-pins.json by
# scripts/uv-sources so `update-system` can refresh them the same way it
# refreshes flake.lock and the nvfetcher output.
#
# Modules read a pin instead of hardcoding a version string, which keeps the
# two Cognee roles on one number and gives the updater a single machine
# writable place to edit.
#
# `track = "latest"` lets the updater move the pin. Set `"manual"` to hold a
# version deliberately — the checker still reports newer releases, it just
# will not rewrite the entry.

let
  pinType = lib.types.submodule {
    options = {
      version = lib.mkOption {
        type = lib.types.str;
        description = "Pinned release, as installed by uv.";
      };
      track = lib.mkOption {
        type = lib.types.enum [
          "latest"
          "manual"
        ];
        default = "latest";
        description = "Whether scripts/uv-sources may rewrite this pin.";
      };
    };
  };
in
{
  options.my.uvPins = lib.mkOption {
    type = lib.types.attrsOf pinType;
    default = builtins.fromJSON (builtins.readFile ../../_sources/uv-pins.json);
    description = "Generated uv tool pins, keyed by PyPI package name.";
  };
}
