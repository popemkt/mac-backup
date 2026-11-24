{
  config,
  lib,
  pkgs,
  ...
}:

# The front: the public allow-list (B4). tailscaled publishes this one
# loopback address (my.stacks.vpn.nodeServe in the host), so every path a
# client can reach is a route below, and everything else is 404: oauth2-proxy's
# own routes (/oauth2/*, /ping, /ready), Keycloak's admin, account, master
# realm, registration, device, userinfo, introspection and logout endpoints,
# and its discovery documents (the static ones here replace them). The front
# is in the VM test with the units behind it, which tailscaled's own path
# mounts could not be.
#
# Proxied routes pass the normalised path (nginx resolves `..` and `%2F`
# before matching, and a proxy_pass with a URI sends that form on), so no
# spelling of a path reaches a backend under a route it does not match.
let
  cfg = config.my.stacks.mcp-edge;
  edge = import ./constants.nix;
  json = name: value: pkgs.writeText name (builtins.toJSON value);
  oidc = "${cfg.issuer}/protocol/openid-connect";

  # RFC 9728: where the resource's tokens come from.
  protectedResource = json "oauth-protected-resource.json" {
    resource = cfg.resourceUri;
    authorization_servers = [ cfg.issuer ];
    scopes_supported = [
      "openid"
      "email"
      "profile"
    ];
    bearer_methods_supported = [ "header" ];
  };
  # RFC 8414 / OpenID discovery for the issuer, listing only what the front
  # routes and the clients may use: code with S256, client secrets, no
  # registration, device, userinfo or logout endpoint.
  authorizationServer = json "oauth-authorization-server.json" {
    inherit (cfg) issuer;
    authorization_endpoint = "${oidc}/auth";
    token_endpoint = "${oidc}/token";
    jwks_uri = "${oidc}/certs";
    response_types_supported = [ "code" ];
    response_modes_supported = [ "query" ];
    grant_types_supported = [
      "authorization_code"
      "refresh_token"
    ];
    code_challenge_methods_supported = [ "S256" ];
    token_endpoint_auth_methods_supported = [
      "client_secret_basic"
      "client_secret_post"
    ];
    scopes_supported = [
      "openid"
      "email"
      "profile"
    ];
    subject_types_supported = [ "public" ];
    id_token_signing_alg_values_supported = [ "RS256" ];
  };

  # kb's own body limit on `mcp --listen` (packages/app/mcp/src/http.ts,
  # MAX_BODY_BYTES): the base64 of its largest asset, 25 MiB
  # (ASSET_BYTES_INPUT_MAX = ceil(25 MiB / 3) * 4 + 256), plus 64 KiB for the
  # rest of the call. The front refuses (413) exactly what kb would.
  mcpBodyMax = (25 * 1024 * 1024 + 2) / 3 * 4 + 256 + 64 * 1024;

  routes = import ./routes.nix;
  keycloak = "http://127.0.0.1:${toString edge.ports.keycloak}";
  oauth2Proxy = "http://127.0.0.1:${toString edge.ports.oauth2Proxy}";

  forwarded = ''
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-Port 443;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  '';

  # The allow-list (./routes.nix): exact paths, except the two prefixes
  # Keycloak's sign-in pages need.
  documents = {
    resource = protectedResource;
    server = authorizationServer;
  };
  staticDocuments = lib.mapAttrs (_: kind: documents.${kind}) routes.staticDocuments;
  inherit (routes) keycloakExact keycloakPrefixes;

  locations =
    lib.mapAttrs' (
      path: file:
      lib.nameValuePair "= ${path}" {
        alias = file;
        extraConfig = ''
          default_type application/json;
          add_header Cache-Control "no-store" always;
        '';
      }
    ) staticDocuments
    // lib.listToAttrs (
      map (
        path:
        lib.nameValuePair "= ${path}" { extraConfig = "proxy_pass ${keycloak}${path};\n${forwarded}"; }
      ) keycloakExact
      ++ map (
        path:
        lib.nameValuePair "^~ ${path}" {
          extraConfig = "proxy_pass ${keycloak}${path};\n${forwarded}";
        }
      ) keycloakPrefixes
    )
    // {
      "= ${routes.mcp}".extraConfig = ''
        proxy_pass ${oauth2Proxy}/mcp;
        ${forwarded}
        # Only a bearer token authenticates: no session cookie reaches
        # oauth2-proxy (B3).
        proxy_set_header Cookie "";
        # Streamable HTTP answers may stream.
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
        # kb's own limit (mcpBodyMax above); anything larger is 413 here.
        client_max_body_size ${toString mcpBodyMax};
        # The body streams to oauth2-proxy as it arrives, through one small
        # buffer, and is never spooled to disk: oauth2-proxy refuses a
        # request without a token before reading it, so unauthenticated
        # uploads cannot fill nginx's temporary storage.
        proxy_request_buffering off;
        client_body_buffer_size 16k;
        # A 401 says where to sign in (RFC 9728 §5.1), which Claude reads.
        proxy_intercept_errors on;
        error_page 401 = @mcp-unauthorized;
      '';
      "@mcp-unauthorized".extraConfig = ''
        default_type application/json;
        add_header WWW-Authenticate 'Bearer resource_metadata="${cfg.publicOrigin}/.well-known/oauth-protected-resource/mcp"' always;
        return 401 '{"error":"invalid_token"}';
      '';
      "/".return = "404";
    };
in
{
  config = lib.mkIf cfg.enable {
    services.nginx = {
      enable = true;
      serverTokens = false;
      virtualHosts.mcp-edge = {
        default = true;
        serverName = cfg.host;
        # Keycloak's sign-in forms and token requests are small; only /mcp
        # takes a large body (below).
        extraConfig = ''
          client_max_body_size 64k;
        ''
        # Funnel off: tailscaled checks Funnel when it accepts a connection,
        # so a public connection opened while Funnel was on keeps reaching
        # the same mounts after they return to tailnet only. tailscaled
        # marks every request of a Funnel connection with
        # `Tailscale-Funnel-Request: ?1` and strips the header from any
        # other request, so its presence alone means public: refused here,
        # before anything is proxied.
        + lib.optionalString (!cfg.funnel) ''
          if ($http_tailscale_funnel_request) {
            return 404;
          }
        '';
        listen = [
          {
            addr = "127.0.0.1";
            port = edge.ports.front;
          }
        ];
        inherit locations;
      };
    };
  };
}
