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
# Keycloak's database persists across restarts, reboots and upgrades: its
# sessions, refresh tokens and signing keys survive, so a connector stays
# signed in (at most 30 days, below). Revoking them is an explicit command,
# `mcp-edge-secrets revoke-all` (docs/mcp-edge.md → Revoke every token).
#
# The realm is still declared here and nowhere else: after every Keycloak
# start, `mcp-edge-realm` reconciles it from Nix with keycloak-config-cli,
# secrets substituted from LoadCredential=. It sets the realm, its clients
# (secrets, exact redirects, scopes, grant toggles, the audience mapper) and
# the identity provider as declared, and deletes any client or identity
# provider not declared (one added by hand); Keycloak's own built-in clients
# stay. It does not touch users, sessions or keys.
#
# It signs in as a service client of the master realm (constants.nix →
# adminClient), over loopback. Keycloak's admin API exists for it, on
# 127.0.0.1 only; the front never routes /admin or /realms/master, and the
# admin console and account console are disabled at build time.
let
  cfg = config.my.stacks.mcp-edge;
  edge = import ./constants.nix;
  inherit (config.services.postgresql) package;

  # A secret's environment variable: keycloak-config-cli substitutes
  # $(env:NAME) in the realm from its environment (mcp-edge-realm exports each
  # from $CREDENTIALS_DIRECTORY).
  envName = name: "KB_EDGE_" + lib.toUpper (lib.replaceStrings [ "-" ] [ "_" ] name);
  placeholder = name: "$(env:${envName name})";

  clientSecretFile = name: "client-${name}-secret";
  # Credential name → machine-state file, for LoadCredential= and the exports.
  credentials =
    lib.genAttrs [ "google-client-id" "google-client-secret" ] lib.id
    // lib.mapAttrs' (
      name: _: lib.nameValuePair (clientSecretFile name) (clientSecretFile name)
    ) cfg.clients;

  # Token and session lifetimes, in seconds: the realm's, and every
  # client's too (below).
  lifetimes = {
    # Short access tokens; a connector refreshes.
    accessToken = 300;
    # A session lasts at most 30 days, idle 14, Keycloak restarts included;
    # `mcp-edge-secrets revoke-all` ends them all.
    sessionIdle = 14 * 24 * 3600;
    sessionMax = 30 * 24 * 3600;
    # The backstop, should an offline token ever be issued: the same 30 days.
    offlineIdle = 30 * 24 * 3600;
    offlineMax = 30 * 24 * 3600;
  };

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
    # The realm's browser flow, never one bound to this client by hand
    # (the reconcile clears any binding not declared).
    authenticationFlowBindingOverrides = { };
    # The reconcile merges attributes: one set by hand and not declared
    # here would survive it. So every attribute that would override the
    # realm's lifetimes or loosen a grant is declared, pinned to the realm's
    # value.
    attributes = {
      "access.token.lifespan" = toString lifetimes.accessToken;
      "client.session.idle.timeout" = toString lifetimes.sessionIdle;
      "client.session.max.lifespan" = toString lifetimes.sessionMax;
      "client.offline.session.idle.timeout" = toString lifetimes.offlineIdle;
      "client.offline.session.max.lifespan" = toString lifetimes.offlineMax;
      "client_credentials.use_refresh_token" = "false";
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
    # No offline_access: an offline token would outlive the session maximum
    # below. Asking for it fails the sign-in (invalid_scope). Listing the
    # default scopes already drops the realm's optional ones at import; this
    # says so rather than leaning on it.
    optionalClientScopes = [ ];
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
    # Lifetimes (above). Refresh tokens rotate and are single-use.
    accessTokenLifespan = lifetimes.accessToken;
    revokeRefreshToken = true;
    refreshTokenMaxReuse = 0;
    ssoSessionIdleTimeout = lifetimes.sessionIdle;
    ssoSessionMaxLifespan = lifetimes.sessionMax;
    offlineSessionIdleTimeout = lifetimes.offlineIdle;
    offlineSessionMaxLifespanEnabled = true;
    offlineSessionMaxLifespan = lifetimes.offlineMax;
    defaultSignatureAlgorithm = "RS256";
    identityProviders = [ identityProvider ];
    clients = lib.mapAttrsToList client cfg.clients;
  };
  realmJson = pkgs.writeText "${edge.realm}-realm.json" (builtins.toJSON realm);

  # The database is created once, and kept (see the header).
  ensureDatabase = pkgs.writeShellScript "keycloak-ensure-database" ''
    set -eu
    psql() {
      ${pkgs.util-linux}/bin/runuser -u postgres -- ${package}/bin/psql -v ON_ERROR_STOP=1 -qtA "$@"
    }
    if [ "$(psql -c "SELECT 1 FROM pg_database WHERE datname = 'keycloak'")" != 1 ]; then
      psql -c 'CREATE DATABASE keycloak OWNER keycloak'
    fi
  '';

  keycloakUrl = "http://127.0.0.1:${toString edge.ports.keycloak}";
  adminSecret = "${cfg.secretsDir}/${edge.adminSecretFile}";
