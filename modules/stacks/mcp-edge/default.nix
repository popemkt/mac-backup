{
  config,
  lib,
  pkgs,
  ...
}:

# mcp-edge: the OAuth edge in front of one MCP server on this host, kb's
# (docs/mcp-edge.md; the design is popemkt/kb
# docs/research/2026-11-24-public-mcp.md, §6 row 1b and B1–B5). NixOS only.
#
#   tailscaled (node serve, HTTPS; Funnel when `funnel` is on) → front
#   (nginx, 127.0.0.1, the public allow-list) → Keycloak (sign-in, tokens) │
#   oauth2-proxy (/mcp) → kb's socket, /run/kb-edge/mcp.sock
#
# tailscaled mounts only the allow-list's paths (./routes.nix), so the route
# table is enforced twice: by what tailscaled forwards at all, and by the
# front.
#
# The MCP server itself is not this stack's: a kb store contributes it through
# `resource` (my.stacks.kb.stores.<store>.remoteMcp, modules/stacks/kb), and
# runs it as the edge's identity, `kb-edge`, the only account besides root
# that can open its socket (B1).
#
# Files: ./keycloak.nix (the broker: realm, static clients, Google),
# ./oauth2-proxy.nix (the bearer check on /mcp), ./routes.nix (the public
# routes), ./front.nix (the route allow-list and the static discovery
# documents), ./tests.nix (the VM test, checks.x86_64-linux.mcp-edge).
let
  mkStack = import ../mk-stack.nix lib;
  inherit (lib) mkOption types;
  cfg = config.my.stacks.mcp-edge;
  edge = import ./constants.nix;
  routes = import ./routes.nix;
