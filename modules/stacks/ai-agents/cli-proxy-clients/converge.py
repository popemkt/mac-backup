"""Point desktop apps' AI connection at the local CLIProxyAPI.

Each app keeps its settings in its own mutable store. This tool owns only the
entry that connects the app to CLIProxyAPI; which model the app uses stays the
app's choice, made in its own settings.

An app that is not installed, or has never been launched, is skipped with a
note; applying again converges it once its store exists.

Usage (config rendered by Nix: {"baseUrl", "clients": {<app>: {settings}}}):
  converge.py <config.json> apply [app ...]   converge apps (default: all)
  converge.py <config.json> check <app>       exit 0 iff the app is connected
"""

import json
import plistlib
import subprocess
import sys
import urllib.request
import uuid
from pathlib import Path

# Stable namespace so a fresh store gets the same connection id every time.
NAMESPACE = uuid.UUID("5c1f0e2a-7d3b-4e7a-9a51-2c6c0d1f8317")


class NotSetUp(Exception):
    """The app's settings store does not exist yet."""


def note(app, msg):
    print(f"cli-proxy-clients: {app}: {msg}")


class Tinycast:
    domain = "com.tinycast.app"

    def __init__(self, base_url, models):
        self.base_url = base_url
        self.models = models

    def _connections(self):
        exported = subprocess.run(["/usr/bin/defaults", "export", self.domain, "-"], capture_output=True)
        if exported.returncode != 0:
            raise NotSetUp("no preferences; launch Tinycast once")
        raw = plistlib.loads(exported.stdout).get("aiConnections")
        return json.loads(raw) if raw else []

    def connected(self):
        return any(c.get("baseURL") == self.base_url for c in self._connections())

    def apply(self):
        connections = self._connections()
        if any(c.get("baseURL") == self.base_url for c in connections):
            return
        # A new connection offers the configured models; once it exists, the
        # models it offers and the default model are edited in Tinycast.
        connections.append(
            {
                "provider": "openAI",
                "baseURL": self.base_url,
                "visionModels": [],
                "models": list(self.models),
                "id": str(uuid.uuid5(NAMESPACE, self.base_url)).upper(),
                "name": "cliproxyapi",
            }
        )
        # Through `defaults` so cfprefsd sees the change; the value is a JSON
        # blob stored as plist data, as Tinycast writes it.
        blob = json.dumps(connections, separators=(",", ":")).encode()
        subprocess.run(["/usr/bin/defaults", "write", self.domain, "aiConnections", "-data", blob.hex()], check=True)


CLIENTS = {"tinycast": Tinycast}


def client(config, name):
    return CLIENTS[name](config["baseUrl"], **config["clients"][name])


def apply(config, names):
    for name in names or config["clients"]:
        try:
            c = client(config, name)
            if not c.connected():
                c.apply()
                note(name, "connected to CLIProxyAPI; restart the app to load it")
        except NotSetUp as err:
            note(name, f"not set up yet ({err}), then apply again")
        except Exception as err:  # converge best effort; never abort activation
            note(name, f"warning: not converged: {err}")


def check(config, name):
    try:
        if not client(config, name).connected():
            sys.exit(f"{name} is not connected to {config['baseUrl']}; run `cli-proxy-clients apply {name}`")
    except NotSetUp as err:
        sys.exit(f"{name} is not set up: {err}")
    try:
        with urllib.request.urlopen(f"{config['baseUrl']}/models", timeout=5) as response:
            served = len(json.load(response).get("data", []))
    except OSError as err:
        sys.exit(f"{name} is connected, but CLIProxyAPI does not answer: {err}")
    print(f"{name} is connected to CLIProxyAPI ({served} models served)")


def main():
    config = json.loads(Path(sys.argv[1]).read_text())
    command, args = (sys.argv[2], sys.argv[3:]) if len(sys.argv) > 2 else ("apply", [])
    unknown = [a for a in args if a not in config["clients"]]
    if command not in ("apply", "check") or unknown or (command == "check" and len(args) != 1):
        sys.exit(f"usage: cli-proxy-clients apply [{'|'.join(config['clients'])} ...] | check <app>")
    if command == "apply":
        apply(config, args)
    else:
        check(config, args[0])


if __name__ == "__main__":
    main()
