"""A stand-in for the host's ntfy, for the monitoring VM test.

Listens on an HTTP Unix socket as ntfy does on shared-server, accepts a
publish (POST /<topic>) only with `Authorization: Bearer <token>` (the token
file ntfy-setup writes), and appends each accepted message as one JSON line
to the log, so the test can count them.

  ntfy-standin.py <socket> <token file> <log>
"""

import http.server
import json
import os
import socketserver
import sys

SOCKET, TOKEN_FILE, LOG = sys.argv[1:4]


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length).decode()
        with open(TOKEN_FILE) as f:
            token = f.read().strip()
        if self.headers.get("Authorization") != f"Bearer {token}":
            self.send_response(401)
            self.end_headers()
            return
        record = {
            "topic": self.path.lstrip("/"),
            "title": self.headers.get("X-Title"),
            "priority": self.headers.get("X-Priority"),
            "tags": self.headers.get("X-Tags"),
            "message": body,
        }
        with open(LOG, "a") as f:
            f.write(json.dumps(record) + "\n")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"id":"standin"}')


class Server(socketserver.UnixStreamServer):
    def get_request(self):
        request, _ = super().get_request()
        return request, ("local", 0)


if os.path.exists(SOCKET):
    os.unlink(SOCKET)
with Server(SOCKET, Handler) as server:
    server.serve_forever()
