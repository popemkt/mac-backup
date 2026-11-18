scopes:
{ lib, ... }:
let
  channels = import ./channels.nix;
  channelTypes = import ./channel-types.nix lib;
in
{
  options.my.packageExecutors = lib.mapAttrs (
    name: channel:
    lib.mkOption {
      inherit (channelTypes.${channel.type or "strings"}) type;
      readOnly = true;
      internal = true;
      description = "Effective members of the ${name} package executor.";
    }
  ) (lib.filterAttrs (_: channel: lib.elem (channel.executor or null) scopes) channels);
}
