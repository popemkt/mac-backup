{ pkgs }:

# Runs the proxy's own CA script and Caddy configuration (./package.nix,
# what the daemon runs) on a high port with a scratch state directory, in
# front of ./tests-backend.py, and ./tests.sh asserts what the stack
# promises: a root-only CA, constrained to localhost DNS names and no IP
# address (checked by openssl and macOS's verifier), made once and replaced
# when broken or under-constrained; loopback-only HTTPS with no admin endpoint and no
# HTTP listener; Host and Origin passed through untouched; WebSocket upgrade
# and unbuffered SSE; and no certificate for an undeclared name.
let
  # Caddy reads `{$STATE}` from the environment, so the build directory
  # ./tests.sh makes is the state directory.
  stateDir = "{$STATE}";
  port = 29443;
  backendPort = 29180;
  caName = "Local Proxy CA (test)";
  built = import ./package.nix { inherit pkgs; };
  caddyfile = built.caddyfile {
    sites.app.target = "http://127.0.0.1:${toString backendPort}";
    inherit stateDir caName port;
  };
in
pkgs.runCommand "local-proxy-check"
  {
    nativeBuildInputs = [
      built.ca
      pkgs.caddy
      pkgs.curl
      pkgs.jq
      pkgs.openssl
      pkgs.python3
    ];
    # Caddy and the backend listen on loopback.
    __darwinAllowLocalNetworking = true;
    env = {
      CA_NAME = caName;
      PORT = toString port;
      BACKEND_PORT = toString backendPort;
      CADDYFILE = caddyfile;
      BACKEND = "${./tests-backend.py}";
    };
  }
  ''
    bash ${./tests.sh}
    touch "$out"
  ''
