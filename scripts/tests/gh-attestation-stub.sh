#!/usr/bin/env bash
set -eu

printf '%s\n' "$@" >"$STUB_RECORD/gh-args"
if [ "$1 $2" != "attestation verify" ] || [ "$(<"$3")" != "fixture artifact" ]; then
  echo "stub: unexpected gh command or artifact" >&2
  exit 2
fi

identity_prefix='https://github.com/example/held/.github/workflows/publish.yml'
identity="$identity_prefix@refs/heads/main"
requested_identity=
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--cert-identity" ]; then
    requested_identity="$2"
    shift
  fi
  shift
done

digest=0fc7c8c357dfa2cc6116cdf1172b5734908a31644d6a807152023dd63d7f151a
subject='held-5.3.7.tar.gz'
extra_subject=
case "${STUB_ATTESTATION:-}" in
  pass) ;;
  older-artifact) subject='held-5.3.6.tar.gz' ;;
  split-subject)
    extra_subject=',{"name":"held-5.3.7.tar.gz","digest":{"sha256":"another-digest"}}'
    subject='held-5.3.6.tar.gz'
    ;;
  signer-prefix) identity="$identity_prefix.bak@refs/heads/main" ;;
  signer-ref) identity="$identity_prefix@refs/heads/feature" ;;
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

if [ -n "$requested_identity" ] && [ "$requested_identity" != "$identity" ]; then
  echo 'Error: verifying with issuer "sigstore.dev"' >&2
  exit 1
fi
printf '[{"verificationResult":{"statement":{"subject":[{"name":"%s","digest":{"sha256":"%s"}}%s]}}}]\n' \
  "$subject" "$digest" "$extra_subject"
