"""The VM test's client: what a vendor connector and the owner's browser do.

Every request goes to https://<host> (the test's stand-in for tailscaled,
which terminates TLS and forwards to the front), so each one meets the public
allow-list. Subcommands print JSON or an HTTP status; tests.nix asserts.
"""

import argparse
import base64
import hashlib
import html.parser
import json
import os
import secrets
import subprocess
import sys
import time
import urllib.parse

import jwt
import requests
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

HOST = os.environ["EDGE_HOST"]
BASE = f"https://{HOST}"
ISSUER = f"{BASE}/realms/kb"
RESOURCE = f"{BASE}/mcp"
CA = os.environ["EDGE_CA"]
SECRETS = os.environ["EDGE_SECRETS"]
PASSWORD = "password"


class Forms(html.parser.HTMLParser):
    """Every form on a page (action, inputs, submit buttons) and every link."""

    def __init__(self):
        super().__init__()
        self.forms, self.links = [], []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "form":
            self.forms.append({"action": a.get("action", ""), "id": a.get("id", ""), "fields": {}, "buttons": {}})
        elif tag == "a" and a.get("href"):
            self.links.append(a["href"])
        elif tag in ("input", "button") and self.forms and a.get("name"):
            kind = a.get("type", "submit" if tag == "button" else "text")
            target = self.forms[-1]["buttons" if kind == "submit" else "fields"]
            target[a["name"]] = a.get("value", "")


def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def session():
    s = requests.Session()
    s.verify = CA
    return s


def secret_of(client):
    with open(f"{SECRETS}/client-{client}-secret") as f:
        return f.read().strip()


def authorize(client, email, redirect, pkce="S256", response_type="code", scope="openid email"):
    """The owner's browser: start at the authorization endpoint, sign in at
    the stand-in for Google, approve, and stop at the vendor's redirect.
    Returns (query of the final redirect, PKCE verifier)."""
    s = session()
    verifier = secrets.token_urlsafe(48)
    params = {
        "client_id": client,
        "redirect_uri": redirect,
        "response_type": response_type,
        "scope": scope,
        "state": secrets.token_urlsafe(8),
    }
    if pkce == "S256":
        params |= {"code_challenge": b64url(hashlib.sha256(verifier.encode()).digest()), "code_challenge_method": "S256"}
    elif pkce == "plain":
        params |= {"code_challenge": verifier, "code_challenge_method": "plain"}
    r = s.get(f"{ISSUER}/protocol/openid-connect/auth", params=params, allow_redirects=False)
    for _ in range(40):
        if r.status_code in (301, 302, 303, 307):
            location = urllib.parse.urljoin(r.url, r.headers["Location"])
            if location.startswith(redirect):
                # Both halves: an implicit grant would put its tokens in the
                # fragment.
                parts = urllib.parse.urlsplit(location)
                found = dict(urllib.parse.parse_qsl(parts.query)) | dict(urllib.parse.parse_qsl(parts.fragment))
                return found | {"location": location}, verifier
            r = s.get(location, allow_redirects=False)
            continue
        if r.status_code != 200:
            return {"error": f"HTTP {r.status_code} at {r.url}", "body": r.text[:50000]}, verifier
        page = Forms()
        page.feed(r.text)
        broker = [link for link in page.links if "/broker/google/login" in link]
        forms = {f["id"] or f["action"]: f for f in page.forms}
        if broker:
            r = s.get(urllib.parse.urljoin(r.url, html.unescape(broker[0])), allow_redirects=False)
            continue
        form = next((f for f in page.forms if "login" in f["fields"] and "password" in f["fields"]), None)
        if form:  # the stand-in for Google (Dex's password connector)
            data = form["fields"] | {"login": email, "password": PASSWORD}
        else:
            form = next((f for f in page.forms if "login-actions" in f["action"]), None)
            if form is None:
                return {"error": f"no way forward at {r.url}", "forms": list(forms), "body": r.text[:50000]}, verifier
            data = dict(form["fields"])
            # The first sign-in's profile review, if Keycloak asks.
            for field, value in (("firstName", "Test"), ("lastName", "Person"), ("email", email), ("username", email)):
                if field in data and not data[field]:
                    data[field] = value
            # The approval screen: accept.
            if "accept" in form["buttons"]:
                data["accept"] = form["buttons"]["accept"] or "Yes"
        r = s.post(urllib.parse.urljoin(r.url, html.unescape(form["action"])), data=data, allow_redirects=False)
    return {"error": "too many steps"}, verifier


def redeem(client, query, verifier, redirect, secret=None, send_verifier=True):
    data = {"grant_type": "authorization_code", "code": query.get("code", ""), "redirect_uri": redirect}
    if send_verifier:
        data["code_verifier"] = verifier
    auth = None if secret == "" else (client, secret if secret is not None else secret_of(client))
    r = session().post(f"{ISSUER}/protocol/openid-connect/token", data=data, auth=auth)
    return {"status": r.status_code} | r.json()


