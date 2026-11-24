# The edge's fixed names and loopback ports, read by every file of the stack
# and by the VM test. Nothing outside 127.0.0.1 listens on any of them.
rec {
  # The identity oauth2-proxy and the MCP server share (B1).
  user = "kb-edge";
  socketDir = "/run/kb-edge";
  socket = "${socketDir}/mcp.sock";
  # Keycloak's realm; its issuer is https://<host>/realms/<realm>.
  realm = "kb";
  # The identity provider's alias in the realm, which names its callback
  # (/realms/<realm>/broker/<alias>/endpoint) whatever provider it is.
  idpAlias = "google";
  # Keycloak's admin: a service client in the master realm, created when
  # Keycloak first creates that realm, whose secret is machine state
  # (<secretsDir>/keycloak-admin-secret). Only the realm reconcile and
  # `mcp-edge-secrets revoke-all` use it, over loopback.
  adminClient = "mcp-edge-admin";
  adminSecretFile = "keycloak-admin-secret";
  # Present only while this boot's realm reconcile succeeded (mcp-edge-realm):
  # until then the front answers 503 on every Keycloak route.
  realmReady = "/run/mcp-edge-realm/reconciled";
  ports = {
    front = 4190;
    oauth2Proxy = 4180;
    keycloak = 8180;
  };
}
