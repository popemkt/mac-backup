"""A stand-in for the tailscale CLI, for the vpn stack's reconcile.

It keeps a serve config the way tailscaled does (cmd/tailscale/cli/serve_v2.go
and ipn/serve.go, 1.102) in $FAKE_TS_DIR/serve.json, answers
`serve status --json` from it, and logs every call to $FAKE_TS_DIR/calls.
Only the commands the reconcile runs are understood; anything else fails.

  $FAKE_TS_DIR/fail-services   present: every Service command fails
  $FAKE_TS_DIR/inject-mount    present: each node-level `serve` also mounts
                               the path it holds (something else taking a
                               mount on the port meanwhile)
"""

import json
import os
import sys

DIR = os.environ.get("FAKE_TS_DIR", "/tmp/fake-tailscale")
HOST = "server.example.ts.net"
STATE = os.path.join(DIR, "serve.json")


def load():
    try:
        with open(STATE) as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def save(sc):
    # tailscaled drops empty maps (ipn/serve.go RemoveWebHandler).
    sc = {k: v for k, v in sc.items() if v}
    with open(STATE, "w") as f:
        json.dump(sc, f)


def fail(message):
    print(f"fake tailscale: {message}", file=sys.stderr)
    sys.exit(1)


def flags(args):
    found, rest = {}, []
    for arg in args:
        if arg.startswith("--"):
            name, _, value = arg[2:].partition("=")
            found[name] = value
        else:
            rest.append(arg)
    return found, rest


def node_serve(sc, verb, opts, rest):
    port = opts["https"]
    hp = f"{HOST}:{port}"
    tcp = sc.setdefault("TCP", {})
    web = sc.setdefault("Web", {})
    funnel = sc.setdefault("AllowFunnel", {})
    if rest == ["off"]:
        # serve_v2.go removeWebServe: without --set-path, every mount on the
        # port; with no mount left, the port and its Funnel go too.
        if "TCPForward" in tcp.get(port, {}):
            fail("cannot remove web handler; currently serving TCP")
        if not web.get(hp, {}).get("Handlers"):
            fail("handler does not exist")
        del web[hp]
        tcp.pop(port, None)
        funnel.pop(hp, None)
        return
    if len(rest) != 1 or "bg" not in opts:
        fail(f"unexpected arguments: {rest} {opts}")
    if "TCPForward" in tcp.get(port, {}):
        fail("port is serving TCP")
    mount = opts.get("set-path") or "/"
    tcp[port] = {"HTTPS": True}
    web.setdefault(hp, {}).setdefault("Handlers", {})[mount] = {"Proxy": rest[0]}
    # serve_v2.go setServe: `funnel` turns the port's Funnel on, `serve`
    # turns it off.
    if verb == "funnel":
        funnel[hp] = True
    else:
        funnel.pop(hp, None)
    inject = os.path.join(DIR, "inject-mount")
    if verb == "serve" and os.path.exists(inject):
        with open(inject) as f:
            path, target = f.read().split()
        web[hp]["Handlers"][path] = {"Proxy": target}


def service(sc, verb, opts, rest):
    if os.path.exists(os.path.join(DIR, "fail-services")):
        fail("service command failed")
    services = sc.setdefault("Services", {})
    if rest[:1] in (["clear"], ["drain"]):
        if rest[0] == "clear":
            services.pop(rest[1], None)
        return
    services[opts["service"]] = {"Target": rest[0]}


def main(args):
    os.makedirs(DIR, exist_ok=True)
    with open(os.path.join(DIR, "calls"), "a") as f:
        f.write(" ".join(args) + "\n")
    if args[:1] == ["wait"]:
        return
    if args == ["serve", "status", "--json"]:
        print(json.dumps(load(), indent=2))
        return
    if args[:1] not in (["serve"], ["funnel"]):
        fail(f"unknown command: {args}")
    verb = args[0]
    opts, rest = flags(args[1:])
    sc = load()
    if "service" in opts or rest[:1] in (["clear"], ["drain"]):
        service(sc, verb, opts, rest)
    elif "https" in opts:
        node_serve(sc, verb, opts, rest)
    else:
        fail(f"unknown command: {args}")
    save(sc)


main(sys.argv[1:])
