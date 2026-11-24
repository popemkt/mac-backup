{ pkgs, cfg }:
# The `mcp-edge-secrets` command (./secrets-cli.sh, docs/mcp-edge.md): the
# owner's way to put the Google client on the server, read a client's
# secret, rotate one, and revoke every token. This file hands the script its
# constants.
let
  edge = import ./constants.nix;
in
pkgs.writeShellApplication {
  name = "mcp-edge-secrets";
  runtimeInputs = with pkgs; [
    coreutils
    curl
    jq
    systemd
  ];
  runtimeEnv = {
    EDGE_SECRETS_DIR = cfg.secretsDir;
    EDGE_CLIENTS = toString (builtins.attrNames cfg.clients);
    EDGE_KEYCLOAK = "http://127.0.0.1:${toString edge.ports.keycloak}";
    EDGE_REALM = edge.realm;
    EDGE_ADMIN_CLIENT = edge.adminClient;
    EDGE_ADMIN_SECRET = edge.adminSecretFile;
  };
  text = builtins.readFile ./secrets-cli.sh;
  meta.mainProgram = "mcp-edge-secrets";
}
