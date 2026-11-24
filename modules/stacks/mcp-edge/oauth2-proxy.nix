{
  config,
  lib,
  pkgs,
  ...
}:

# The check on /mcp: oauth2-proxy, as kb-edge, the one account besides root
# that can open the MCP server's socket (B1). A request passes only with a
# bearer access token Keycloak signed, whose `iss` is the public issuer, whose
# audience is the MCP resource (B3), and whose verified email is on the
# resource's list. Without a valid token it answers 401; with a valid token
# for anyone else, 403.
#
# It fetches Keycloak's keys over loopback, never the public URL, and reaches
# nothing but loopback (B5): no discovery, and the issuer it checks is still
# the public one. It lives exactly as long as one Keycloak run whose realm
# reconciled: it stops whenever Keycloak stops, crashes included (BindsTo=),
# and starts again once mcp-edge-realm has reconciled the realm after the
# next start (Upholds=), so it never serves /mcp for a realm that is not the
# declared one. It caches Keycloak's keys: `mcp-edge-secrets revoke-all`,
# which rotates them, restarts it, so a token signed with an old key is
# refused at once rather than when a new key id made it refetch.
#
# Its own sign-in is unusable: its routes (/oauth2/*) are never routed by the
# front, it has no client at Keycloak (its client id is the resource URI,
# which no client is), and its cookie secret is random per start, kept in its
# runtime directory. The front strips cookies from /mcp as well.
#
# Not services.oauth2-proxy: that module runs as its own user, passes secrets
# through an environment file and has no egress limit; this unit needs all
# three otherwise.
let
  cfg = config.my.stacks.mcp-edge;
  edge = import ./constants.nix;
  keycloak = "http://127.0.0.1:${toString edge.ports.keycloak}/realms/${edge.realm}/protocol/openid-connect";
  emails = pkgs.writeText "mcp-edge-emails" (
    lib.concatLines (if cfg.resource == null then [ ] else cfg.resource.allowedEmails)
  );
  runtime = "/run/mcp-edge-oauth2-proxy";

  args = [
    "--provider=oidc"
    "--oidc-issuer-url=${cfg.issuer}"
    "--skip-oidc-discovery"
    "--oidc-jwks-url=${keycloak}/certs"
    # Required without discovery; never used, since no sign-in reaches it.
    "--login-url=${cfg.issuer}/protocol/openid-connect/auth"
    "--redeem-url=${keycloak}/token"
    # The only audience accepted (B3).
    "--client-id=${cfg.resourceUri}"
    "--client-secret-file=${runtime}/client-secret"
    "--cookie-secret-file=${runtime}/cookie-secret"
    "--cookie-secure=true"
    "--skip-jwt-bearer-tokens=true"
    # No token: 401, never a redirect to a sign-in page.
    "--api-route=^/mcp$"
    "--force-json-errors=true"
    "--authenticated-emails-file=${emails}"
    "--upstream=unix://${edge.socket}"
    # The MCP server sees Host: localhost, not the public name.
    "--pass-host-header=false"
    "--http-address=127.0.0.1:${toString edge.ports.oauth2Proxy}"
    "--reverse-proxy=true"
    "--redirect-url=${cfg.publicOrigin}/oauth2/callback"
  ];
in
{
  config = lib.mkIf cfg.enable {
    systemd.services.mcp-edge-oauth2-proxy = {
      description = "oauth2-proxy: the bearer check in front of kb's remote MCP";
      wantedBy = [ "multi-user.target" ];
      # One Keycloak run, one oauth2-proxy run, after the realm reconciled
      # (see the header).
      after = [
        "keycloak.service"
        "mcp-edge-realm.service"
      ];
      bindsTo = [
        "keycloak.service"
        "mcp-edge-realm.service"
      ];
      upheldBy = [ "mcp-edge-realm.service" ];
      path = [ pkgs.openssl ];
      serviceConfig = {
        User = edge.user;
        Group = edge.user;
        RuntimeDirectory = baseNameOf runtime;
        RuntimeDirectoryMode = "0700";
        UMask = "0077";
        ExecStartPre = pkgs.writeShellScript "mcp-edge-oauth2-proxy-secrets" ''
          set -eu
          ${pkgs.openssl}/bin/openssl rand -base64 32 | tr -- '+/' '-_' | tr -d '\n' > ${runtime}/cookie-secret
          ${pkgs.openssl}/bin/openssl rand -hex 32 > ${runtime}/client-secret
        '';
        ExecStart = "${lib.getExe pkgs.oauth2-proxy} ${lib.escapeShellArgs args}";
        Restart = "on-failure";
        RestartSec = 5;

        # B5: loopback only.
        IPAddressDeny = "any";
        IPAddressAllow = "localhost";
        RestrictAddressFamilies = [
          "AF_UNIX"
          "AF_INET"
          "AF_INET6"
        ];

        CapabilityBoundingSet = "";
        AmbientCapabilities = "";
        NoNewPrivileges = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        PrivateTmp = true;
        PrivateDevices = true;
        PrivateIPC = true;
        # Its own PID namespace: kb-remote shares its user, and ProtectProc=
        # hides only other users' processes (/proc/<pid>/root of either would
        # open the other's mount view).
        PrivatePIDs = true;
        ProtectProc = "invisible";
        ProcSubset = "pid";
        ProtectKernelTunables = true;
        ProtectKernelModules = true;
        ProtectKernelLogs = true;
        ProtectControlGroups = true;
        ProtectClock = true;
        ProtectHostname = true;
        RestrictNamespaces = true;
        RestrictRealtime = true;
        RestrictSUIDSGID = true;
        LockPersonality = true;
        MemoryDenyWriteExecute = true;
        SystemCallArchitectures = "native";
        SystemCallFilter = [
          "@system-service"
          "~@privileged"
        ];
      };
    };
  };
}
