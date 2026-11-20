{ pkgs }:

# The proxy's two built pieces, shared by the daemon (./default.nix) and its
# test (./tests.nix), so the test runs exactly what the daemon runs:
#
# - `ca`: ./ca.sh with the openssl and GNU date it needs.
# - `caddyfile args`: ./caddyfile.nix rendered and parsed by Caddy at build
#   time, so a configuration Caddy cannot read fails the build, not the boot.
let
  inherit (pkgs) lib;
in
{
  ca = pkgs.writeShellApplication {
    name = "local-proxy-ca";
    runtimeInputs = [
      pkgs.coreutils
      pkgs.openssl
    ];
    text = builtins.readFile ./ca.sh;
  };

  caddyfile =
    args:
    let
      text = pkgs.writeText "local-proxy.Caddyfile" (import ./caddyfile.nix { inherit lib; } args);
    in
    pkgs.runCommand "local-proxy-Caddyfile" { } ''
      ${lib.getExe pkgs.caddy} adapt --config ${text} --adapter caddyfile >/dev/null
      ln -s ${text} "$out"
    '';
}