def cmd_signin(a):
    query, verifier = authorize(a.client, a.email, a.redirect, pkce=a.pkce, response_type=a.response_type, scope=a.scope)
    if "code" not in query:
        print(json.dumps({"authorize": query}))
        return 1
    secret = {"right": None, "wrong": "not-the-secret", "none": ""}[a.secret]
    out = redeem(a.client, query, verifier, a.redirect, secret=secret, send_verifier=not a.no_verifier)
    if a.then_right and "access_token" not in out:
        out["retry_with_right_secret"] = redeem(a.client, query, verifier, a.redirect)
    print(json.dumps(out))
    return 0 if "access_token" in out else 1


def cmd_grant(a):
    """Grants the clients must not have: password, client credentials."""
    data = {"grant_type": a.grant}
    if a.grant == "password":
        data |= {"username": "owner@example.com", "password": PASSWORD, "scope": "openid"}
    r = session().post(f"{ISSUER}/protocol/openid-connect/token", data=data, auth=(a.client, secret_of(a.client)))
    print(json.dumps({"status": r.status_code} | r.json()))


def claims(token):
    return jwt.decode(token, options={"verify_signature": False})


def cmd_claims(a):
    print(json.dumps({"header": jwt.get_unverified_header(a.token), "claims": claims(a.token)}))


def mcp_post(body, token=None, cookie=None, base=BASE):
    headers = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if cookie:
        headers["Cookie"] = cookie
    return session().post(f"{base}/mcp", json=body, headers=headers)


def cmd_mcp(a):
    """initialize, then one call; prints the status and the call's answer."""
    init = mcp_post(
        {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "edge-test", "version": "0"}}},
        token=a.token,
        cookie=a.cookie,
        base=a.base,
    )
    out = {"status": init.status_code, "www_authenticate": init.headers.get("WWW-Authenticate")}
    if init.status_code == 200:
        params = json.loads(a.params) if a.params else {}
        call = mcp_post({"jsonrpc": "2.0", "id": 2, "method": a.method, "params": params}, token=a.token, cookie=a.cookie, base=a.base)
        answer = call.json()
        # Tool names only: the full schemas run to ~100 KB, more than the
        # test driver's console carries reliably.
        tools = answer.get("result", {}).get("tools")
        if tools is not None:
            answer["result"]["tools"] = [{"name": t["name"]} for t in tools]
        out |= {"call_status": call.status_code, "answer": answer}
    else:
        out["body"] = init.text[:500]
    print(json.dumps(out))


def cmd_upload(a):
    """asset_upload of `size` bytes, base64 in one JSON-RPC call through the
    edge: the status, and kb's answer when it got one."""
    data = base64.b64encode(b"\x01" * a.size).decode()
    init = mcp_post(
        {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "edge-test", "version": "0"}}},
        token=a.token,
    )
    if init.status_code != 200:
        print(json.dumps({"status": init.status_code, "at": "initialize"}))
        return
    body = {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "asset_upload", "arguments": {"bytes": data, "ext": "png"}}}
    try:
        r = mcp_post(body, token=a.token)
    except requests.exceptions.ConnectionError as e:
        print(json.dumps({"status": 0, "error": str(e)[:300]}))
        return
    out = {"status": r.status_code, "body_bytes": len(json.dumps(body))}
    if r.status_code != 200:
        out["body"] = r.text[:300]
    else:
        result = r.json().get("result", {})
        out |= {"isError": bool(result.get("isError")), "text": result.get("content", [{}])[0].get("text", "")[:300]}
    print(json.dumps(out))