in
{
  config = lib.mkIf cfg.enable {
    services.postgresql = {
      enable = true;
      # Keycloak's dynamic user `keycloak` signs in over the socket by peer
      # authentication: no password exists.
      ensureUsers = [ { name = "keycloak"; } ];
    };

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
        # The admin API stays, for mcp-edge-realm and revoke-all (see the
        # header); its console does not.
        features-disabled = lib.concatStringsSep "," [
          "admin"
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
    };

    systemd.services.keycloak = {
      after = [
        "postgresql.target"
        "mcp-edge-secrets.service"
      ];
      requires = [ "postgresql.target" ];
      serviceConfig = {
        # A crash comes back with the same database: sessions survive. The
        # realm reconcile and oauth2-proxy stop and start with it
        # (mcp-edge-realm below, ./oauth2-proxy.nix).
        Restart = "on-failure";
        RestartSec = 5;
        ExecStartPre = [ "+${ensureDatabase}" ];
        LoadCredential = [ "admin-secret:${adminSecret}" ];
      };
      # The admin service client, created with the master realm (first start
      # on an empty database); Keycloak ignores these once an admin exists.
      environment.KC_BOOTSTRAP_ADMIN_CLIENT_ID = edge.adminClient;
      script = lib.mkBefore ''
        KC_BOOTSTRAP_ADMIN_CLIENT_SECRET=$(<"$CREDENTIALS_DIRECTORY/admin-secret")
        export KC_BOOTSTRAP_ADMIN_CLIENT_SECRET
      '';
    };

    # The realm from Nix, after every Keycloak start (see the header). It
    # lives as long as one Keycloak run, like oauth2-proxy, which waits for
    # it: a realm that did not reconcile serves no /mcp.
    systemd.services.mcp-edge-realm = {
      description = "Reconcile the MCP edge's Keycloak realm from Nix";
      after = [ "keycloak.service" ];
      bindsTo = [ "keycloak.service" ];
      upheldBy = [ "keycloak.service" ];
      restartTriggers = [ realmJson ];
      path = [
        pkgs.curl
        pkgs.jq
      ];
      environment = {
        EDGE_KEYCLOAK = keycloakUrl;
        EDGE_REALM = edge.realm;
        EDGE_ADMIN_CLIENT = edge.adminClient;
      };
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
        DynamicUser = true;
        # The front's gate (./front.nix): the flag file exists only while
        # this run succeeded. systemd removes the directory when the unit
        # stops or fails, and it stops with Keycloak (BindsTo=).
        RuntimeDirectory = baseNameOf (dirOf edge.realmReady);
        RuntimeDirectoryMode = "0755";
        LoadCredential = [
          "admin-secret:${adminSecret}"
        ]
        ++ lib.mapAttrsToList (credential: file: "${credential}:${cfg.secretsDir}/${file}") credentials;
        # Loopback only: Keycloak's admin API.
        IPAddressDeny = "any";
        IPAddressAllow = "localhost";
        RestrictAddressFamilies = [
          "AF_UNIX"
          "AF_INET"
          "AF_INET6"
        ];
        PrivateTmp = true;
        PrivateDevices = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        ProtectKernelTunables = true;
        ProtectKernelModules = true;
        ProtectControlGroups = true;
        NoNewPrivileges = true;
        CapabilityBoundingSet = "";
      };
      # Secrets reach it through its environment only, never its command
      # line (which every local user can read). remote-state off: it deletes
      # every client and identity provider not declared, not only the ones
      # it created itself. cache off: it imports every time, so a value
      # changed by hand is restored though the file did not change. Then the
      # realm's key providers: any Keycloak did not generate (a key
      # imported by hand) is removed, since no declaration here makes one.
      script = ''
        set -euo pipefail
        ${builtins.readFile ./keycloak-admin.sh}
        ${lib.concatMapStrings (credential: ''
          ${envName credential}=$(<"$CREDENTIALS_DIRECTORY/${credential}")
          export ${envName credential}
        '') (lib.attrNames credentials)}
        KEYCLOAK_CLIENTSECRET=$(<"$CREDENTIALS_DIRECTORY/admin-secret")
        export KEYCLOAK_CLIENTSECRET
        ${lib.getExe pkgs.keycloak-config-cli} \
          --keycloak.url=${keycloakUrl} \
          --keycloak.login-realm=master \
          --keycloak.grant-type=client_credentials \
          --keycloak.client-id=${edge.adminClient} \
          --keycloak.availability-check.enabled=true \
          --import.files.locations=${realmJson} \
          --import.var-substitution.enabled=true \
          --import.remote-state.enabled=false \
          --import.cache.enabled=false
        admin_login "$KEYCLOAK_CLIENTSECRET"
        remove_foreign_key_providers
        touch ${edge.realmReady}
      '';
    };
  };
}
