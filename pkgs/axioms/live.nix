{
  writeShellApplication,
  coreutils,
  curl,
  axioms,
  spacetimedb,
}:

# Publish the module this package was built with, then serve. Publishing an
# unchanged module only updates the database in place, so this runs on every
# start. A schema change that would delete data fails here (no -c), and the
# unit fails with it, rather than wiping anything.
writeShellApplication {
  name = "axioms-live";
  runtimeInputs = [
    coreutils
    curl
    spacetimedb
    axioms
  ];
  text = ''
    state="''${AXIOMS_STDB_HOME:?set AXIOMS_STDB_HOME, the SpacetimeDB state directory}"
    uri="''${AXIOMS_STDB_URI:?set AXIOMS_STDB_URI, where SpacetimeDB listens}"
    # The database may still be starting.
    for _ in $(seq 60); do
      curl -fsS -o /dev/null "$uri/v1/ping" && break
      sleep 1
    done
    spacetime --config-path "$state/cli.toml" publish \
      --server "$uri" --bin-path ${axioms}/share/axioms/axioms.wasm --yes=all \
      "''${AXIOMS_STDB_DB:-axioms}"
    exec axioms-server
  '';
}
