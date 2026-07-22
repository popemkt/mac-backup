from __future__ import annotations

import os
import subprocess
from collections.abc import Mapping, Sequence
from dataclasses import dataclass


@dataclass(frozen=True)
class NativeResult:
    returncode: int
    stdout: str
    stderr: str


class NativeCommandError(RuntimeError):
    def __init__(self, argv: Sequence[str], result: NativeResult) -> None:
        self.argv = tuple(argv)
        self.result = result
        detail = result.stderr.strip() or result.stdout.strip() or "no diagnostic output"
        super().__init__(f"{argv[0]} exited with {result.returncode}: {detail}")


def run_native(
    argv: Sequence[str],
    *,
    capture: bool = True,
    check: bool = True,
    timeout_seconds: float | None = 30,
    env: Mapping[str, str] | None = None,
) -> NativeResult:
    if not argv:
        raise ValueError("argv cannot be empty")

    completed = subprocess.run(
        list(argv),
        check=False,
        text=True,
        capture_output=capture,
        timeout=timeout_seconds,
        env=dict(os.environ) | dict(env or {}),
    )
    result = NativeResult(
        returncode=completed.returncode,
        stdout=completed.stdout or "",
        stderr=completed.stderr or "",
    )
    if check and result.returncode != 0:
        raise NativeCommandError(argv, result)
    return result
