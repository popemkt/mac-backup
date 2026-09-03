#!/usr/bin/env python3
"""Keep normal Claude Code sessions off globally configured inference gateways.

TODO: Review in the future once Headroom upstream stops mutating global
~/.claude/settings.json or supports native opt-in routing without injecting
SessionStart hooks / global base URLs. Retire or simplify this script once
direct routing is preserved cleanly by default.
"""

from __future__ import annotations

import argparse
import json
import os
import stat
from pathlib import Path
import tempfile
from typing import Any

HEADROOM_PLUGIN = "headroom@headroom-marketplace"
HEADROOM_HOOK_COMMAND = "headroom init hook ensure"
HEADROOM_BASE_URLS = {
    "http://127.0.0.1:8787",
    "http://localhost:8787",
}


def _remove_headroom_hooks(settings: dict[str, Any]) -> bool:
    hooks = settings.get("hooks")
    if not isinstance(hooks, dict):
        return False

    changed = False
    for event, entries in list(hooks.items()):
        if not isinstance(entries, list):
            continue

        kept_entries: list[Any] = []
        for entry in entries:
            if not isinstance(entry, dict) or not isinstance(entry.get("hooks"), list):
                kept_entries.append(entry)
                continue

            command_hooks = entry["hooks"]
            kept_command_hooks = [
                hook
                for hook in command_hooks
                if not (
                    isinstance(hook, dict)
                    and isinstance(hook.get("command"), str)
                    and HEADROOM_HOOK_COMMAND in hook["command"]
                )
            ]
            if len(kept_command_hooks) != len(command_hooks):
                changed = True
            if kept_command_hooks:
                if len(kept_command_hooks) != len(command_hooks):
                    entry = {**entry, "hooks": kept_command_hooks}
                kept_entries.append(entry)

        if kept_entries:
            hooks[event] = kept_entries
        else:
            hooks.pop(event)

    if not hooks:
        settings.pop("hooks")
    return changed


def reconcile_settings(settings: dict[str, Any]) -> bool:
    changed = _remove_headroom_hooks(settings)

    environment = settings.get("env")
    if isinstance(environment, dict) and "ANTHROPIC_BASE_URL" in environment:
        base_url = environment.pop("ANTHROPIC_BASE_URL")
        changed = True
        if base_url in HEADROOM_BASE_URLS:
            if environment.get("ANTHROPIC_AUTH_TOKEN") == "headroom":
                environment.pop("ANTHROPIC_AUTH_TOKEN")
            environment.pop("ENABLE_TOOL_SEARCH", None)
        if not environment:
            settings.pop("env")

    enabled_plugins = settings.get("enabledPlugins")
    if isinstance(enabled_plugins, dict) and enabled_plugins.get(HEADROOM_PLUGIN) is not False:
        if HEADROOM_PLUGIN in enabled_plugins:
            enabled_plugins[HEADROOM_PLUGIN] = False
            changed = True

    return changed


def reconcile_file(path: Path) -> bool:
    if not path.exists():
        return False

    settings = json.loads(path.read_text())
    if not isinstance(settings, dict):
        raise ValueError(f"{path} must contain a JSON object")
    if not reconcile_settings(settings):
        return False

    mode = stat.S_IMODE(path.stat().st_mode)
    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        dir=path.parent,
        prefix=f".{path.name}.",
        delete=False,
    ) as temporary:
        json.dump(settings, temporary, indent=2)
        temporary.write("\n")
        temporary_path = Path(temporary.name)

    os.chmod(temporary_path, mode)
    os.replace(temporary_path, path)
    return True


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--settings",
        type=Path,
        default=Path.home() / ".claude" / "settings.json",
        help="Claude Code user settings file",
    )
    return parser.parse_args()


def main() -> None:
    path = parse_args().settings.expanduser()
    changed = reconcile_file(path)
    print("removed global Claude gateway routing" if changed else "Claude direct-routing policy already current")


if __name__ == "__main__":
    main()
