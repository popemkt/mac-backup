"""blender-mcp: one headless Blender per MCP session, spoken to over stdio.

An agent harness starts this as a stdio MCP server. It starts Blender in
background mode with the dcc-mcp-blender server inside it (Streamable HTTP on
an OS-assigned loopback port), then relays each JSON-RPC message from stdin to
that endpoint and each reply back to stdout. When stdin closes, Blender is
stopped, so a session's scene lives exactly as long as the session.

    blender-mcp [file.blend]

The wrapper (default.nix) sets BLENDER_MCP_BLENDER, BLENDER_MCP_UV,
BLENDER_MCP_PYTHON (Blender's own Python) and BLENDER_MCP_SPEC (the pinned
requirement). On first use uv installs that requirement into a venv over
Blender's Python under $XDG_STATE_HOME/blender-mcp/envs, one per pin; Blender
then imports it through PYTHONPATH.
"""

import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

STARTUP_TIMEOUT_S = 180
STATE = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local/state")) / "blender-mcp"


def fail(message):
    print(f"blender-mcp: {message}", file=sys.stderr, flush=True)
    sys.exit(1)


def site_packages():
    """The pinned server's site-packages for Blender's Python: a venv per pin, built once by uv."""
    spec, python, uv = (os.environ[k] for k in ("BLENDER_MCP_SPEC", "BLENDER_MCP_PYTHON", "BLENDER_MCP_UV"))
    key = hashlib.sha256(f"{spec}\0{python}".encode()).hexdigest()[:16]
    env_dir = STATE / "envs" / key
    if not (env_dir / ".ready").exists():
        # Build beside it and rename into place, so concurrent first starts never see half an env.
        building = Path(tempfile.mkdtemp(prefix=f"{key}.", dir=STATE / "envs"))
        steps = [
            [uv, "venv", "--quiet", "--allow-existing", "--python", python, str(building)],
            [uv, "pip", "install", "--quiet", "--python", str(building / "bin" / "python"), spec],
        ]
        for step in steps:
            result = subprocess.run(step, capture_output=True, text=True, check=False)
            if result.returncode != 0:
                shutil.rmtree(building, ignore_errors=True)
                fail(f"could not install {spec}: {result.stderr.strip()}")
        (building / ".ready").touch()
        try:
            building.rename(env_dir)
        except OSError:
            shutil.rmtree(building, ignore_errors=True)  # another start won the race
    found = sorted((env_dir / "lib").glob("python3.*/site-packages"))
    if not found:
        fail(f"no site-packages in {env_dir}")
    return str(found[-1])


def start_blender(site, blend_file, log):
    bootstrap = Path(site) / "dcc_mcp_blender" / "blender_bootstrap.py"
    if not bootstrap.is_file():
        fail(f"{bootstrap} is missing")
    env = dict(
        os.environ,
        PYTHONPATH=site,
        # No machine-wide gateway: this session talks to its own Blender only,
        # and two people's gateways would contend for one port.
        DCC_MCP_GATEWAY_PORT="0",
        DCC_MCP_DISABLE_TELEMETRY="1",
    )
    argv = [os.environ["BLENDER_MCP_BLENDER"], "-b"]
    argv += [blend_file] if blend_file else ["--factory-startup"]
    argv += ["--python-use-system-env", "--python", str(bootstrap)]
    return subprocess.Popen(
        argv,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=log,
        text=True,
        start_new_session=True,
    )


def wait_for_url(blender, log):
    """Read Blender's output until it prints MCP_URL=…, then keep draining it into the log."""
    found = {}
    ready = threading.Event()

    def drain():
        for line in blender.stdout:
            log.write(line)
            log.flush()
            if not ready.is_set() and line.startswith("MCP_URL="):
                found["url"] = line.split("=", 1)[1].strip()
                ready.set()
        ready.set()

    threading.Thread(target=drain, daemon=True).start()
    ready.wait(STARTUP_TIMEOUT_S)
    if "url" not in found:
        fail(f"Blender did not start its MCP server; see {log.name}")
    return found["url"]


class Relay:
    def __init__(self, url):
        self.url = url
        self.session = None
        self.out = threading.Lock()

    def write(self, payload):
        with self.out:
            sys.stdout.write(payload.rstrip("\n") + "\n")
            sys.stdout.flush()

    def send(self, line):
        headers = {"content-type": "application/json", "accept": "application/json, text/event-stream"}
        if self.session:
            headers["mcp-session-id"] = self.session
        request = urllib.request.Request(self.url, data=line.encode(), headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request) as response:
                self.session = response.headers.get("mcp-session-id") or self.session
                body = response.read().decode()
                kind = response.headers.get("content-type", "")
        except urllib.error.HTTPError as error:
            body, kind = error.read().decode(), error.headers.get("content-type", "")
        except OSError as error:
            self.error_reply(line, f"Blender's MCP server is unreachable: {error}")
            return
        if not body.strip():
            return  # a notification's 202
        if kind.startswith("text/event-stream"):
            for event_line in body.splitlines():
                if event_line.startswith("data:"):
                    self.write(event_line[5:].strip())
        else:
            self.write(body)

    def error_reply(self, line, message):
        try:
            request_id = json.loads(line).get("id")
        except (ValueError, AttributeError):
            request_id = None
        if request_id is not None:
            self.write(json.dumps({"jsonrpc": "2.0", "id": request_id, "error": {"code": -32603, "message": message}}))


def stop(blender):
    if blender.poll() is None:
        os.killpg(blender.pid, signal.SIGTERM)
        try:
            blender.wait(10)
        except subprocess.TimeoutExpired:
            os.killpg(blender.pid, signal.SIGKILL)


def main():
    blend_file = sys.argv[1] if len(sys.argv) > 1 else None
    (STATE / "envs").mkdir(parents=True, exist_ok=True)
    log = open(STATE / f"{time.strftime('%Y%m%d-%H%M%S')}-{os.getpid()}.log", "w")
    blender = start_blender(site_packages(), blend_file, log)
    signal.signal(signal.SIGTERM, lambda *_: (stop(blender), sys.exit(0)))
    try:
        relay = Relay(wait_for_url(blender, log))
        # Each request on its own thread: Blender runs calls one at a time on its main thread, but
        # pings and notifications should not queue behind a long render.
        for line in sys.stdin:
            if line.strip():
                threading.Thread(target=relay.send, args=(line,), daemon=True).start()
    finally:
        stop(blender)


if __name__ == "__main__":
    main()