in
{
  imports = [
    ./front.nix
    ./keycloak.nix
    ./oauth2-proxy.nix
  ];

  options.my.stacks.mcp-edge = mkStack {
    description = "OAuth edge (Keycloak + oauth2-proxy) in front of kb's MCP";
    componentOptions = {
      host = mkOption {
        type = types.strMatching "[a-z0-9.-]+";
        default = "${config.my.hostname}.${config.my.stacks.vpn.tailnetDomain}";
        defaultText = lib.literalExpression ''"''${config.my.hostname}.''${config.my.stacks.vpn.tailnetDomain}"'';
        description = ''
          The public host name the edge answers as: the issuer, the MCP
          resource and every redirect are https://<host>/…. By default this
          machine's own tailnet name, which the vpn stack's node serve entry
          publishes (my.stacks.vpn.nodeServe).
        '';
      };

      funnel = mkOption {
        type = types.bool;
        default = false;
        description = ''
          Publish the edge on the internet through Tailscale Funnel (phase
          1c), not only on the tailnet: Gemini's and Claude's backends call
          it from their own clouds. Only `publicPaths` are mounted, the same
          as on the tailnet. Needs the tailnet policy's `funnel` node
          attribute for this machine's tag (configs/tailscale/policy.hujson;
          scripts/check-tailscale-policy.sh fails without it). Off: the
          vpn reconcile takes the port's Funnel down
          (docs/mcp-edge.md → Off switch).
        '';
      };

      clients = mkOption {
        default = { };
        description = ''
          The OAuth clients that may sign in: one per vendor connector, each
          with its own secret (generated on first start into
          `<secretsDir>/client-<name>-secret`, which the owner pastes into
          the connector's "Client secret" field) and exact redirect URIs.
          Authorization code with S256 PKCE only. The secret is what stops a
          connector someone else adds in their own account from redeeming a
          sign-in the owner completes (docs/mcp-edge.md → Why the secret).
        '';
        type = types.attrsOf (
          types.submodule {
            options.redirectUris = mkOption {
              type = types.listOf (types.strMatching "https://[^[:space:]]+");
              default = [ ];
              description = ''
                The exact redirect URIs the vendor sends; a `*` is refused
                (Keycloak would read it as a wildcard). Empty: the client
                cannot complete a sign-in (Keycloak refuses every redirect),
                which is how a client whose redirect is not yet known stays
                closed.
              '';
            };
          }
        );
      };

      upstream = mkOption {
        default = { };
        description = ''
          Where people sign in: Google by default. Another OpenID provider
          (`provider = "oidc"`) stands in for Google in the VM test.
        '';
        type = types.submodule {
          options = {
            provider = mkOption {
              type = types.enum [
                "google"
                "oidc"
              ];
              default = "google";
              description = "Keycloak identity provider type.";
            };
            issuer = mkOption {
              type = types.nullOr types.str;
              default = null;
              example = "http://127.0.0.1:5556/dex";
              description = ''
                For `oidc` only: the provider's issuer. Its endpoints are the
                issuer's `/auth`, `/token` and `/keys` (Dex's layout).
              '';
            };
          };
        };
      };

      secretsDir = mkOption {
        type = types.str;
        default = "/var/lib/mcp-edge/secrets";
        description = ''
          Machine state, root-only (0700), never declared: the Google OAuth
          client the owner creates (`google-client-id`,
          `google-client-secret`) and each client's generated secret. Units
          read them through LoadCredential=.
        '';
      };

      resource = mkOption {
        type = types.nullOr (
          types.submodule {
            options.allowedEmails = mkOption {
              type = types.nonEmptyListOf (types.strMatching "[^[:space:]@]+@[^[:space:]@]+");
              description = "Verified email addresses whose tokens /mcp accepts.";
            };
          }
        );
        default = null;
        internal = true;
        description = ''
          The MCP server behind /mcp, contributed by the component that runs
          it (a kb store's `remoteMcp`). It listens on `socket` as `user`.
        '';
      };

      # Derived, for the components that serve behind the edge and for hosts.
      publicOrigin = mkOption {
        type = types.str;
        readOnly = true;
        default = "https://${cfg.host}";
        description = "The edge's public origin.";
      };
      issuer = mkOption {
        type = types.str;
        readOnly = true;
        default = "${cfg.publicOrigin}/realms/${edge.realm}";
        description = "The token issuer (Keycloak's realm), on the public origin.";
      };
      resourceUri = mkOption {
        type = types.str;
        readOnly = true;
        default = "${cfg.publicOrigin}/mcp";
        description = "The MCP resource: the audience every accepted access token carries (B3).";
      };
      frontOrigin = mkOption {
        type = types.str;
        readOnly = true;
        default = "http://127.0.0.1:${toString edge.ports.front}";
        description = "Where the front listens: the one target tailscaled publishes.";
      };
      publicPaths = mkOption {
        type = types.listOf types.str;
        readOnly = true;
        default = [
          routes.mcp
        ]
        ++ lib.attrNames routes.staticDocuments
        ++ routes.keycloakExact
        ++ routes.keycloakPrefixes;
        description = ''
          Every path tailscaled mounts for the edge, on the tailnet and
          through Funnel: the front's allow-list (./routes.nix), and nothing
          else.
        '';
      };
      user = mkOption {
        type = types.str;
        readOnly = true;
        default = edge.user;
        description = "The edge's identity: oauth2-proxy and the MCP server run as it (B1).";
      };
      socket = mkOption {
        type = types.str;
        readOnly = true;
        default = edge.socket;
        description = "The MCP server's socket, in a directory only `user` can enter.";
      };
    };
  };

  config = lib.mkMerge [
    {
      assertions = [
        {
          assertion = cfg.funnel -> cfg.enable;
          message = "my.stacks.mcp-edge.funnel publishes the edge, which is off: it needs my.stacks.mcp-edge.enable.";
        }
      ];
    }
    (lib.mkIf cfg.enable {
      assertions = [
        {
          assertion = cfg.resource != null;
          message = "my.stacks.mcp-edge has nothing to serve: enable remoteMcp on one kb store.";
        }
        {
          # Keycloak treats a trailing `*` as a wildcard; every redirect here is
          # exact, so none may contain one.
          assertion = lib.all (client: lib.all (uri: !lib.hasInfix "*" uri) client.redirectUris) (
            lib.attrValues cfg.clients
          );
          message = "my.stacks.mcp-edge.clients.*.redirectUris must be exact: no `*` (${
            toString (
              lib.filter (lib.hasInfix "*") (lib.concatMap (c: c.redirectUris) (lib.attrValues cfg.clients))
            )
          }).";
        }
        {
          assertion = cfg.upstream.provider == "oidc" -> cfg.upstream.issuer != null;
          message = "my.stacks.mcp-edge.upstream.issuer is required for provider = \"oidc\".";
        }
      ];

      # The edge's own entry on this machine's tailnet name: the front, at the
      # allow-list's paths only, and through Funnel when it is on.
      my.stacks.vpn.nodeServe.mcp-edge = {
        target = cfg.frontOrigin;
        paths = cfg.publicPaths;
        inherit (cfg) funnel;
      };

      users.users.${edge.user} = {
        isSystemUser = true;
        group = edge.user;
        description = "kb's OAuth edge (oauth2-proxy and the remote MCP server)";
      };
      users.groups.${edge.user} = { };

      # The socket's directory: only kb-edge (and root) may enter it, so no
      # process of the store's owner can reach the MCP server without a token.
      systemd.tmpfiles.settings."10-mcp-edge".${edge.socketDir}.d = {
        inherit (edge) user;
        group = edge.user;
        mode = "0700";
      };

      # The secrets directory, and the client secrets nobody needs to choose.
      # The Google client is the owner's one-time step (docs/mcp-edge.md); a
      # missing file fails this unit, naming it, and Keycloak waits for it.
      systemd.services.mcp-edge-secrets = {
        description = "Check and generate the MCP edge's machine-state secrets";
        before = [ "keycloak.service" ];
        requiredBy = [ "keycloak.service" ];
        path = [ pkgs.openssl ];
        serviceConfig = {
          Type = "oneshot";
          RemainAfterExit = true;
          UMask = "0077";
        };
        script = ''
          set -eu
          dir=${lib.escapeShellArg cfg.secretsDir}
          install -d -m 0700 "$dir"
          ${lib.concatMapStrings (name: ''
            if [ ! -s "$dir/client-${name}-secret" ]; then
              openssl rand -hex 32 > "$dir/client-${name}-secret"
              echo "generated $dir/client-${name}-secret"
            fi
          '') (lib.attrNames cfg.clients)}
          missing=""
          for file in google-client-id google-client-secret; do
            [ -s "$dir/$file" ] || missing="$missing $dir/$file"
          done
          if [ -n "$missing" ]; then
            echo "missing machine-state secrets:$missing (docs/mcp-edge.md → One-time steps)" >&2
            exit 1
          fi
        '';
      };
    })
  ];
}
