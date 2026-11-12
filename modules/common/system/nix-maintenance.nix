# Shared retention policy; platform modules supply their managed Nix runtime.
{ nixBin }:
''
  set -eu
  ${nixBin}/nix-env --profile /nix/var/nix/profiles/system --delete-generations +7
  ${nixBin}/nix-store --gc
''
