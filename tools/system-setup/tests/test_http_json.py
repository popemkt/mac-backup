from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

import pytest

from system_setup.checks import CheckFailed, run_check
from system_setup.models import HttpJsonCheck

PUBLIC_ORIGIN = "https://kb.example.test"
GRAPH_ROOT = "/graphs/home"


@pytest.fixture
def identity_server() -> Iterator[tuple[str, list[dict[str, str]]]]:
    requests: list[dict[str, str]] = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            requests.append(dict(self.headers))
            origin = self.headers.get("Origin")
            if origin is not None and origin != PUBLIC_ORIGIN:
                self.send_error(403)
                return
            body = b'{"root":"/graphs/home"}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, _format: str, *args: object) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/api/identity", requests
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def test_http_json_keeps_default_requests_working(identity_server) -> None:
    url, requests = identity_server
    check = HttpJsonCheck(
        kind="http_json", url=url, expected={"root": GRAPH_ROOT}, success_detail="graph ready"
    )
    assert run_check(check) == "graph ready"
    assert requests[-1]["Accept"] == "application/json"
    assert "Origin" not in requests[-1]


def test_http_json_checks_the_browser_origin(identity_server) -> None:
    url, requests = identity_server
    check = HttpJsonCheck(
        kind="http_json",
        url=url,
        headers={"Origin": PUBLIC_ORIGIN},
        expected={"root": GRAPH_ROOT},
        success_detail="public graph ready",
    )
    assert run_check(check) == "public graph ready"
    assert requests[-1]["Origin"] == PUBLIC_ORIGIN
    assert requests[-1]["Accept"] == "application/json"


def test_http_json_reports_origin_rejection(identity_server) -> None:
    url, _requests = identity_server
    check = HttpJsonCheck(
        kind="http_json",
        url=url,
        headers={"Origin": "https://other.example.test"},
        expected={"root": GRAPH_ROOT},
        success_detail="public graph ready",
    )
    with pytest.raises(CheckFailed, match="403"):
        run_check(check)


def test_http_json_rejects_the_wrong_graph(identity_server) -> None:
    url, _requests = identity_server
    check = HttpJsonCheck(
        kind="http_json",
        url=url,
        headers={"Origin": PUBLIC_ORIGIN},
        expected={"root": "/graphs/other"},
        success_detail="public graph ready",
    )
    with pytest.raises(CheckFailed, match="root"):
        run_check(check)
