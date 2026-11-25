{ config, lib, ... }:

# A unit another unit upholds (systemd's Upholds=, `upheldBy` here) must let
# a switch restart it, not stop it and start it again later (`stopIfChanged
# = false`). switch-to-configuration stops a changed unit before it reloads
# systemd, and starts it after. Between the two, the upholding unit starts
# it again at once, from the OLD unit file; the switch's later start then
# finds it running and does nothing. So the old version keeps running: the
# MCP edge's realm reconcile imported the old realm that way
# (docs/mcp-edge.md, the realm reconcile). With stopIfChanged = false the
# switch restarts it after the reload, from the new file.
let
  services = config.systemd.services;
  upheld = lib.unique (
    lib.concatLists (
      lib.mapAttrsToList (
        name: unit:
        lib.optional (unit.upheldBy != [ ]) name
        ++ map (lib.removeSuffix ".service") (lib.filter (lib.hasSuffix ".service") unit.upholds)
      ) services
    )
  );
  stoppedOnSwitch = lib.filter (
    name: services ? ${name} && services.${name}.restartIfChanged && services.${name}.stopIfChanged
  ) upheld;
in
{
  assertions = [
    {
      assertion = stoppedOnSwitch == [ ];
      message = "Upheld units a switch would stop, and their upholder restart from the old unit file: ${toString stoppedOnSwitch}. Set stopIfChanged = false on each (modules/nixos/system/upheld-units.nix).";
    }
  ];
}
