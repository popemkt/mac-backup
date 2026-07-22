from __future__ import annotations

from pathlib import Path

from system_setup.checks import evaluate
from system_setup.models import Manifest


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


def test_evaluate_distinguishes_ready_missing_and_blocked(tmp_path: Path) -> None:
    existing = tmp_path / "present"
    existing.write_text("configured", encoding="utf-8")
    results = evaluate(make_manifest(existing, tmp_path / "missing"))
    assert [result.state for result in results] == ["ready", "action-needed", "blocked"]
