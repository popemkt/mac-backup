# The edge's public routes (B4), in one place: the front (./front.nix)
# routes exactly these and answers 404 to everything else, and tailscaled
# mounts exactly these (`publicPaths`, ./default.nix), on the tailnet and
# through Funnel alike. Nothing else (Keycloak's admin, account, master realm,
# registration, device, userinfo, introspection or logout endpoints, or
# oauth2-proxy's /oauth2/*) is mounted at either layer.
let
  edge = import ./constants.nix;
  realmPath = "/realms/${edge.realm}";
in
{
  inherit realmPath;

  # The MCP resource, through oauth2-proxy.
  mcp = "/mcp";

  # Static discovery documents the front serves, by which document. Gemini
  # reads the origin root; RFC 8414 clients insert the issuer's path; OpenID
  # clients append to the issuer.
  staticDocuments = {
    "/.well-known/oauth-protected-resource" = "resource";
    "/.well-known/oauth-protected-resource/mcp" = "resource";
    "/.well-known/oauth-authorization-server" = "server";
    "/.well-known/openid-configuration" = "server";
    "/.well-known/oauth-authorization-server${realmPath}" = "server";
    "/.well-known/openid-configuration${realmPath}" = "server";
    "${realmPath}/.well-known/openid-configuration" = "server";
    "${realmPath}/.well-known/oauth-authorization-server" = "server";
  };

  # Keycloak, exact paths: sign-in, token, keys, and the identity provider's
  # sign-in, callback and the steps after it.
  keycloakExact = [
    "${realmPath}/protocol/openid-connect/auth"
    "${realmPath}/protocol/openid-connect/token"
    "${realmPath}/protocol/openid-connect/certs"
    "${realmPath}/broker/${edge.idpAlias}/login"
    "${realmPath}/broker/${edge.idpAlias}/endpoint"
    "${realmPath}/broker/after-first-broker-login"
    "${realmPath}/broker/after-post-broker-login"
  ];

  # Keycloak, the two prefixes its sign-in pages need: their form posts and
  # their stylesheets.
  keycloakPrefixes = [
    "${realmPath}/login-actions/"
    "/resources/"
  ];
}
