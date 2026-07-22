from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path

import pytest

from system_setup.checks import CheckFailed, evaluate, run_check
from system_setup.models import Manifest, TailscaleServiceCheck
from system_setup.native import NativeResult


def make_manifest(existing: Path, missing: Path) -> Manifest:
    return Manifest.model_validate(
        {
            "schema_version": 1,
            "host": {"name": "test", "role": "personal"},
            "integrations": [
                {
                    "id": "present",
                    "name": "Present state",
                    "description": "test",
                    "check": {
                        "kind": "file",
                        "path": str(existing),
                        "success_detail": "present",
                    },
                    "enrollment": {"kind": "none", "instructions": "none"},
                    "secret_policy": "none",
                    "recovery": "retry",
                },
                {
                    "id": "missing",
                    "name": "Missing state",
                    "description": "test",
                    "depends_on": ["present"],
                    "check": {
                        "kind": "file",
                        "path": str(missing),
                        "success_detail": "present",
                    },
                    "enrollment": {"kind": "none", "instructions": "none"},
                    "secret_policy": "none",
                    "recovery": "retry",
                },
                {
                    "id": "blocked",
                    "name": "Blocked state",
                    "description": "test",
                    "depends_on": ["missing"],
                    "check": {
                        "kind": "file",
                        "path": str(existing),
                        "success_detail": "present",
                    },
                    "enrollment": {"kind": "none", "instructions": "none"},
                    "secret_policy": "none",
                    "recovery": "retry",
                },
            ],
        }
    )


def tailscale_run_native(
    *,
    capabilities: list[str],
    service_hosts: list[dict[str, list[str]]],
) -> Callable[..., NativeResult]:
    def fake_run_native(argv: list[str], **_kwargs: object) -> NativeResult:
        if argv[1:3] == ["serve", "status"]:
            payload = {
                "Services": {
                    "svc:adhoc": {
                        "Web": {
                            "adhoc.example.ts.net:443": {
                                "Handlers": {"/": {"Proxy": "http://127.0.0.1:9000"}}
                            }
                        }
                    }
                }
            }
        else:
            payload = {
                "Self": {
                    "Capabilities": capabilities,
                    "CapMap": {"service-host": service_hosts},
                }
            }
        return NativeResult(returncode=0, stdout=json.dumps(payload), stderr="")

    return fake_run_native


def test_evaluate_distinguishes_ready_missing_and_blocked(tmp_path: Path) -> None:
    existing = tmp_path / "present"
    existing.write_text("configured", encoding="utf-8")
    results = evaluate(make_manifest(existing, tmp_path / "missing"))
    assert [result.state for result in results] == ["ready", "action-needed", "blocked"]


def test_tailscale_service_requires_tailnet_definition(monkeypatch: pytest.MonkeyPatch) -> None:
    check = TailscaleServiceCheck(
        kind="tailscale_service",
        service="svc:adhoc",
        target="http://127.0.0.1:9000",
    )
    monkeypatch.setattr(
        "system_setup.checks.run_native",
        tailscale_run_native(capabilities=[], service_hosts=[]),
    )

    with pytest.raises(CheckFailed, match="not defined in this tailnet"):
        run_check(check)


def test_tailscale_service_requires_host_approval(monkeypatch: pytest.MonkeyPatch) -> None:
    check = TailscaleServiceCheck(
        kind="tailscale_service",
        service="svc:adhoc",
        target="http://127.0.0.1:9000",
    )

    monkeypatch.setattr(
        "system_setup.checks.run_native",
        tailscale_run_native(
            capabilities=["services/adhoc"],
            service_hosts=[{"svc:cognee": ["100.64.0.1"]}],
        ),
    )

    with pytest.raises(CheckFailed, match="awaits host approval"):
        run_check(check)


def test_tailscale_service_accepts_approved_host(monkeypatch: pytest.MonkeyPatch) -> None:
    check = TailscaleServiceCheck(
        kind="tailscale_service",
        service="svc:adhoc",
        target="http://127.0.0.1:9000",
    )

    monkeypatch.setattr(
        "system_setup.checks.run_native",
        tailscale_run_native(
            capabilities=["services/adhoc"],
            service_hosts=[{"svc:adhoc": ["100.64.0.2"]}],
        ),
    )

    assert run_check(check) == "approved and routing to http://127.0.0.1:9000"
