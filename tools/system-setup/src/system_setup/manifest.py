from __future__ import annotations

import os
from pathlib import Path

from pydantic import ValidationError

from system_setup.models import Manifest

DEFAULT_MANIFEST = Path("/etc/system-setup/integrations.json")


class ManifestError(RuntimeError):
    pass


def manifest_path() -> Path:
    configured = os.environ.get("SYSTEM_SETUP_MANIFEST")
    return Path(configured).expanduser() if configured else DEFAULT_MANIFEST


def load_manifest(path: Path | None = None) -> Manifest:
    selected = path or manifest_path()
    try:
        content = selected.read_text(encoding="utf-8")
    except OSError as error:
        raise ManifestError(f"cannot read setup manifest {selected}: {error}") from error
    try:
        return Manifest.model_validate_json(content)
    except ValidationError as error:
        raise ManifestError(f"invalid setup manifest {selected}: {error}") from error
