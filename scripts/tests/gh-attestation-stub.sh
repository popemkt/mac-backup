#!/usr/bin/env bash
set -eu

printf '%s\n' "$@" >"$STUB_RECORD/gh-args"
if [ "$1 $2" != "attestation verify" ] || [ "$(<"$3")" != "fixture artifact" ]; then
  echo "stub: unexpected gh command or artifact" >&2
  exit 2
fi

case "${STUB_ATTESTATION:-}" in
  pass) ;;
  mismatch)
    echo 'Error: verifying with issuer "sigstore.dev"' >&2
    exit 1
    ;;
  missing)
    echo "Error: HTTP 404: Not Found" >&2
    exit 1
    ;;
  offline)
    echo "error creating Sigstore verifier: no valid Sigstore verifiers could be initialized" >&2
    exit 1
    ;;
  *)
    echo "stub: unexpected gh invocation" >&2
    exit 2
    ;;
esac
