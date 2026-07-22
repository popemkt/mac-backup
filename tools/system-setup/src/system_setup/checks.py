from __future__ import annotations

import json
import subprocess
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from system_setup.models import (
    CheckResult,
    CheckSpec,
    CommandCheck,
    FileCheck,
    HttpJsonCheck,
    Integration,
    Manifest,
    OpenAIModelsCheck,
    TailscaleDeviceCheck,
    TailscaleServiceCheck,
)
from system_setup.native import NativeCommandError, run_native


class CheckFailed(RuntimeError):
    pass


def _read_json_url(url: str, timeout_seconds: float) -> Any:
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            return json.load(response)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        raise CheckFailed(str(error)) from error


def _nested_value(value: Any, path: str) -> Any:
    current = value
    for component in path.split("."):
        if not isinstance(current, dict) or component not in current:
            raise CheckFailed(f"response has no {path!r} field")
        current = current[component]
    return current


def _check_command(check: CommandCheck) -> str:
    result = run_native(check.argv, timeout_seconds=check.timeout_seconds)
    return result.stdout.strip() or check.success_detail


def _check_file(check: FileCheck) -> str:
    path = Path(check.path).expanduser()
    try:
        if not path.is_file() or path.stat().st_size == 0:
            raise CheckFailed(f"missing or empty state file: {path}")
    except OSError as error:
        raise CheckFailed(f"cannot inspect {path}: {error}") from error
    return check.success_detail


def _check_http_json(check: HttpJsonCheck) -> str:
    payload = _read_json_url(check.url, check.timeout_seconds)
    for path, expected in check.expected.items():
        actual = _nested_value(payload, path)
        if actual != expected:
            raise CheckFailed(f"{path} is {actual!r}; expected {expected!r}")
    return check.success_detail


def _check_openai_models(check: OpenAIModelsCheck) -> str:
    payload = _read_json_url(check.url, check.timeout_seconds)
    entries = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(entries, list):
        raise CheckFailed("model response has no data list")
    model_ids = {
        entry.get("id")
        for entry in entries
        if isinstance(entry, dict) and isinstance(entry.get("id"), str)
    }
    missing = [model for model in check.expected_models if model not in model_ids]
    if missing:
        raise CheckFailed(f"missing models: {', '.join(missing)}")
    return f"available models include {', '.join(check.expected_models)}"


def _tailscale_status(executable: str) -> dict[str, Any]:
    result = run_native([executable, "status", "--json"], timeout_seconds=15)
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise CheckFailed("tailscale status returned invalid JSON") from error
    if not isinstance(payload, dict):
        raise CheckFailed("tailscale status returned a non-object")
    return payload


def _check_tailscale_device(check: TailscaleDeviceCheck) -> str:
    payload = _tailscale_status(check.executable)
    if payload.get("BackendState") != "Running" or not payload.get("HaveNodeKey"):
        raise CheckFailed("device is not signed in and running")
    self_status = payload.get("Self")
    dns_name = self_status.get("DNSName") if isinstance(self_status, dict) else None
    return f"signed in as {dns_name or 'tailnet device'}"


def _check_tailscale_service(check: TailscaleServiceCheck) -> str:
    serve_result = run_native([check.executable, "serve", "status", "--json"], timeout_seconds=15)
    try:
        serve = json.loads(serve_result.stdout)
    except json.JSONDecodeError as error:
        raise CheckFailed("tailscale serve status returned invalid JSON") from error
    service_config = serve.get("Services", {}).get(check.service)
    if not isinstance(service_config, dict):
        raise CheckFailed(f"{check.service} has no local Serve declaration")
    serialized = json.dumps(service_config, sort_keys=True)
    if check.target not in serialized:
        raise CheckFailed(f"{check.service} does not route to {check.target}")

    payload = _tailscale_status(check.executable)
    self_status = payload.get("Self")
    capabilities = self_status.get("Capabilities", []) if isinstance(self_status, dict) else []
    capability = f"services/{check.service.removeprefix('svc:')}"
    if capability not in capabilities:
        raise CheckFailed(f"{check.service} is declared locally but awaits admin approval")
    return f"approved and routing to {check.target}"


def run_check(check: CheckSpec) -> str:
    try:
        if isinstance(check, CommandCheck):
            return _check_command(check)
        if isinstance(check, FileCheck):
            return _check_file(check)
        if isinstance(check, HttpJsonCheck):
            return _check_http_json(check)
        if isinstance(check, OpenAIModelsCheck):
            return _check_openai_models(check)
        if isinstance(check, TailscaleDeviceCheck):
            return _check_tailscale_device(check)
        if isinstance(check, TailscaleServiceCheck):
            return _check_tailscale_service(check)
    except (FileNotFoundError, NativeCommandError, subprocess.TimeoutExpired) as error:
        raise CheckFailed(str(error)) from error
    raise TypeError(f"unsupported check: {type(check).__name__}")


def evaluate(manifest: Manifest) -> list[CheckResult]:
    results: list[CheckResult] = []
    by_id: dict[str, CheckResult] = {}

    pending = list(manifest.integrations)
    while pending:
        progressed = False
        for integration in list(pending):
            if any(dependency not in by_id for dependency in integration.depends_on):
                continue
            blockers = [
                by_id[dependency]
                for dependency in integration.depends_on
                if by_id[dependency].state != "ready"
            ]
            if blockers:
                names = ", ".join(blocker.name for blocker in blockers)
                result = _result(integration, "blocked", f"waiting for: {names}")
            else:
                try:
                    detail = run_check(integration.check)
                    result = _result(integration, "ready", detail)
                except CheckFailed as error:
                    result = _result(integration, "action-needed", str(error))
                except Exception as error:  # Defensive boundary for operator diagnostics.
                    result = _result(integration, "error", f"{type(error).__name__}: {error}")
            results.append(result)
            by_id[integration.id] = result
            pending.remove(integration)
            progressed = True
        if not progressed:
            raise RuntimeError("manifest dependencies could not be ordered")
    return results


def _result(
    integration: Integration,
    state: str,
    detail: str,
) -> CheckResult:
    return CheckResult.model_validate(
        {
            "id": integration.id,
            "name": integration.name,
            "state": state,
            "required": integration.required,
            "detail": detail,
            "required_by": integration.required_by,
        }
    )
