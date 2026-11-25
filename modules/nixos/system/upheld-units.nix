{ config, lib, ... }:

# A service another unit upholds (systemd's Upholds=: `upholds`,
# `upheldBy`, or unitConfig.Upholds) must not be one a switch stops and
# starts again later. switch-to-configuration stops a changed unit before
# it reloads systemd, and starts it after. Between the two, the upholding
# unit starts it again at once, from the OLD unit file; the switch's later
# start then finds it running and does nothing. So the old version keeps
# running: the MCP edge's realm reconcile imported the old realm that way
# (docs/mcp-edge.md, the realm reconcile). stopIfChanged = false (restarted
# after the reload) or reloadIfChanged fixes it. ./upheld-units-lib.nix
# finds them; ./upheld-units-tests.nix checks it.
let
  stoppedOnSwitch = import ./upheld-units-lib.nix lib config.systemd;
in
{
  assertions = [
    {
      assertion = stoppedOnSwitch == [ ];
      message = "Upheld services a switch would stop, and their upholder restart from the old unit file: ${toString stoppedOnSwitch}. Set stopIfChanged = false on each (modules/nixos/system/upheld-units.nix).";
    }
  ];
}
