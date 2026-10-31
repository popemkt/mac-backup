{
  writeShellApplication,
  coreutils,
  openssl,
  spacetimedb,
}:

# The database half of axioms' live mode (my.services.axioms-db on
# shared-server): SpacetimeDB standalone on HOST:PORT, keeping everything in
# AXIOMS_STDB_HOME (docs/backup-strategy.md → axioms). The token signing keys
# are made on first start; new keys orphan every identity they signed.
(writeShellApplication {
  name = "axioms-db";
  runtimeInputs = [
    coreutils
    openssl
    spacetimedb
  ];
  text = ''
    state="''${AXIOMS_STDB_HOME:?set AXIOMS_STDB_HOME, the SpacetimeDB state directory}"
    mkdir -p "$state/data"
    if [ ! -s "$state/id_ecdsa" ]; then
      umask 077
      openssl ecparam -name prime256v1 -genkey -noout \
        | openssl pkcs8 -topk8 -nocrypt -out "$state/id_ecdsa"
      openssl ec -in "$state/id_ecdsa" -pubout -out "$state/id_ecdsa.pub"
    fi
    exec spacetimedb-standalone start \
      --listen-addr "''${HOST:-127.0.0.1}:''${PORT:?}" \
      --data-dir "$state/data" \
      --jwt-priv-key-path "$state/id_ecdsa" \
      --jwt-pub-key-path "$state/id_ecdsa.pub" \
      --page_pool_max_size "''${AXIOMS_STDB_PAGE_POOL:-536870912}" \
      --non-interactive
  '';
}).overrideAttrs
  (old: {
    meta = (old.meta or { }) // {
      inherit (spacetimedb.meta) platforms;
    };
  })
