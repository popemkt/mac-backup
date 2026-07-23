from __future__ import annotations

import pytest
from pydantic import ValidationError

from system_setup.models import Manifest


def component(identifier: str) -> dict[str, object]:
    return {
        "id": identifier,
        "name": identifier,
        "description": "test",
        "managed_by": "nix",
    }


def integration(
    identifier: str,
    depends_on: list[str] | None = None,
    connection: tuple[str, str] | None = None,
) -> dict[str, object]:
    value: dict[str, object] = {
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
    if connection is not None:
        value["connection"] = {"source": connection[0], "target": connection[1]}
    return value


def manifest(
    *integrations: dict[str, object],
    components: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    return {
        "schema_version": 2,
        "host": {"name": "test", "role": "personal"},
        "components": components or [],
        "integrations": list(integrations),
    }


def test_manifest_accepts_valid_dependency_graph() -> None:
    parsed = Manifest.model_validate(
        manifest(integration("device"), integration("service", ["device"]))
    )
    assert parsed.integrations[1].depends_on == ["device"]


def test_manifest_accepts_connection_with_known_components() -> None:
    parsed = Manifest.model_validate(
        manifest(
            integration("generation", connection=("cognee", "proxy")),
            components=[component("cognee"), component("proxy")],
        )
    )

    assert parsed.integrations[0].connection is not None
    assert parsed.integrations[0].connection.target == "proxy"


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


@pytest.mark.parametrize(
    ("components", "items"),
    [
        ([component("same"), component("same")], ()),
        (
            [component("cognee")],
            (integration("generation", connection=("cognee", "missing")),),
        ),
        (
            [component("cognee")],
            (integration("generation", connection=("cognee", "cognee")),),
        ),
    ],
)
def test_manifest_rejects_invalid_component_graph(
    components: list[dict[str, object]],
    items: tuple[dict[str, object], ...],
) -> None:
    with pytest.raises(ValidationError):
        Manifest.model_validate(manifest(*items, components=components))
