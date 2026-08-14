from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import json
import threading
from collections.abc import Callable

import pytest

from system_setup.checks import MAX_CHECK_WORKERS, CheckFailed, evaluate, run_check
from system_setup.models import CommandCheck, Manifest, TailscaleServiceCheck
from system_setup.native import NativeResult


def make_manifest(existing: Path, missing: Path) -> Manifest:
    return Manifest.model_validate(
        {
            "schema_version": 3,
            "host": {"name": "test", "role": "personal"},
            "components": [],
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


def test_command_check_can_validate_without_reporting_stdout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    check = CommandCheck(
        kind="command",
        argv=["provider-cli", "status"],
        success_detail="Provider CLI is authenticated",
        stdout_contains=["authenticated"],
        report_stdout=False,
    )
    monkeypatch.setattr(
        "system_setup.checks.run_native",
        lambda *_args, **_kwargs: NativeResult(
            returncode=0,
            stdout="status: authenticated\naccount: configured",
            stderr="",
        ),
    )

    assert run_check(check) == "Provider CLI is authenticated"


def test_command_check_rejects_missing_expected_output(monkeypatch: pytest.MonkeyPatch) -> None:
    check = CommandCheck(
        kind="command",
        argv=["provider-cli", "status"],
        success_detail="Provider CLI is authenticated",
        stdout_contains=["authenticated"],
        report_stdout=False,
    )
    monkeypatch.setattr(
        "system_setup.checks.run_native",
        lambda *_args, **_kwargs: NativeResult(
            returncode=0,
            stdout="Authentication required",
            stderr="",
        ),
    )
    with pytest.raises(CheckFailed, match="command output is missing: authenticated"):
        run_check(check)


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


def make_parallel_manifest(
    integrations: list[tuple[str, str, list[str]]],
) -> Manifest:
    return Manifest.model_validate(
        {
            "schema_version": 3,
            "host": {"name": "test", "role": "personal"},
            "components": [],
            "integrations": [
                {
                    "id": identifier,
                    "name": name,
                    "description": "test",
                    "depends_on": dependencies,
                    "check": {
                        "kind": "file",
                        "path": f"/{identifier}",
                        "success_detail": identifier,
                    },
                    "enrollment": {"kind": "none", "instructions": "none"},
                    "secret_policy": "none",
                    "recovery": "retry",
                }
                for identifier, name, dependencies in integrations
            ],
        }
    )


def test_evaluate_overlaps_independent_checks_and_preserves_order(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest = make_parallel_manifest(
        [("first", "First", []), ("second", "Second", [])]
    )
    both_started = threading.Event()
    lock = threading.Lock()
    started = 0

    def fake_run_check(_check: object) -> str:
        nonlocal started
        with lock:
            started += 1
            if started == 2:
                both_started.set()
        assert both_started.wait(timeout=1)
        return "ready"

    monkeypatch.setattr("system_setup.checks.run_check", fake_run_check)

    results = evaluate(manifest)

    assert [result.id for result in results] == ["first", "second"]
    assert [result.state for result in results] == ["ready", "ready"]


def test_evaluate_waits_for_a_complete_dependency_wave(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest = make_parallel_manifest(
        [
            ("child", "Child", ["parent-a", "parent-b"]),
            ("parent-a", "Parent A", []),
            ("parent-b", "Parent B", []),
        ]
    )
    both_parents_started = threading.Barrier(2, timeout=1)
    parents_finished: set[str] = set()
    lock = threading.Lock()

    def fake_run_check(check: object) -> str:
        identifier = getattr(check, "path").removeprefix("/")
        if identifier.startswith("parent"):
            both_parents_started.wait()
            with lock:
                parents_finished.add(identifier)
            return "ready"
        assert parents_finished == {"parent-a", "parent-b"}
        return "ready"

    monkeypatch.setattr("system_setup.checks.run_check", fake_run_check)

    results = evaluate(manifest)

    assert [result.id for result in results] == ["parent-a", "parent-b", "child"]
    assert [result.state for result in results] == ["ready", "ready", "ready"]


def test_evaluate_blocks_descendants_without_running_their_checks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest = make_parallel_manifest(
        [
            ("child", "Child", ["action-needed", "error"]),
            ("action-needed", "Needs action", []),
            ("error", "Errored", []),
        ]
    )
    checked: list[str] = []
    lock = threading.Lock()

    def fake_run_check(check: object) -> str:
        identifier = getattr(check, "path").removeprefix("/")
        with lock:
            checked.append(identifier)
        if identifier == "action-needed":
            raise CheckFailed("configure it")
        if identifier == "error":
            raise ValueError("unexpected")
        raise AssertionError("blocked integration must not run")

    monkeypatch.setattr("system_setup.checks.run_check", fake_run_check)

    results = evaluate(manifest)

    assert [result.id for result in results] == ["action-needed", "error", "child"]
    assert [result.state for result in results] == ["action-needed", "error", "blocked"]
    assert results[2].detail == "waiting for: Needs action, Errored"
    assert set(checked) == {"action-needed", "error"}


def test_evaluate_limits_independent_checks_to_eight_workers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest = make_parallel_manifest(
        [(f"check-{index}", f"Check {index}", []) for index in range(10)]
    )
    release = threading.Event()
    saturated = threading.Event()
    lock = threading.Lock()
    active = 0
    peak = 0

    def fake_run_check(_check: object) -> str:
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
            if active == MAX_CHECK_WORKERS:
                saturated.set()
        assert release.wait(timeout=1)
        with lock:
            active -= 1
        return "ready"

    monkeypatch.setattr("system_setup.checks.run_check", fake_run_check)

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(evaluate, manifest)
        assert saturated.wait(timeout=1)
        release.set()
        results = future.result(timeout=1)

    assert peak == MAX_CHECK_WORKERS
    assert [result.state for result in results] == ["ready"] * 10
