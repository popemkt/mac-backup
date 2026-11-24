{ pkgs }:

# checks.x86_64-linux.mcp-edge: the OAuth edge under its real units and
# sandboxes (docs/mcp-edge.md → Tests). One machine runs what shared-server
# would: app-kb (the owner's store, real kb), kb-remote (as kb-edge, in its
# sandbox), oauth2-proxy, Keycloak and the front. Two stand-ins:
#   - Google: Dex with two password accounts (owner@, intruder@), reached
#     through Keycloak's generic OpenID provider (`upstream.provider = "oidc"`);
#   - tailscaled: an nginx that terminates TLS for the public name and
#     forwards every path to the front, as `nodeServe` does.
# kb-remote and app-kb both run the pinned kb (pkgs.kb), as shared-server
# would.
let
  inherit (pkgs) lib;
  edge = import ./constants.nix;
  host = "mcp.example.ts.net";
  dexIssuer = "http://127.0.0.1:5556/dex";
  mockGoogleSecret = "mock-google-secret";
  geminiRedirect = "https://oauth-redirect.googleusercontent.com/r/edge-test";
  claudeRedirect = "https://claude.ai/api/mcp/auth_callback";

  cert = pkgs.runCommand "edge-test-cert" { nativeBuildInputs = [ pkgs.openssl ]; } ''
    mkdir "$out"
    openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=${host}" \
      -addext "subjectAltName=DNS:${host}" \
      -keyout "$out/key.pem" -out "$out/cert.pem"
  '';

  python = pkgs.python3.withPackages (p: [
    p.requests
    p.pyjwt
    p.cryptography
  ]);
  edgeTest = pkgs.writeShellScriptBin "edge-test" ''
    export EDGE_HOST=${host} EDGE_CA=${cert}/cert.pem EDGE_SECRETS=/var/lib/mcp-edge/secrets
    export EDGE_KEYCLOAK=http://127.0.0.1:${toString edge.ports.keycloak}
    exec ${python}/bin/python3 -I ${./tests/edge-test.py} "$@"
  '';

  # oauth2-proxy's own cookie store, signing a session for the test.
  mintCookie = pkgs.oauth2-proxy.overrideAttrs (old: {
    pname = "mint-cookie";
    postPatch = (old.postPatch or "") + ''
      mkdir -p cmd/mint-cookie
      cp ${./tests/mint-cookie.go} cmd/mint-cookie/main.go
    '';
    subPackages = [ "cmd/mint-cookie" ];
    doCheck = false;
    doInstallCheck = false;
    meta = old.meta // {
      mainProgram = "mint-cookie";
    };
  });

  # The vpn stack's reconcile with the edge's node serve entry, through
  # Funnel and not, and without it (the off switch), with the machine's
  # Tailscale Service beside it, against a tailscale that keeps a serve
  # config as tailscaled does (./tests/fake-tailscale.py).
  fakeTailscale = pkgs.writeShellScript "tailscale" ''
    exec ${pkgs.python3}/bin/python3 -I ${./tests/fake-tailscale.py} "$@"
  '';
  reconcile =
    nodeServe:
    pkgs.writeShellScript "reconcile"
      (import ../vpn/services-reconcile.nix {
        inherit lib pkgs;
        cfg = {
          enable = true;
          inherit (serverEval.config.my.stacks.vpn) services;
          inherit nodeServe;
        };
        tailscale = fakeTailscale;
        stateDir = "/tmp/fake-tailscale/state";
      }).script;
  # The entry exactly as the edge contributes it (on the machine under test),
  # tailnet only, and with Funnel switched on.
  serverEval = evalServer [ ];
  edgeEntry = serverEval.config.my.stacks.vpn.nodeServe.mcp-edge;
  inherit (serverEval.config.my.stacks.mcp-edge) publicPaths;
  reconcileTailnet = reconcile { mcp-edge = edgeEntry; };
  reconcileFunnel = reconcile {
    mcp-edge = edgeEntry // {
      funnel = true;
    };
  };
  reconcileOff = reconcile { };

  # bcrypt of "password" (Dex's own example hash).
  passwordHash = "$2a$10$2b2cU8CPhOTaGrs1HRQuAueS7JTT5ZHsHSzYiFPm1leZck7Mc8T4W";

  # The machine under test; also evaluated below with other redirects.
  serverModule =
    { config, lib, ... }:
    {
      imports = [
        ../../options
        ../../nixos/system/services.nix
        ../kb/default.nix
        ../kb/nixos.nix
        ../vpn/default.nix
        ./default.nix
      ];
      options.my.stacks.t3-code.enable = lib.mkEnableOption "T3 Code";

      config = {
        virtualisation = {
          memorySize = 4096;
          cores = 4;
          diskSize = 4096;
        };
        my = {
          hostname = "server";
          people = [ "owner" ];
          # No tailnet in the VM: app-kb stays unpublished, and its
          # Service is declared only for the origin kb ui is told.
          stacks.vpn = {
            tailnetDomain = "example.ts.net";
            services.kb-owner.target = "unix:/run/kb-owner/kb.sock";
          };
          services.kb.expose = lib.mkForce false;
          stacks.kb = {
            enable = true;
            stores.kb = {
              owner = "owner";
              remoteMcp = {
                enable = true;
                emails = [ "owner@example.com" ];
              };
            };
          };
          stacks.mcp-edge = {
            enable = true;
            inherit host;
            clients = {
              gemini.redirectUris = [ geminiRedirect ];
              claude.redirectUris = [ claudeRedirect ];
            };
            upstream = {
              provider = "oidc";
              issuer = dexIssuer;
            };
          };
        };
        users.users.owner = {
          isNormalUser = true;
          uid = 1000;
        };

        # The owner's one-time step, done: the "Google" client.
        systemd.tmpfiles.rules = [
          "d /var/lib/mcp-edge/secrets 0700 root root -"
          "f /var/lib/mcp-edge/secrets/google-client-id 0600 root root - keycloak"
          "f /var/lib/mcp-edge/secrets/google-client-secret 0600 root root - ${mockGoogleSecret}"
        ];

        # The stand-in for Google.
        services.dex = {
          enable = true;
          settings = {
            issuer = dexIssuer;
            storage.type = "memory";
            web.http = "127.0.0.1:5556";
            enablePasswordDB = true;
            oauth2.skipApprovalScreen = true;
            staticClients = [
              {
                id = "keycloak";
                name = "Keycloak";
                secret = mockGoogleSecret;
                redirectURIs = [ "https://${host}/realms/${edge.realm}/broker/${edge.idpAlias}/endpoint" ];
              }
            ];
            staticPasswords = [
              {
                email = "owner@example.com";
                hash = passwordHash;
                username = "owner";
                userID = "00000000-0000-0000-0000-000000000001";
              }
              {
                email = "intruder@example.com";
                hash = passwordHash;
                username = "intruder";
                userID = "00000000-0000-0000-0000-000000000002";
              }
            ];
          };
        };

        # The stand-in for tailscaled: TLS for the public name, every path
        # forwarded as sent to the one target, the front.
        networking.hosts."127.0.0.1" = [ host ];
        services.nginx.virtualHosts.tailscaled-standin = {
          serverName = host;
          onlySSL = true;
          sslCertificate = "${cert}/cert.pem";
          sslCertificateKey = "${cert}/key.pem";
          listen = [
            {
              addr = "127.0.0.1";
              port = 443;
              ssl = true;
            }
          ];
          locations."/".extraConfig = ''
            proxy_pass ${config.my.stacks.mcp-edge.frontOrigin};
            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-For $remote_addr;
            proxy_buffering off;
            # tailscaled sets no body limit and streams the body on: the
            # front's limit and buffering are the ones tested.
            client_max_body_size 0;
            proxy_request_buffering off;
          '';
        };

        # A host abstract socket kb-remote's sandbox must not reach.
        systemd.services.abstract-probe-listener = {
          wantedBy = [ "multi-user.target" ];
          before = [ "kb-remote-sandbox-check.service" ];
          serviceConfig.ExecStart = "${pkgs.socat}/bin/socat ABSTRACT-LISTEN:kb-remote-sandbox-probe,fork EXEC:${pkgs.coreutils}/bin/cat";
        };

        environment.systemPackages = [
          edgeTest
          mintCookie
          pkgs.acl
          pkgs.curl
          pkgs.inotify-tools
          pkgs.jq
          pkgs.socat
          pkgs.kb
          config.services.postgresql.package
        ];
      };
    };

  # The machine under test, evaluated outside the VM, with extra modules.
  evalServer =
    modules:
    pkgs.nixos {
      imports = [
        serverModule
        (pkgs.path + "/nixos/modules/virtualisation/qemu-vm.nix")
        { system.stateVersion = lib.trivial.release; }
      ]
      ++ modules;
    };

  # The failing redirect assertions of the machine under test, with gemini's
  # redirects replaced: a `*` must fail evaluation, the exact ones must not.
  redirectFailures =
    redirectUris:
    let
      system = evalServer [
        { my.stacks.mcp-edge.clients.gemini.redirectUris = lib.mkForce redirectUris; }
      ];
    in
    map (a: a.message) (
      lib.filter (
        a: !a.assertion && lib.hasInfix "redirectUris must be exact" a.message
      ) system.config.assertions
    );
