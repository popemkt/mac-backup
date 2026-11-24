{
  config,
  lib,
  pkgs,
  ...
}:

# The edge's broker: Keycloak, because Dex cannot issue an access token bound
# to the MCP resource (docs/mcp-edge.md → B3: Dex 2.45 mints its access token
# with the ID token's own code and audience). Keycloak adds the resource to
# the access token only, through an audience mapper on each client.
#
# The realm is declared here and nowhere else: every start drops Keycloak's
# database and imports the realm afresh, with the secrets substituted from
# LoadCredential=. So a change here applies on the next start, the database
# holds nothing worth backing up (people come from Google at each sign-in),
# and a restart revokes every token and session and rotates the signing keys.
# Keycloak has no admin account; its admin console, admin API and account
# console are disabled at build time, and the front never routes to them.
let
  cfg = config.my.stacks.mcp-edge;
  edge = import ./constants.nix;
  inherit (config.services.postgresql) package;

  # A secret's environment variable: Keycloak substitutes ${NAME} in the
  # imported realm from its environment (the unit's script exports each from
  # $CREDENTIALS_DIRECTORY).
  envName = name: "KB_EDGE_" + lib.toUpper (lib.replaceStrings [ "-" ] [ "_" ] name);
  placeholder = name: "\${${envName name}}";

  clientSecretFile = name: "client-${name}-secret";
  # Credential name → machine-state file, for LoadCredential= and the exports.
  credentials =
    lib.genAttrs [ "google-client-id" "google-client-secret" ] lib.id
    // lib.mapAttrs' (
      name: _: lib.nameValuePair (clientSecretFile name) (clientSecretFile name)
    ) cfg.clients;

  client = name: client: {
    clientId = name;
    inherit name;
    enabled = true;
    protocol = "openid-connect";
    publicClient = false;
    clientAuthenticatorType = "client-secret";
    secret = placeholder (clientSecretFile name);
    inherit (client) redirectUris;
    webOrigins = [ ];
    # Authorization code only: no implicit, password, client-credentials,
    # device or CIBA grant, and no token exchange.
    standardFlowEnabled = true;
    implicitFlowEnabled = false;
    directAccessGrantsEnabled = false;
    serviceAccountsEnabled = false;
    authorizationServicesEnabled = false;
    frontchannelLogout = false;
    # The approval screen: "<client> wants access to your account". A weak
    # second layer behind the secret against the shared-callback attack.
    consentRequired = true;
    attributes = {
      # PKCE is required, and only S256.
      "pkce.code.challenge.method" = "S256";
      "oauth2.device.authorization.grant.enabled" = "false";
      "oidc.ciba.grant.enabled" = "false";
      "standard.token.exchange.enabled" = "false";
      "use.refresh.tokens" = "true";
      "display.on.consent.screen" = "true";
    };
    # basic carries `sub`; email carries `email` and `email_verified`, which
    # oauth2-proxy checks, whatever scopes the vendor asks for.
    defaultClientScopes = [
      "basic"
      "email"
      "profile"
    ];
    optionalClientScopes = [ "offline_access" ];
    protocolMappers = [
      {
        # B3: the access token, and only it, names the MCP resource.
        name = "mcp-resource-audience";
        protocol = "openid-connect";
        protocolMapper = "oidc-audience-mapper";
        consentRequired = false;
        config = {
          "included.custom.audience" = cfg.resourceUri;
          "access.token.claim" = "true";
          "id.token.claim" = "false";
          "introspection.token.claim" = "true";
          "lightweight.claim" = "false";
        };
      }
    ];
  };

  identityProvider = {
    alias = edge.idpAlias;
    providerId = cfg.upstream.provider;
    enabled = true;
    # Google verifies the address; oauth2-proxy checks it against the list.
    trustEmail = true;
    storeToken = false;
    addReadTokenRoleOnCreate = false;
    linkOnly = false;
    firstBrokerLoginFlowAlias = "first broker login";
    config = {
      clientId = placeholder "google-client-id";
      clientSecret = placeholder "google-client-secret";
      defaultScope = "openid email profile";
      syncMode = "IMPORT";
    }
    // lib.optionalAttrs (cfg.upstream.provider == "oidc") {
      inherit (cfg.upstream) issuer;
      authorizationUrl = "${cfg.upstream.issuer}/auth";
      tokenUrl = "${cfg.upstream.issuer}/token";
      jwksUrl = "${cfg.upstream.issuer}/keys";
      useJwksUrl = "true";
      validateSignature = "true";
      clientAuthMethod = "client_secret_post";
    };
  };

  realm = {
    inherit (edge) realm;
    enabled = true;
    displayName = "kb";
    sslRequired = "external";
    # Nobody registers, resets a password or signs in with one: people come
    # only through the identity provider.
    registrationAllowed = false;
    resetPasswordAllowed = false;
    rememberMe = false;
    verifyEmail = false;
    loginWithEmailAllowed = false;
    editUsernameAllowed = false;
    bruteForceProtected = true;
    # Short access tokens; a connector refreshes. Refresh tokens rotate and
    # are single-use. A session lasts at most 30 days (or until Keycloak
    # restarts), idle 14.
    accessTokenLifespan = 300;
    revokeRefreshToken = true;
    refreshTokenMaxReuse = 0;
    ssoSessionIdleTimeout = 14 * 24 * 3600;
    ssoSessionMaxLifespan = 30 * 24 * 3600;
    defaultSignatureAlgorithm = "RS256";
    identityProviders = [ identityProvider ];
    clients = lib.mapAttrsToList client cfg.clients;
  };
  # Under /etc, by a path with no store reference: the module keys a tmpfiles
  # rule on the file's name, which may not name a store path.
  realmFile = "/etc/mcp-edge/${edge.realm}-realm.json";
  realmJson = pkgs.writeText "${edge.realm}-realm.json" (builtins.toJSON realm);

  # Every start begins from an empty database (see the header).
  resetDatabase = pkgs.writeShellScript "keycloak-reset-database" ''
    set -eu
    ${pkgs.util-linux}/bin/runuser -u postgres -- ${package}/bin/psql -v ON_ERROR_STOP=1 -q \
      -c 'DROP DATABASE IF EXISTS keycloak WITH (FORCE)' \
      -c 'CREATE DATABASE keycloak OWNER keycloak'
  '';
