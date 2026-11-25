# The services a switch would stop and start while something upholds them
# (./upheld-units.nix says why that runs the old unit). A pure function of
# NixOS's `config.systemd`, so ./upheld-units-tests.nix checks it directly.
lib: systemd:
let
  # Every unit kind that can uphold (mounts and automounts are lists keyed
  # by path, not attribute sets; nothing here upholds with one).
  kinds = {
    services = "service";
    targets = "target";
    sockets = "socket";
    timers = "timer";
    paths = "path";
    slices = "slice";
  };
  units = lib.concatLists (
    lib.mapAttrsToList (
      kind: suffix:
      lib.mapAttrsToList (name: unit: {
        unitName = "${name}.${suffix}";
        inherit unit;
      }) systemd.${kind}
    ) kinds
  );
  byName = lib.listToAttrs (map (u: lib.nameValuePair u.unitName u.unit) units);
  # A unit NixOS does not declare (one systemd ships) counts as enabled.
  enabled = unitName: byName.${unitName}.enable or true;
  # unitConfig values are a string, or a list, of unit names.
  unitNames = value: lib.filter (n: n != "") (lib.concatMap (lib.splitString " ") (lib.toList value));
  # What each enabled unit upholds: `upholds`, and Upholds= written
  # directly. `upheldBy` is the same edge declared on the other end.
  upheldByUnit = lib.concatMap (
    u: lib.optionals u.unit.enable (u.unit.upholds ++ unitNames (u.unit.unitConfig.Upholds or [ ]))
  ) units;
  upheldViaUpheldBy = lib.concatMap (
    u: lib.optional (lib.any enabled u.unit.upheldBy) u.unitName
  ) units;
  upheld = lib.unique (upheldByUnit ++ upheldViaUpheldBy);
  # A switch stops and later starts a changed service unless it leaves it
  # alone (restartIfChanged = false), reloads it (reloadIfChanged), or
  # restarts it after the reload (stopIfChanged = false).
  stoppedOnSwitch =
    name:
    let
      service = systemd.services.${lib.removeSuffix ".service" name};
    in
    lib.hasSuffix ".service" name
    && systemd.services ? ${lib.removeSuffix ".service" name}
    && service.enable
    && service.restartIfChanged
    && service.stopIfChanged
    && !service.reloadIfChanged;
in
lib.sort lib.lessThan (map (lib.removeSuffix ".service") (lib.filter stoppedOnSwitch upheld))