def cmd_post(a):
    """A POST of about `size` bytes (a JSON-RPC call padded out), with no
    token: the status, or the error when the connection is cut."""
    head, tail = '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"pad":"', '"}}'
    body = head + "A" * max(0, a.size - len(head) - len(tail)) + tail
    try:
        r = session().post(f"{BASE}{a.path}", data=body, headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream"})
        print(json.dumps({"status": r.status_code, "body": r.text[:200]}))
    except requests.exceptions.ConnectionError as e:
        print(json.dumps({"status": 0, "error": str(e)[:300]}))


def cmd_status(a):
    r = session().request(a.method, f"{BASE}{a.path}", allow_redirects=False)
    print(r.status_code)


def realm_private_key():
    sql = (
        "select cc.value from component_config cc join component c on c.id = cc.component_id "
        "join realm r on r.id = c.realm_id where r.name = 'kb' and c.provider_id = 'rsa-generated' "
        "and cc.name = 'privateKey'"
    )
    der = subprocess.run(
        ["runuser", "-u", "postgres", "--", "psql", "keycloak", "-tAc", sql], check=True, capture_output=True, text=True
    ).stdout.strip()
    return serialization.load_der_private_key(base64.b64decode(der), password=None)


def realm_kid(key):
    n = key.public_key().public_numbers().n
    for jwk in session().get(f"{ISSUER}/protocol/openid-connect/certs").json()["keys"]:
        if jwk.get("use") == "sig" and int.from_bytes(base64.urlsafe_b64decode(jwk["n"] + "=="), "big") == n:
            return jwk["kid"]
    raise SystemExit("the realm's signing key is not in its JWKS")


def cmd_forge(a):
    """Tokens Keycloak never issued: signed with its own key but wrong in one
    claim, or right in every claim but signed by someone else."""
    key, kid = realm_private_key(), None
    kid = realm_kid(key)
    now = int(time.time())
    body = {
        "iss": ISSUER,
        "aud": RESOURCE,
        "sub": "f0rged",
        "azp": "gemini",
        "typ": "Bearer",
        "iat": now,
        "exp": now + 300,
        "email": "owner@example.com",
        "email_verified": True,
    }
    variant = a.variant
    if variant == "client-aud":
        body["aud"] = "gemini"
    elif variant == "foreign-aud":
        body["aud"] = "https://elsewhere.example/mcp"
    elif variant == "wrong-iss":
        body["iss"] = "https://evil.example/realms/kb"
    elif variant == "other-email":
        body["email"] = "intruder@example.com"
    elif variant == "unverified-email":
        body["email_verified"] = False
    elif variant == "expired":
        body |= {"iat": now - 900, "exp": now - 600}
    elif variant in ("foreign-key", "foreign-issuer"):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        if variant == "foreign-issuer":
            body["iss"], kid = "http://127.0.0.1:5556/dex", "foreign"
    elif variant != "control":
        raise SystemExit(f"unknown variant {variant}")
    print(jwt.encode(body, key, algorithm="RS256", headers={"kid": kid}))


def cmd_acl(a):
    """Every file and directory under the store: the owner and the edge's
    group can read and write it (effective, after the ACL mask), and every
    directory hands both on to what is created in it."""
    bad = []
    for top, dirs, files in os.walk(a.root):
        # kb ui's presence file is the owner's alone (0600) by design.
        for path in [top] + [os.path.join(top, f) for f in files if f != "ui.json"]:
            acl = subprocess.run(["getfacl", "-p", "-e", path], check=True, capture_output=True, text=True).stdout
            owner = subprocess.run(["stat", "-c", "%U", path], check=True, capture_output=True, text=True).stdout.strip()
            effective = {}
            for line in acl.splitlines():
                if line.startswith("#") or not line.strip():
                    continue
                entry, _, rest = line.partition("\t")
                rights = rest.split(":")[-1].strip() if "#effective" in rest else entry.split(":")[-1]
                effective[entry.rsplit(":", 1)[0]] = rights
            need = [f"group:{a.group}"] + ([] if owner == a.owner else [f"user:{a.owner}"])
            if os.path.isdir(path):
                need += [f"default:group:{a.group}", f"default:user:{a.owner}"]
            for who in need:
                if not effective.get(who, "").startswith("rw"):
                    bad.append(f"{path}: {who} has '{effective.get(who, '')}'")
    print(json.dumps({"checked": a.root, "problems": bad}))
    return 1 if bad else 0


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("signin")
    s.add_argument("client")
    s.add_argument("email")
    s.add_argument("--redirect", required=True)
    s.add_argument("--secret", choices=["right", "wrong", "none"], default="right")
    s.add_argument("--then-right", action="store_true")
    s.add_argument("--pkce", choices=["S256", "plain", "none"], default="S256")
    s.add_argument("--no-verifier", action="store_true")
    s.add_argument("--response-type", default="code")
    s.add_argument("--scope", default="openid email")
    s.set_defaults(fn=cmd_signin)
    s = sub.add_parser("grant")
    s.add_argument("client")
    s.add_argument("grant")
    s.set_defaults(fn=cmd_grant)
    s = sub.add_parser("claims")
    s.add_argument("token")
    s.set_defaults(fn=cmd_claims)
    s = sub.add_parser("mcp")
    s.add_argument("--token")
    s.add_argument("--cookie")
    s.add_argument("--base", default=BASE)
    s.add_argument("--method", default="tools/list")
    s.add_argument("--params")
    s.set_defaults(fn=cmd_mcp)
    s = sub.add_parser("upload")
    s.add_argument("token")
    s.add_argument("size", type=int)
    s.set_defaults(fn=cmd_upload)
    s = sub.add_parser("post")
    s.add_argument("path")
    s.add_argument("size", type=int)
    s.set_defaults(fn=cmd_post)
    s = sub.add_parser("status")
    s.add_argument("path")
    s.add_argument("--method", default="GET")
    s.set_defaults(fn=cmd_status)
    s = sub.add_parser("forge")
    s.add_argument("variant")
    s.set_defaults(fn=cmd_forge)
    s = sub.add_parser("acl")
    s.add_argument("root")
    s.add_argument("owner")
    s.add_argument("group")
    s.set_defaults(fn=cmd_acl)
    a = p.parse_args()
    sys.exit(a.fn(a) or 0)


if __name__ == "__main__":
    main()
