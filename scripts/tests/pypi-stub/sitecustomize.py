"""Offline PyPI responses for the production uv pin resolver."""

import io
import json
import os
import urllib.error
import urllib.request


def urlopen(url, timeout):
    assert url == "https://pypi.org/pypi/held/json"
    version = os.environ["STUB_PRIMARY"]
    if not version:
        raise urllib.error.URLError("stub: resolution failed")
    return io.StringIO(json.dumps({"info": {"version": version}}))


urllib.request.urlopen = urlopen