in
{
  config = lib.mkIf cfg.enable {
    services.postgresql = {
      enable = true;
      # Keycloak's dynamic user `keycloak` signs in over the socket by peer
      # authentication: no password exists.
      ensureUsers = [ { name = "keycloak"; } ];
    };

    environment.etc."mcp-edge/${edge.realm}-realm.json".source = realmJson;

    services.keycloak = {
      enable = true;
      database = {
        type = "postgresql";
        host = "/run/postgresql";
        createLocally = false;
      };
      plugins = with config.services.keycloak.package.plugins; [
        junixsocket-common
        junixsocket-native-common
      ];
      settings = {
        # The public origin: every URL Keycloak issues, `iss` included.
        hostname = cfg.publicOrigin;
        http-enabled = true;
        http-host = "127.0.0.1";
        http-port = edge.ports.keycloak;
        # Only the front reaches it, which sets these.
        proxy-headers = "xforwarded";
        # One node: no cluster cache, whose JGroups transport would listen
        # on the network.
        cache = "local";
        # No management interface (health, metrics) at all.
        health-enabled = false;
        metrics-enabled = false;
        features-disabled = lib.concatStringsSep "," [
          "admin"
          "admin-api"
          "account"
          "device-flow"
          "ciba"
          "impersonation"
          "kerberos"
          "par"
          # Deprecated and on by default: the broker token-retrieval API
          # (storeToken is off anyway) and Twitter as a provider.
          "identity-brokering-api"
          "twitter-broker"
        ];
      };
      realmFiles = [ realmFile ];
    };

    systemd.services.keycloak = {
      after = [
        "postgresql.target"
        "mcp-edge-secrets.service"
      ];
      requires = [ "postgresql.target" ];
      # A realm change restarts it, which re-imports.
      restartTriggers = [ realmJson ];
      serviceConfig = {
        ExecStartPre = [ "+${resetDatabase}" ];
        LoadCredential = lib.mapAttrsToList (
          credential: file: "${credential}:${cfg.secretsDir}/${file}"
        ) credentials;
      };
      # Before the module's own script. The module links the realm into
      # /run/keycloak/data/import only at boot (tmpfiles), and the runtime
      # directory is emptied at every stop: link it again on each start.
      script = lib.mkBefore ''
        ${lib.concatMapStrings (credential: ''
          ${envName credential}=$(<"$CREDENTIALS_DIRECTORY/${credential}")
          export ${envName credential}
        '') (lib.attrNames credentials)}
        mkdir -p /run/keycloak/data/import
        ln -sfn ${realmFile} /run/keycloak/data/import/${baseNameOf realmFile}
      '';
    };
  };
}
