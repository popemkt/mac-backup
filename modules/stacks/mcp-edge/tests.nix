{ pkgs }:

# checks.x86_64-linux.mcp-edge: the OAuth edge under its real units and
# sandboxes (docs/mcp-edge.md → Tests). One machine runs what shared-server
# would: app-kb (the owner's store, real kb), kb-remote (as kb-edge, in its
# sandbox), oauth2-proxy, Keycloak and the front. Two stand-ins:
#   - Google: Dex with two password accounts (owner@, intruder@), reached
#     through Keycloak's generic OpenID provider (`upstream.provider = "oidc"`);
#   - tailscaled: an nginx that terminates TLS for the public name and
#     forwards every path to the front, as `nodeServe` does.
# kb-remote runs `kb mcp --listen` from kb's feat/mcp-listen branch until
# the kb pin ships it (kbListen below); app-kb runs the pinned kb.
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

  # GAP [[01M86QT0G81VG04JQ294EXACE2]]: the kb pin has no `mcp --listen` yet, so
  # kb-remote runs kb built from popemkt/kb feat/mcp-listen at a fixed commit
  # (kb's own flake, locked by rev and narHash; test-only).
  kbListen =
    (builtins.getFlake "github:popemkt/kb/bdde545562bb053cb39504b2400bfb01bec96352?narHash=sha256-TqbGtjpXjIvWa1GsMJGJiKtIVwSrxqR41B8OVsZR4sM%3D")
    .packages.${pkgs.stdenv.hostPlatform.system}.kb;

  python = pkgs.python3.withPackages (p: [
    p.requests
    p.pyjwt
    p.cryptography
  ]);
  edgeTest = pkgs.writeShellScriptBin "edge-test" ''
    export EDGE_HOST=${host} EDGE_CA=${cert}/cert.pem EDGE_SECRETS=/var/lib/mcp-edge/secrets
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

  # The vpn stack's reconcile with the edge's node serve entry, and without
  # it (the off switch), against a tailscale that records its arguments.
  fakeTailscale = pkgs.writeShellScript "tailscale" ''
    echo "$*" >> /tmp/tailscale-calls
  '';
  reconcile =
    nodeServe:
    pkgs.writeShellScript "reconcile"
      (import ../vpn/services-reconcile.nix {
        inherit lib pkgs;
        cfg = {
          enable = true;
          services = { };
          inherit nodeServe;
        };
        tailscale = fakeTailscale;
        stateDir = "/tmp/tailscale-services";
      }).script;
  # The entry as the host declares it, with the option's default port.
  reconcileOn = reconcile {
    mcp-edge = {
      port = 443;
      target = "http://127.0.0.1:${toString edge.ports.front}";
    };
  };
  reconcileOff = reconcile { };

  # bcrypt of "password" (Dex's own example hash).
  passwordHash = "$2a$10$2b2cU8CPhOTaGrs1HRQuAueS7JTT5ZHsHSzYiFPm1leZck7Mc8T4W";
in
pkgs.testers.runNixOSTest {
  name = "mcp-edge";
  nodes.server =
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
                package = kbListen;
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
          pkgs.jq
          pkgs.socat
          pkgs.kb
          config.services.postgresql.package
        ];
      };
    };

  testScript = ''
    import json, re

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

    def remote(token, tool, text):
        out = mcp(token=token, method="tools/call", params={"name": tool, "arguments": {"text": text}})
        assert out["status"] == 200 and not out["answer"]["result"].get("isError"), out
        return out["answer"]["result"]["content"][0]["text"]

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
        server.fail("curl -sf http://127.0.0.1:${toString edge.ports.keycloak}/admin/realms")

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
        for flags in ["--pkce none", "--pkce plain", "--response-type token", "--response-type id_token"]:
            status, out = signin("gemini", "owner@example.com", GEMINI, flags)
            assert status != 0 and "access_token" not in out, (flags, out)
        status, out = signin("gemini", "owner@example.com", GEMINI, "--no-verifier")
        assert status != 0 and "access_token" not in out, out
        for grant in ["password", "client_credentials"]:
            out = run_json(f"edge-test grant gemini {grant}")[1]
            assert "access_token" not in out and out["status"] in (400, 401), (grant, out)

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

    with subtest("tailnet exposure: nodeServe publishes the front alone, and the off switch removes it"):
        server.succeed("${reconcileOn}")
        calls = server.succeed("cat /tmp/tailscale-calls").splitlines()
        assert calls[-1] == "serve --bg --yes --https=443 http://127.0.0.1:${toString edge.ports.front}", calls
        assert not any("funnel" in c for c in calls), calls
        server.succeed("${reconcileOn} && ${reconcileOff}")
        calls = server.succeed("cat /tmp/tailscale-calls").splitlines()
        assert calls[-1] == "serve --https=443 off", calls

    with subtest("B5: loopback egress, key rotation without a restart, wrong iss refused"):
        deny = server.succeed("systemctl show mcp-edge-oauth2-proxy -p IPAddressDeny --value").split()
        allow = server.succeed("systemctl show mcp-edge-oauth2-proxy -p IPAddressAllow --value").split()
        assert sorted(deny) == ["0.0.0.0/0", "::/0"], deny
        assert sorted(allow) == ["127.0.0.0/8", "::1/128"], allow
        assert mcp(token=forge("wrong-iss"))["status"] in (401, 403)
        pid = server.succeed("systemctl show mcp-edge-oauth2-proxy -p MainPID --value").strip()
        old_kid = claims(owner["access_token"])["header"]["kid"]
        server.succeed("systemctl restart keycloak")
        server.wait_for_unit("keycloak.service")
        server.wait_for_open_port(${toString edge.ports.keycloak})
        status, fresh = signin("gemini", "owner@example.com", GEMINI)
        assert status == 0, fresh
        assert claims(fresh["access_token"])["header"]["kid"] != old_kid, "the restart did not rotate the key"
        assert mcp(token=fresh["access_token"])["status"] == 200
        assert mcp(token=owner["access_token"])["status"] == 401, "a token from before the restart still works"
        assert mcp(token=forge("wrong-iss"))["status"] in (401, 403)
        assert server.succeed("systemctl show mcp-edge-oauth2-proxy -p MainPID --value").strip() == pid
  '';
}