in
pkgs.testers.runNixOSTest {
  name = "mcp-edge";
  # `funnel`: the same machine with mcpFunnel on, which changes only the
  # front's nginx (the VM runs no tailscaled).
  nodes.server = {
    imports = [ serverModule ];
    specialisation.funnel.configuration.my.stacks.mcp-edge.funnel = true;
  };

  testScript = ''
    import json, re, shlex

    HOST = "${host}"
    BASE = f"https://{HOST}"
    ISSUER = f"{BASE}/realms/${edge.realm}"
    RESOURCE = f"{BASE}/mcp"
    GEMINI = "${geminiRedirect}"
    CLAUDE = "${claudeRedirect}"
    ROOT = "/home/owner/.local/share/kb/home"

    def run_json(cmd):
        status, out = server.execute(cmd)
        return status, json.loads(out.strip().splitlines()[-1])

    def signin(client, email, redirect, *flags):
        return run_json(f"edge-test signin {client} {email} --redirect {redirect} " + " ".join(flags))

    def mcp(token=None, cookie=None, base=None, method="tools/list", params=None):
        cmd = "edge-test mcp --method " + method
        if token:
            cmd += f" --token '{token}'"
        if cookie:
            cmd += f" --cookie '{cookie}'"
        if base:
            cmd += f" --base {base}"
        if params:
            cmd += " --params '" + json.dumps(params) + "'"
        return run_json(cmd)[1]

    def claims(token):
        return run_json(f"edge-test claims '{token}'")[1]

    def forge(variant):
        return server.succeed(f"edge-test forge {variant}").strip()

    def path_status(path):
        return int(server.succeed(f"edge-test status '{path}'").strip())

    def app_kb(text):
        body = json.dumps({"id": "node.add", "input": {"text": text}})
        out = server.succeed(
            "curl -sf --unix-socket /run/kb-owner/kb.sock -H 'Host: kb-owner.example.ts.net' "
            f"-H 'Content-Type: application/json' -d '{body}' http://kb/api/action"
        )
        assert json.loads(out)["status"] == "succeeded", out

    def refresh(client, token):
        return run_json(f"edge-test refresh {client} '{token}'")

    def admin(method, path, body=None):
        cmd = f"edge-test admin {method} '{path}'"
        if body is not None:
            cmd += " --json '" + json.dumps(body) + "'"
        return run_json(cmd)

    def kids():
        return set(json.loads(server.succeed("edge-test kids")))

    def lifetime(token):
        c = claims(token)["claims"]
        return c["exp"] - c["iat"]

    def oauth2_proxy_pid():
        return server.succeed("systemctl show mcp-edge-oauth2-proxy -p MainPID --value").strip()

    def wait_edge_up():
        # Polled: between runs the units pass through failed and inactive
        # with no job queued, which wait_for_unit takes as final.
        server.wait_until_succeeds("systemctl is-active keycloak mcp-edge-realm mcp-edge-oauth2-proxy", timeout=300)
        for port in [${toString edge.ports.keycloak}, ${toString edge.ports.oauth2Proxy}]:
            server.wait_for_open_port(port)

    def remote(token, tool, text):
        out = mcp(token=token, method="tools/call", params={"name": tool, "arguments": {"text": text}})
        assert out["status"] == 200 and not out["answer"]["result"].get("isError"), out
        return out["answer"]["result"]["content"][0]["text"]

    with subtest("redirects: a `*` fails evaluation, exact ones pass"):
        wildcard = json.loads(r"""${
          builtins.toJSON (redirectFailures [ "https://oauth-redirect.googleusercontent.com/r/*" ])
        }""")
        exact = json.loads(r"""${builtins.toJSON (redirectFailures [ geminiRedirect ])}""")
        assert len(wildcard) == 1 and "/r/*" in wildcard[0], wildcard
        assert exact == [], exact

    start_all()
    server.wait_for_unit("multi-user.target")
    for unit in ["dex", "keycloak", "mcp-edge-oauth2-proxy", "nginx", "app-kb", "kb-remote"]:
        server.wait_for_unit(f"{unit}.service")
    for port in [443, ${toString edge.ports.front}, ${toString edge.ports.oauth2Proxy}, ${toString edge.ports.keycloak}]:
        server.wait_for_open_port(port)
    server.wait_until_succeeds("test -S ${edge.socket}")

    with subtest("tailnet only: nothing listens beyond loopback"):
        listeners = server.succeed("ss -ltnH | awk '{print $4}'").split()
        loopback = ("127.", "[::1]:", "[::ffff:127.")
        beyond = [l for l in listeners if not l.startswith(loopback)]
        assert beyond == [], f"listening beyond loopback: {beyond}"
        # Keycloak's admin API answers on loopback only (the front never routes
        # it), and only with the admin client's token.
        assert server.succeed(
            "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${toString edge.ports.keycloak}/admin/realms"
        ) == "401"

    with subtest("discovery: PRM and AS metadata describe the realm, code + S256 only"):
        prm = json.loads(server.succeed(f"curl -sf --cacert ${cert}/cert.pem {BASE}/.well-known/oauth-protected-resource/mcp"))
        assert prm["resource"] == RESOURCE and prm["authorization_servers"] == [ISSUER], prm
        meta = json.loads(server.succeed(f"curl -sf --cacert ${cert}/cert.pem {BASE}/.well-known/oauth-authorization-server"))
        assert meta["issuer"] == ISSUER and meta["code_challenge_methods_supported"] == ["S256"], meta
        assert "registration_endpoint" not in meta and "device_authorization_endpoint" not in meta, meta

    with subtest("B4: every path outside the allow-list is 404"):
        outside = [
            "/", "/index.html", "/mcp/", "/mcp/x", "//admin/",
            "/oauth2/sign_in", "/oauth2/start", "/oauth2/callback", "/oauth2/auth", "/oauth2/userinfo",
            "/oauth2/sign_out", "/ping", "/ready", "/metrics",
            "/admin", "/admin/", "/admin/master/console/", "/admin/realms/kb",
            "/realms/master", "/realms/master/protocol/openid-connect/auth",
            "/realms/kb", "/realms/kb/account", "/realms/kb/account/",
            "/realms/kb/protocol/openid-connect/userinfo",
            "/realms/kb/protocol/openid-connect/auth/device",
            "/realms/kb/device",
            "/realms/kb/protocol/openid-connect/token/introspect",
            "/realms/kb/protocol/openid-connect/revoke",
            "/realms/kb/protocol/openid-connect/logout",
            "/realms/kb/protocol/openid-connect/ext/ciba/auth",
            "/realms/kb/clients-registrations/openid-connect",
            "/realms/kb/clients-registrations/default",
            "/realms/kb/.well-known/uma2-configuration",
            "/realms/kb/broker/google/token",
            "/health", "/health/ready", "/health/live",
        ]
        wrong = {p: s for p in outside if (s := path_status(p)) != 404}
        assert wrong == {}, f"reachable outside the allow-list: {wrong}"
        # Spellings that climb out of a routed prefix: nginx resolves them
        # first, and one that climbs above / is refused outright (400).
        traversal = [
            "/resources/../admin/", "/resources/..%2F..%2Fadmin/",
            "/resources/..%2Fadmin%2F", "/realms/kb/login-actions/../account",
            "/realms/kb/login-actions/..%2F..%2F..%2Fadmin%2Frealms",
            "/realms/kb/login-actions/%2e%2e/%2e%2e/master/protocol/openid-connect/auth",
        ]
        wrong = {p: s for p in traversal if (s := path_status(p)) not in (400, 404)}
        assert wrong == {}, f"a traversal reached a backend: {wrong}"

    with subtest("unauthenticated /mcp: 401 that points at the PRM"):
        out = mcp()
        assert out["status"] == 401, out
        assert "resource_metadata=" in (out["www_authenticate"] or ""), out

    with subtest("phishing: a sign-in started as gemini, redeemed with a wrong secret, gets no token"):
        status, out = signin("gemini", "owner@example.com", GEMINI, "--secret wrong")
        assert status != 0 and "access_token" not in out and out["status"] == 401, out
        assert out.get("error") == "unauthorized_client" or out.get("error") == "invalid_client", out
        status, out = signin("gemini", "owner@example.com", GEMINI, "--secret none")
        assert status != 0 and "access_token" not in out, out

    with subtest("code + S256 PKCE only; no implicit, password or client-credentials grant"):
        for flags in [
            "--pkce none", "--pkce plain",
            "--response-type token", "--response-type id_token",
            "--response-type 'id_token token'", "--response-type 'code id_token'",
        ]:
            status, out = signin("gemini", "owner@example.com", GEMINI, flags)
            assert status != 0 and "access_token" not in out and "id_token" not in out, (flags, out)
            # Refused by the authorization endpoint itself, and the redirect
            # (query and fragment) carries no code and no token.
            auth = out["authorize"]
            location = auth.get("location", "")
            assert "error" in auth and "code" not in auth, (flags, out)
            assert "access_token" not in auth and "id_token" not in auth, (flags, out)
            assert "access_token=" not in location and "id_token=" not in location and "code=" not in location, (flags, out)
        status, out = signin("gemini", "owner@example.com", GEMINI, "--no-verifier")
        assert status != 0 and "access_token" not in out, out
        for grant in ["password", "client_credentials"]:
            out = run_json(f"edge-test grant gemini {grant}")[1]
            assert "access_token" not in out and out["status"] in (400, 401), (grant, out)

    with subtest("no offline_access: asking for it gets no token at all"):
        status, out = signin("gemini", "owner@example.com", GEMINI, "--scope 'openid email offline_access'")
        assert status != 0 and "access_token" not in out and "refresh_token" not in out, out
        assert out["authorize"].get("error") == "invalid_scope", out

    with subtest("an unregistered redirect is refused, and Keycloak logs it"):
        status, out = signin("gemini", "owner@example.com", "https://oauth-redirect.googleusercontent.com/r/someone-else")
        assert status != 0 and "Invalid parameter: redirect_uri" in out["authorize"].get("body", ""), out
        server.wait_until_succeeds(
            "journalctl -u keycloak -o cat | grep -F invalid_redirect_uri"
            " | grep -qF 'redirect_uri=\"https://oauth-redirect.googleusercontent.com/r/someone-else\"'",
            timeout=30,
        )

    with subtest("B3: the owner signs in; only the access token names the resource"):
        status, owner = signin("gemini", "owner@example.com", GEMINI)
        assert status == 0, owner
        access, ident = claims(owner["access_token"])["claims"], claims(owner["id_token"])["claims"]
        aud = access["aud"] if isinstance(access["aud"], list) else [access["aud"]]
        assert RESOURCE in aud and access["iss"] == ISSUER and access["azp"] == "gemini", access
        assert access["email"] == "owner@example.com" and access["email_verified"] is True, access
        id_aud = ident["aud"] if isinstance(ident["aud"], list) else [ident["aud"]]
        assert RESOURCE not in id_aud and "gemini" in id_aud, ident
        out = mcp(token=owner["access_token"])
        assert out["status"] == 200, out
        names = [t["name"] for t in out["answer"]["result"]["tools"]]
        assert "node_add" in names and "graph_search" in names, out
        status, claude = signin("claude", "owner@example.com", CLAUDE)
        assert status == 0, claude
        assert mcp(token=claude["access_token"])["status"] == 200

    with subtest("B3: refused at /mcp"):
        refused = {
            "ID token": owner["id_token"],
            "client-id audience": forge("client-aud"),
            "foreign audience": forge("foreign-aud"),
            "foreign signing key": forge("foreign-key"),
            "foreign issuer": forge("foreign-issuer"),
            "expired": forge("expired"),
            "unverified email": forge("unverified-email"),
        }
        let_through = {k: s for k, t in refused.items() if (s := mcp(token=t)["status"]) not in (401, 403)}
        assert let_through == {}, let_through
        # The forger's own control: right in every claim, it passes, so each
        # refusal above is its one wrong claim.
        assert mcp(token=forge("control"))["status"] == 200
        assert mcp(token=forge("other-email"))["status"] == 403

    with subtest("a second identity: signed in fine, 403 at /mcp"):
        status, intruder = signin("gemini", "intruder@example.com", GEMINI)
        assert status == 0, intruder
        assert claims(intruder["access_token"])["claims"]["email"] == "intruder@example.com"
        assert mcp(token=intruder["access_token"])["status"] == 403

    with subtest("B3: an oauth2-proxy session cookie is refused"):
        cookie = server.succeed(
            "mint-cookie /run/mcp-edge-oauth2-proxy/cookie-secret owner@example.com | head -n 1"
        ).strip()
        # Genuine: oauth2-proxy itself takes it, when reached directly…
        assert mcp(cookie=cookie, base="http://127.0.0.1:${toString edge.ports.oauth2Proxy}")["status"] == 200
        # …and the front never passes it on.
        assert mcp(cookie=cookie)["status"] == 401

    with subtest("B1: kb-edge's socket admits no process of the owner's"):
        server.succeed("test \"$(stat -c '%U %G %a' ${edge.socket})\" = 'kb-edge kb-edge 600'")
        server.succeed("test \"$(stat -c '%U %G %a' ${edge.socketDir})\" = 'kb-edge kb-edge 700'")
        server.fail("runuser -u owner -- socat -u /dev/null UNIX-CONNECT:${edge.socket}")
        init = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "probe", "version": "0"}}})
        server.succeed(
            f"runuser -u kb-edge -- curl -sf --unix-socket ${edge.socket} -H 'Content-Type: application/json' "
            f"-H 'Accept: application/json, text/event-stream' -d '{init}' http://localhost/mcp"
        )

    with subtest("B1: app-kb and kb-remote interleave writes on the shared store"):
        token = owner["access_token"]
        app_kb("interleave-app-1")
        remote(token, "node_add", "interleave-remote-1")
        app_kb("interleave-app-2")
        remote(token, "node_add", "interleave-remote-2")
        graph = server.succeed(
            "curl -sf --unix-socket /run/kb-owner/kb.sock -H 'Host: kb-owner.example.ts.net' http://kb/api/graph"
        )
        for text in ["interleave-remote-1", "interleave-remote-2", "interleave-app-1", "interleave-app-2"]:
            assert text in graph, f"app-kb does not see {text}"
        found = remote(token, "graph_search", "interleave-app")
        assert "interleave-app-1" in found and "interleave-app-2" in found, found
        # kb records where each remote write came from.
        changes = mcp(token=token, method="tools/call", params={"name": "graph_changes", "arguments": {"since": 0, "viaPrefix": "mcp-remote"}})
        text = changes["answer"]["result"]["content"][0]["text"]
        assert "interleave-remote-1" in text and "interleave-app-1" not in text, text
        out = run_json(f"edge-test acl {ROOT} owner kb-edge")[1]
        assert out["problems"] == [], out
        server.succeed(f"runuser -u owner -- kb --root {ROOT} search interleave-remote-2 | grep -q interleave-remote-2")

    with subtest("/mcp takes kb's largest asset, and a larger body is 413"):
        status, up = signin("claude", "owner@example.com", CLAUDE)
        assert status == 0, up
        # 25 MiB, kb's limit: about 33.3 MiB of base64 in the call.
        out = run_json(f"edge-test upload '{up['access_token']}' {25 * 1024 * 1024}")[1]
        assert out["status"] == 200 and not out["isError"], out
        # 26 MiB: about 34.7 MiB of base64, over kb's limit (and the front's).
        out = run_json(f"edge-test upload '{up['access_token']}' {26 * 1024 * 1024}")[1]
        # Refused by the front (nginx's own page), before oauth2-proxy or kb.
        assert out["status"] == 413 and "413 Request Entity Too Large" in out["body"], out

    with subtest("/mcp never spools a body to disk; the sign-in routes take only small ones"):
        # nginx's client-body temp directory, in its private /tmp, watched
        # for any file nginx creates there.
        spool = server.succeed("ls -d /tmp/systemd-private-*-nginx.service-*/tmp/nginx_client_body").strip()
        server.succeed(f"systemd-run --unit spool-watch inotifywait -m -r -e create --format 'spooled %w%f' {spool}")
        server.wait_until_succeeds("journalctl -u spool-watch -o cat | grep -q 'Watches established'")
        def spooled():
            return [l for l in server.succeed("journalctl -u spool-watch -o cat").splitlines() if l.startswith("spooled ")]
        # Control: a 48 KiB POST to Keycloak's token route outgrows nginx's
        # 16 KiB buffer and is spooled, so the watch sees spooling.
        out = run_json("edge-test post ${"/realms/${edge.realm}"}/protocol/openid-connect/token 49152")[1]
        server.wait_until_succeeds("journalctl -u spool-watch -o cat | grep -q '^spooled '", timeout=10)
        before = len(spooled())
        # A near-limit body with no token: refused, and nothing written.
        out = run_json(f"edge-test post /mcp {33 * 1024 * 1024}")[1]
        assert out["status"] in (401, 0), out
        assert out["status"] == 0 or "invalid_token" in out["body"], out
        # An authenticated near-limit upload streams through as well.
        status, up = signin("claude", "owner@example.com", CLAUDE)
        assert status == 0, up
        out = run_json(f"edge-test upload '{up['access_token']}' {25 * 1024 * 1024}")[1]
        assert out["status"] == 200 and not out["isError"], out
        assert len(spooled()) == before, spooled()
        # The sign-in routes refuse a body over 64 KiB outright.
        out = run_json("edge-test post ${"/realms/${edge.realm}"}/protocol/openid-connect/token 1048576")[1]
        assert out["status"] == 413, out
        server.succeed("systemctl stop spool-watch")

    with subtest("B2: kb-remote's sandbox, probed from inside it"):
        server.wait_until_succeeds("ss -xlH | grep -q '@kb-remote-sandbox-probe'")
        # The probe reaches the abstract socket from the host…
        server.succeed("runuser -u kb-edge -- socat -u /dev/null ABSTRACT-CONNECT:kb-remote-sandbox-probe")
        # …and not from inside the unit.
        server.succeed("systemctl start kb-remote-sandbox-check")
        probe_log = server.succeed("journalctl -u kb-remote-sandbox-check -b --no-pager -o cat")
        print(probe_log)
        assert "FAIL" not in probe_log, probe_log
        assert "ok: no TCP, UDP, netlink or abstract sockets" in probe_log, probe_log
        # The same probes outside the sandbox fail: they have teeth.
        execstart = server.succeed("systemctl show kb-remote-sandbox-check -p ExecStart --value")
        found = re.search(r"path=(\S+)", execstart)
        assert found is not None, execstart
        server.fail(f"runuser -u kb-edge -- {found.group(1)}")

    with subtest("B1: kb-remote and oauth2-proxy share a user, and neither sees the other's processes"):
        def main_pid(unit):
            return server.succeed(f"systemctl show {unit} -p MainPID --value").strip()
        kb_pid, proxy_pid = main_pid("kb-remote"), main_pid("mcp-edge-oauth2-proxy")
        # The threat: on the host's /proc, one kb-edge process opens the
        # other's mount view.
        server.succeed(f"runuser -u kb-edge -- ls /proc/{proxy_pid}/root/ > /dev/null")
        server.succeed(f"runuser -u kb-edge -- ls /proc/{kb_pid}/root/ > /dev/null")
        def inside(pid, cmd):
            # As kb-edge, in the unit's PID and mount namespaces; only the Nix
            # store is there, so every tool by its store path.
            return (f"nsenter --target {pid} --pid --mount --setuid $(id -u kb-edge) --setgid $(id -g kb-edge) -- "
                    f"${pkgs.bash}/bin/bash -c '{cmd}'")
        names = "for f in /proc/[0-9]*/comm; do read -r c < $f && echo $c; done"
        for unit_pid, other_pid, other in [(kb_pid, proxy_pid, "oauth2-proxy"), (proxy_pid, kb_pid, "kb")]:
            seen = server.succeed(inside(unit_pid, names)).split()
            assert seen != [] and other not in seen and "systemd" not in seen, (unit_pid, seen)
            server.succeed(inside(unit_pid, "${pkgs.coreutils}/bin/ls /proc/1/root/ > /dev/null"))
            server.fail(inside(unit_pid, f"${pkgs.coreutils}/bin/ls /proc/{other_pid}/root/"))
        # PID 1 in its namespace still stops on SIGTERM, without waiting out
        # the stop timeout.
        server.succeed("timeout 30 systemctl restart kb-remote")
        server.succeed("timeout 30 systemctl restart mcp-edge-oauth2-proxy")
        assert server.succeed("systemctl is-failed kb-remote mcp-edge-oauth2-proxy || true").split() == ["active", "active"]
        server.wait_until_succeeds("test -S ${edge.socket}")
        server.wait_for_open_port(${toString edge.ports.oauth2Proxy})
        # …and the proxy, in its own namespace, still reaches kb's socket.
        status, again = signin("claude", "owner@example.com", CLAUDE)
        assert status == 0, again
        assert mcp(token=again["access_token"])["status"] == 200
        server.wait_for_unit("kb-remote.service")
        server.wait_until_succeeds("test -S ${edge.socket}")

    with subtest("tailnet and Funnel: tailscaled mounts the allow-list's paths and nothing else; Funnel only on exactly them"):
        FRONT = "http://127.0.0.1:${toString edge.ports.front}"
        TS = "/tmp/fake-tailscale"
        HP = "server.example.ts.net:443"
        paths = json.loads(r"""${builtins.toJSON publicPaths}""")
        assert "/mcp" in paths and len(paths) == len(set(paths)) == 18, paths

        def fresh(seed=None):
            server.succeed(f"rm -rf {TS} && mkdir -p {TS}")
            if seed:
                server.succeed(f"echo '{json.dumps(seed)}' > {TS}/serve.json")

        def run(script, ok=True):
            server.succeed(f"rm -f {TS}/calls")
            status, out = server.execute(f"{script} 2>&1")
            assert (status == 0) == ok, (status, out)
            return out

        def calls():
            return server.succeed(f"cat {TS}/calls").splitlines()

        def state():
            return json.loads(server.succeed(f"cat {TS}/serve.json 2>/dev/null || echo '{{}}'"))

        def mounts(sc, hp=HP):
            return {p: h.get("Proxy") for p, h in sc.get("Web", {}).get(hp, {}).get("Handlers", {}).items()}

        def public(sc):
            return sorted(k for k, v in sc.get("AllowFunnel", {}).items() if v)

        def mounted(path, table):
            # tailscaled's own lookup (ipn/ipnlocal/serve.go getServeHandler):
            # the path itself, then each parent, with and without a slash.
            if path in table:
                return path
            p = "/" + "/".join(s for s in path.split("/") if s)
            while True:
                if p.rstrip("/") + "/" in table:
                    return p.rstrip("/") + "/"
                if p in table:
                    return p
                if p == "/":
                    return None
                p = p.rsplit("/", 1)[0] or "/"

        expected = {p: FRONT + p for p in paths}
        # The front routes every one of them (the same table, ./routes.nix).
        found_conf = re.search(r"-c (\S+)", server.succeed("systemctl show nginx -p ExecStart --value"))
        assert found_conf is not None
        nginx_conf = server.succeed(f"cat {found_conf.group(1)}")
        unrouted = [p for p in paths if f"location = {p} " not in nginx_conf and f"location ^~ {p} " not in nginx_conf]
        assert unrouted == [], unrouted

        never = [
            "/", "/index.html", "//admin/", "/admin", "/admin/", "/admin/master/console/", "/admin/realms/kb",
            "/oauth2/sign_in", "/oauth2/start", "/oauth2/callback", "/oauth2/auth", "/oauth2/userinfo",
            "/oauth2/sign_out", "/ping", "/ready", "/metrics", "/health", "/health/ready",
            "/realms/master", "/realms/master/protocol/openid-connect/auth", "/realms/master/.well-known/openid-configuration",
            "/realms/kb", "/realms/kb/account", "/realms/kb/account/", "/realms/kb/device",
            "/realms/kb/protocol/openid-connect/userinfo", "/realms/kb/protocol/openid-connect/logout",
            "/realms/kb/protocol/openid-connect/revoke", "/realms/kb/protocol/openid-connect/ext/ciba/auth",
            "/realms/kb/clients-registrations/openid-connect", "/realms/kb/.well-known/uma2-configuration",
            "/realms/kb/broker/google/token", "/realms/kb/protocol/saml",
        ]

        # Tailnet only: the allow-list mounted, no `/`, no Funnel.
        fresh()
        run("${reconcileTailnet}")
        sc = state()
        assert mounts(sc) == expected and public(sc) == [], sc
        assert list(sc["Web"]) == [HP] and list(sc["TCP"]) == ["443"], sc
        reached = {p: m for p in never if (m := mounted(p, expected))}
        assert reached == {}, reached

        # Funnel on: exactly the same mounts, now public.
        run("${reconcileFunnel}")
        sc = state()
        assert mounts(sc) == expected and public(sc) == [HP], sc

        # Funnel off while a Service command fails: Funnel is withdrawn
        # before the Services are touched, so the failure leaves it off.
        server.succeed(f"touch {TS}/fail-services")
        out = run("${reconcileTailnet}", ok=False)
        assert public(state()) == [], (state(), out)
        first_service = min(i for i, c in enumerate(calls()) if "svc:" in c)
        assert calls().index("serve --yes --https=443 off") < first_service, calls()
        server.succeed(f"rm {TS}/fail-services")
        run("${reconcileTailnet}")
        sc = state()
        assert mounts(sc) == expected and public(sc) == [], sc

        # A mount added by hand to the edge's public port: the next run
        # withdraws the port and sets exactly the declared mounts again.
        run("${reconcileFunnel}")
        server.succeed(
            f"""jq '.Web["{HP}"].Handlers["/"] = {{"Proxy": "http://127.0.0.1:8000"}}' {TS}/serve.json > {TS}/x && mv {TS}/x {TS}/serve.json"""
        )
        run("${reconcileFunnel}")
        sc = state()
        assert mounts(sc) == expected and public(sc) == [HP], sc

        # The edge off: nothing of it is left, and no Funnel anywhere.
        run("${reconcileOff}")
        sc = state()
        assert mounts(sc) == {} and public(sc) == [] and "svc:kb-owner" in sc["Services"], sc

        # An adhoc share already on :443 (`adhoc 8000`): neither switch takes
        # the port over; the share stays as it was, and nothing goes public.
        adhoc = {"TCP": {"443": {"HTTPS": True}}, "Web": {HP: {"Handlers": {"/": {"Proxy": "http://127.0.0.1:8000"}}}}}
        for script in ["${reconcileFunnel}", "${reconcileTailnet}"]:
            fresh(adhoc)
            out = run(script, ok=False)
            assert "HTTPS port 443 is already served" in out and "/ http://127.0.0.1:8000" in out, out
            assert "sudo tailscale serve --https=443 off" in out, out
            assert state() == {**adhoc, "Services": state()["Services"]}, state()
            node = [c for c in calls() if "svc:" not in c]
            assert not any(c.startswith("funnel") or "--https=443" in c for c in node), node

        # Something else mounts a path on the port while the reconcile sets
        # it: the port does not serve exactly the declared mounts, so Funnel
        # stays off and the port is taken down.
        fresh()
        server.succeed(f"echo '/sneaky http://127.0.0.1:8000' > {TS}/inject-mount")
        out = run("${reconcileFunnel}", ok=False)
        assert "not turning Funnel on" in out and "/sneaky http://127.0.0.1:8000" in out, out
        assert public(state()) == [] and mounts(state()) == {}, state()
        assert not any(c.startswith("funnel") for c in calls()), calls()
        server.succeed(f"rm {TS}/inject-mount")

        # Funnel set by hand on a port the edge does not manage: a warning,
        # not a change (turning it off would drop that port's mounts too).
        hp8443 = "server.example.ts.net:8443"
        stray = {"TCP": {"8443": {"HTTPS": True}}, "Web": {hp8443: {"Handlers": {"/": {"Proxy": "http://127.0.0.1:8000"}}}}, "AllowFunnel": {hp8443: True}}
        fresh(stray)
        out = run("${reconcileFunnel}")
        assert "Funnel is on for HTTPS port 8443, which this configuration does not manage" in out, out
        sc = state()
        assert mounts(sc, hp8443) == {"/": "http://127.0.0.1:8000"} and public(sc) == sorted([HP, hp8443]), sc
        assert mounts(sc) == expected, sc
        assert not any("--https=8443" in c for c in calls()), calls()

    with subtest("B5: oauth2-proxy reaches loopback and nothing else"):
        deny = server.succeed("systemctl show mcp-edge-oauth2-proxy -p IPAddressDeny --value").split()
        allow = server.succeed("systemctl show mcp-edge-oauth2-proxy -p IPAddressAllow --value").split()
        assert sorted(deny) == ["0.0.0.0/0", "::/0"], deny
        assert sorted(allow) == ["127.0.0.0/8", "::1/128"], allow
        # A listener on the machine's own LAN address: reachable from the
        # host, refused from inside oauth2-proxy's cgroup, where loopback
        # (Keycloak) still answers.
        ip = server.succeed("ip -4 -o addr show dev eth1 | awk '{print $4}' | cut -d/ -f1").strip()
        assert ip and not ip.startswith("127."), ip
        server.succeed(f"systemd-run --unit egress-target ${pkgs.socat}/bin/socat TCP-LISTEN:8099,bind={ip},fork,reuseaddr EXEC:${pkgs.coreutils}/bin/true")
        server.wait_until_succeeds(f"socat -u /dev/null TCP:{ip}:8099,connect-timeout=2", timeout=30)
        cgroup = "/sys/fs/cgroup" + server.succeed("systemctl show mcp-edge-oauth2-proxy -p ControlGroup --value").strip()
        def from_proxy(target):
            return f"sh -c 'echo $$ > {cgroup}/cgroup.procs && exec socat -u /dev/null TCP:{target},connect-timeout=3'"
        server.fail(from_proxy(f"{ip}:8099"))
        server.succeed(from_proxy("127.0.0.1:${toString edge.ports.keycloak}"))
        server.succeed(f"socat -u /dev/null TCP:{ip}:8099,connect-timeout=2")
        server.succeed("systemctl stop egress-target")

    with subtest("B5: a Keycloak restart keeps every connector signed in; revoke-all signs them all out at once"):
        assert mcp(token=forge("wrong-iss"))["status"] in (401, 403)
        status, before = signin("gemini", "owner@example.com", GEMINI)
        assert status == 0, before
        assert mcp(token=before["access_token"])["status"] == 200
        old_kid = claims(before["access_token"])["header"]["kid"]
        pid = oauth2_proxy_pid()
        server.succeed("systemctl restart keycloak")
        wait_edge_up()
        # oauth2-proxy restarted with it (one Keycloak run, one oauth2-proxy
        # run)…
        assert oauth2_proxy_pid() != pid
        # …and the owner is still signed in: the token from before works, and
        # so does the connector's refresh, signed with the same key.
        assert mcp(token=before["access_token"])["status"] == 200, "a restart signed the owner out"
        status, again = refresh("gemini", before["refresh_token"])
        assert status == 0, again
        assert claims(again["access_token"])["header"]["kid"] == old_kid, "a restart rotated the keys"
        assert mcp(token=again["access_token"])["status"] == 200
        # revoke-all: every session over, the keys rotated, oauth2-proxy
        # restarted; an unexpired token is refused at once.
        out = server.succeed("mcp-edge-secrets revoke-all --yes 2>&1")
        assert "Every session ended" in out, out
        wait_edge_up()
        now = int(server.succeed("date +%s"))
        assert claims(again["access_token"])["claims"]["exp"] > now + 30, "the old token expired: the check proves nothing"
        assert mcp(token=again["access_token"])["status"] == 401, "a token from before revoke-all still works"
        status, gone = refresh("gemini", again["refresh_token"])
        assert status != 0, gone
        status, fresh = signin("gemini", "owner@example.com", GEMINI)
        assert status == 0, fresh
        assert claims(fresh["access_token"])["header"]["kid"] != old_kid, "revoke-all did not rotate the key"
        assert mcp(token=fresh["access_token"])["status"] == 200
        assert mcp(token=again["access_token"])["status"] == 401
        assert mcp(token=forge("wrong-iss"))["status"] in (401, 403)

    with subtest("revoke-all: a signing key imported by hand is revoked too"):
        hand = server.succeed("edge-test add-key").strip()
        assert hand in kids()
        status, before = signin("gemini", "owner@example.com", GEMINI)
        assert status == 0, before
        assert claims(before["access_token"])["header"]["kid"] == hand, "Keycloak did not sign with the key added by hand"
        assert mcp(token=before["access_token"])["status"] == 200
        out = server.succeed("mcp-edge-secrets revoke-all --yes 2>&1")
        assert "not generated by Keycloak" in out and "Every session ended" in out, out
        wait_edge_up()
        assert hand not in kids(), "the key added by hand survived revoke-all"
        assert mcp(token=before["access_token"])["status"] == 401, "a token signed with the key added by hand still works"
        status, fresh = signin("gemini", "owner@example.com", GEMINI)
        assert status == 0, fresh
        assert mcp(token=fresh["access_token"])["status"] == 200

    def proxy_state():
        return server.succeed(
            "systemctl show mcp-edge-oauth2-proxy -p MainPID -p InactiveEnterTimestampMonotonic --value"
        ).split()

    with subtest("broker lifetime: Keycloak crashes; oauth2-proxy stops and returns with it; the owner stays signed in"):
        status, before = signin("gemini", "owner@example.com", GEMINI)
        assert status == 0, before
        assert mcp(token=before["access_token"])["status"] == 200
        pid, inactive = proxy_state()
        server.succeed("systemctl kill -s KILL keycloak")
        # It went down with Keycloak…
        server.wait_until_succeeds(
            f"test \"$(systemctl show mcp-edge-oauth2-proxy -p InactiveEnterTimestampMonotonic --value)\" != {inactive}",
            timeout=60,
        )
        # …and is back with the restarted Keycloak, a new process.
        wait_edge_up()
        # Down at once, not when Keycloak's restart comes round 5 s later.
        def went_down(unit):
            return int(server.succeed(f"systemctl show {unit} -p InactiveEnterTimestampMonotonic --value"))
        gap = went_down("mcp-edge-oauth2-proxy") - went_down("keycloak")
        assert -1_000_000 < gap < 2_000_000, f"oauth2-proxy stopped {gap} µs after Keycloak died"
        assert proxy_state()[0] not in (pid, "0"), proxy_state()
        # The crash signed nobody out.
        assert mcp(token=before["access_token"])["status"] == 200, "a crash signed the owner out"
        status, again = refresh("gemini", before["refresh_token"])
        assert status == 0, again
        assert mcp(token=again["access_token"])["status"] == 200

    with subtest("broker lifetime: stop Keycloak, then start it; oauth2-proxy follows both"):
        status, before = signin("gemini", "owner@example.com", GEMINI)
        assert status == 0, before
        server.succeed("systemctl stop keycloak")
        server.succeed("! systemctl is-active mcp-edge-oauth2-proxy")
        server.succeed("! systemctl is-active mcp-edge-realm")
        server.succeed("systemctl start keycloak")
        wait_edge_up()
        assert mcp(token=before["access_token"])["status"] == 200, "a stop and start signed the owner out"
        status, fresh = signin("gemini", "owner@example.com", GEMINI)
        assert status == 0, fresh
        assert mcp(token=fresh["access_token"])["status"] == 200

    with subtest("the realm is Nix's: on the next start a client added by hand is gone, a changed redirect restored"):
        status, before = signin("claude", "owner@example.com", CLAUDE)
        assert status == 0, before
        status, out = admin("POST", "kb/clients", {"clientId": "handmade", "publicClient": True, "redirectUris": ["https://evil.example/*"]})
        assert status == 0 and out["status"] == 201, out
        status, out = admin("GET", "kb/clients?clientId=claude")
        assert status == 0, out
        claude = out["body"][0]
        claude["redirectUris"] = ["https://evil.example/cb"]
        status, out = admin("PUT", f"kb/clients/{claude['id']}", claude)
        assert status == 0, out
        # Tampered: Claude's real redirect is refused now.
        status, out = signin("claude", "owner@example.com", CLAUDE)
        assert status != 0, out
        server.succeed("systemctl restart keycloak")
        wait_edge_up()
        status, out = admin("GET", "kb/clients?clientId=handmade")
        assert status == 0 and out["body"] == [], out
        status, out = admin("GET", "kb/clients?clientId=claude")
        assert status == 0 and out["body"][0]["redirectUris"] == [CLAUDE], out
        status, fresh = signin("claude", "owner@example.com", CLAUDE)
        assert status == 0, fresh
        assert mcp(token=fresh["access_token"])["status"] == 200
        # Reconciling signed nobody out.
        assert mcp(token=before["access_token"])["status"] == 200

    with subtest("the realm is Nix's: a client's lifetime and a key added by hand are undone on the next start"):
        status, out = admin("GET", "kb/clients?clientId=gemini")
        assert status == 0, out
        gemini = out["body"][0]
        gemini["attributes"]["access.token.lifespan"] = "3600"
        status, out = admin("PUT", f"kb/clients/{gemini['id']}", gemini)
        assert status == 0, out
        hand = server.succeed("edge-test add-key").strip()
        status, drifted = signin("gemini", "owner@example.com", GEMINI)
        assert status == 0, drifted
        # Both took: an hour-long token, signed with the key added by hand.
        assert lifetime(drifted["access_token"]) == 3600, claims(drifted["access_token"])
        assert claims(drifted["access_token"])["header"]["kid"] == hand
        server.succeed("systemctl restart keycloak")
        wait_edge_up()
        status, fresh = signin("gemini", "owner@example.com", GEMINI)
        assert status == 0, fresh
        assert lifetime(fresh["access_token"]) == 300, claims(fresh["access_token"])
        assert hand not in kids(), "the key added by hand survived the reconcile"
        assert mcp(token=drifted["access_token"])["status"] == 401
        assert mcp(token=fresh["access_token"])["status"] == 200

    with subtest("until the realm has reconciled, every Keycloak route is 503; the admin API stays on loopback"):
        token_path = "/realms/kb/protocol/openid-connect/token"
        auth_path = "/realms/kb/protocol/openid-connect/auth"
        # The reconcile held (masked, so Keycloak's Upholds= cannot start it
        # again) while Keycloak runs: as after a start whose reconcile has
        # not finished, or failed.
        server.succeed("systemctl mask --runtime mcp-edge-realm && systemctl stop mcp-edge-realm")
        server.succeed("test ! -e ${edge.realmReady}")
        assert server.succeed("systemctl is-active keycloak").strip() == "active"
        closed = {p: path_status(p) for p in [auth_path, "/realms/kb/protocol/openid-connect/certs", "/resources/x"]}
        closed[token_path] = int(server.succeed(f"edge-test status '{token_path}' --method POST").strip())
        assert set(closed.values()) == {503}, closed
        # The static discovery documents stay; the admin API is still only
        # on loopback, and needs a token there.
        assert path_status("/.well-known/oauth-protected-resource/mcp") == 200
        assert path_status("/admin/realms/kb") == 404 and path_status("/realms/master/protocol/openid-connect/token") == 404
        assert server.succeed(
            "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${toString edge.ports.keycloak}/admin/realms"
        ) == "401"
        server.succeed("systemctl unmask --runtime mcp-edge-realm && systemctl start mcp-edge-realm")
        wait_edge_up()
        server.succeed("test -f ${edge.realmReady}")
        assert path_status(auth_path) != 503
        status, fresh = signin("gemini", "owner@example.com", GEMINI)
        assert status == 0, fresh

    with subtest("mcp-edge-secrets: the Google client from its prompts, never echoed; status, client, rotate"):
        SECRETS = "/var/lib/mcp-edge/secrets"
        GOOGLE_SECRET = "${mockGoogleSecret}"
        def read(name):
            return server.succeed(f"cat {SECRETS}/{name}")
        server.fail("runuser -u owner -- mcp-edge-secrets status")
        # The unit wrote its secrets whole and 0400, like the command.
        for name in ["client-gemini-secret", "client-claude-secret", "keycloak-admin-secret"]:
            assert server.succeed(f"stat -c '%a %U' {SECRETS}/{name}").strip() == "400 root", name
        # Nothing typed: refused, nothing changed.
        server.fail("printf '\\n' | mcp-edge-secrets google")
        assert read("google-client-id").strip() == "keycloak"
        # As the owner would type it, with stray spaces, then "yes, apply".
        server.succeed(
            f"printf '  keycloak  \\n  {GOOGLE_SECRET}  \\ny\\n' | mcp-edge-secrets google > /tmp/google.out 2> /tmp/google.err"
        )
        out, err = server.succeed("cat /tmp/google.out"), server.succeed("cat /tmp/google.err")
        assert GOOGLE_SECRET not in out and GOOGLE_SECRET not in err, (out, err)
        assert "Applied." in out and err.count("warning") == 2, (out, err)
        assert read("google-client-id") == "keycloak\n" and read("google-client-secret") == GOOGLE_SECRET + "\n"
        for name in ["google-client-id", "google-client-secret"]:
            assert server.succeed(f"stat -c '%a %U %G' {SECRETS}/{name}").strip() == "400 root root"
        assert server.succeed(f"stat -c '%a %U' {SECRETS}").strip() == "700 root"
        assert not server.succeed(f"find {SECRETS} -name '.*' -type f"), "a temporary file was left"
        wait_edge_up()
        status, fresh = signin("gemini", "owner@example.com", GEMINI)
        assert status == 0, fresh
        # status: every file, never a value.
        out = server.succeed("mcp-edge-secrets status 2>&1")
        values = [read(n).strip() for n in ["google-client-secret", "client-gemini-secret", "client-claude-secret", "keycloak-admin-secret"]]
        assert not any(v in out for v in values), out
        assert re.search(r"google-client-secret +400 root", out) and re.search(r"keycloak +active", out), out
        # client: the one value it prints, on stdout alone.
        status, printed = server.execute("mcp-edge-secrets client gemini 2>/dev/null")
        assert status == 0 and printed.strip() == read("client-gemini-secret").strip(), printed
        # rotate: a new secret, set in the realm; Claude signs in with it.
        # The live file is replaced by one rename, never removed or
        # rewritten in place.
        old = read("client-claude-secret")
        server.succeed(
            f"(inotifywait -m -q -e create,delete,close_write,moved_to,moved_from --format '%e %f' {SECRETS} > /tmp/inotify.log 2>&1 & echo $! > /tmp/inotify.pid)"
        )
        server.wait_until_succeeds("ps -p $(cat /tmp/inotify.pid) && sleep 1")
        server.succeed("mcp-edge-secrets rotate claude")
        server.succeed("kill $(cat /tmp/inotify.pid)")
        events = server.succeed("cat /tmp/inotify.log").splitlines()
        live = [e for e in events if e.split()[-1] == "client-claude-secret"]
        assert live == ["MOVED_TO client-claude-secret"], events
        assert read("client-claude-secret") != old
        # Killed at any point, it leaves one whole secret, old or new.
        for delay in ["0.005", "0.02", "0.05", "0.1", "0.2", "0.4"]:
            server.execute(f"timeout -s KILL {delay} mcp-edge-secrets rotate claude")
            assert re.fullmatch(r"[0-9a-f]{64}\n", read("client-claude-secret")), delay
            assert server.succeed(f"stat -c '%a %U' {SECRETS}/client-claude-secret").strip() == "400 root"
        # A generator that fails, or prints a short value, changes nothing:
        # not a rotation's file, not one the unit would generate. The fake
        # openssl is bind-mounted over the real one both of them run.
        openssl = server.succeed(
            "grep -o '/nix/store/[^:]*-openssl-[^:]*-bin/bin' $(readlink -f $(command -v mcp-edge-secrets)) | head -1"
        ).strip() + "/openssl"
        unit_path = server.succeed("systemctl show mcp-edge-secrets -p Environment --value")
        assert openssl.removesuffix("/openssl") in unit_path, (openssl, unit_path)
        fakes = {
            "fails after writing part": "printf 0123abcd; exit 1",
            "exits 0 with a short value": "printf '%063d' 0",
            "exits 0 with a value not hex": "printf '%064d' 0 | tr 0 z",
        }
        old = read("client-claude-secret")
        for what, body in fakes.items():
            server.succeed(f"printf '#!/bin/sh\\n%s\\n' {shlex.quote(body)} > /tmp/fake-openssl && chmod +x /tmp/fake-openssl")
            server.succeed(f"mount --bind /tmp/fake-openssl {openssl}")
            status, out = server.execute("mcp-edge-secrets rotate claude 2>&1")
            assert status != 0 and "unchanged" in out, (what, out)
            assert read("client-claude-secret") == old, what
            server.succeed(f"umount {openssl}")
        assert not server.succeed(f"find {SECRETS} -name '.*' -type f"), "a temporary file was left"
        # The unit, with a secret to generate: it fails and writes none.
        server.succeed("systemctl stop keycloak")
        server.succeed(f"mv {SECRETS}/client-gemini-secret /tmp/gemini-secret")
        server.succeed("printf '#!/bin/sh\\nprintf 0123abcd; exit 1\\n' > /tmp/fake-openssl")
        server.succeed(f"mount --bind /tmp/fake-openssl {openssl}")
        server.fail("systemctl restart mcp-edge-secrets")
        server.succeed(f"umount {openssl}")
        server.fail(f"test -e {SECRETS}/client-gemini-secret")
        assert not server.succeed(f"find {SECRETS} -name '.*' -type f"), "a temporary file was left"
        server.succeed(f"mv /tmp/gemini-secret {SECRETS}/client-gemini-secret")
        server.succeed("systemctl restart mcp-edge-secrets && systemctl start keycloak")
        server.succeed("mcp-edge-secrets rotate claude")
        wait_edge_up()
        status, fresh = signin("claude", "owner@example.com", CLAUDE)
        assert status == 0, fresh

    with subtest("Funnel off: the front refuses a request a public connection carries; Funnel on: it passes"):
        MARK = "-H 'Tailscale-Funnel-Request: ?1'"

        def code(path, marked, method="GET"):
            header = MARK if marked else ""
            return server.succeed(
                f"curl -s -o /dev/null -w '%{{http_code}}' -X {method} --cacert ${cert}/cert.pem {header} {BASE}{path}"
            )

        def settles(path, want):
            server.wait_until_succeeds(
                f"test \"$(curl -s -o /dev/null -w '%{{http_code}}' --cacert ${cert}/cert.pem {MARK} {BASE}{path})\" = {want}"
            )

        doc = "/.well-known/oauth-protected-resource/mcp"
        token = "/realms/${edge.realm}/protocol/openid-connect/token"
        # mcpFunnel = false (this machine): a marked request is 404 on every
        # route, before any proxying; tailnet requests work.
        assert code(doc, False) == "200" and code("/mcp", False, "POST") == "401"
        assert code(doc, True) == "404" and code("/mcp", True, "POST") == "404", "a Funnel request got past mcpFunnel = false"
        assert code(token, True, "POST") == "404"
        # mcpFunnel = true: the same marked requests reach the edge.
        server.succeed("/run/booted-system/specialisation/funnel/bin/switch-to-configuration test")
        settles(doc, "200")
        assert code("/mcp", True, "POST") == "401" and code(token, True, "POST") in ("400", "401")
        # Off again: refused again.
        server.succeed("/run/booted-system/bin/switch-to-configuration test")
        settles(doc, "404")
        assert code(doc, False) == "200"
  '';
}
