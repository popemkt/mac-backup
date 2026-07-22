from __future__ import annotations

import pytest
from pydantic import ValidationError

from system_setup.models import Manifest


def integration(identifier: str, depends_on: list[str] | None = None) -> dict[str, object]:
    return {
        "id": identifier,
        "name": identifier,
        "description": "test",
        "depends_on": depends_on or [],
        "check": {
            "kind": "file",
            "path": "/tmp/example",
            "success_detail": "present",
        },
        "enrollment": {"kind": "none", "instructions": "test"},
        "secret_policy": "none",
        "recovery": "retry",
    }


def manifest(*integrations: dict[str, object]) -> dict[str, object]:
    return {
        "schema_version": 1,
        "host": {"name": "test", "role": "personal"},
        "integrations": list(integrations),
    }


def test_manifest_accepts_valid_dependency_graph() -> None:
    parsed = Manifest.model_validate(
        manifest(integration("device"), integration("service", ["device"]))
    )
    assert parsed.integrations[1].depends_on == ["device"]


@pytest.mark.parametrize(
    "items",
    [
        (integration("same"), integration("same")),
        (integration("child", ["missing"]),),
        (integration("self", ["self"]),),
        (integration("first", ["second"]), integration("second", ["first"])),
    ],
)
def test_manifest_rejects_invalid_graph(items: tuple[dict[str, object], ...]) -> None:
    with pytest.raises(ValidationError):
        Manifest.model_validate(manifest(*items))
