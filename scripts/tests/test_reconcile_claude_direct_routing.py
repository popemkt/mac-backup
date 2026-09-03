from __future__ import annotations

import copy
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).parents[1]))

import reconcile_claude_direct_routing as routing


class ReconcileSettingsTest(unittest.TestCase):
    def test_removes_headroom_routing_without_touching_other_settings(self) -> None:
        settings = {
            "env": {
                "ANTHROPIC_BASE_URL": "http://127.0.0.1:8787",
                "ANTHROPIC_AUTH_TOKEN": "headroom",
                "ENABLE_TOOL_SEARCH": "true",
                "KEEP": "value",
            },
            "hooks": {
                "SessionStart": [
                    {
                        "matcher": "startup|resume",
                        "hooks": [
                            {
                                "type": "command",
                                "command": "/Users/me/.local/bin/headroom init hook ensure --profile init-user",
                                "timeout": 15,
                            }
                        ],
                    },
                    {
                        "hooks": [
                            {"type": "command", "command": "keep-session-hook"},
                            {"type": "command", "command": "headroom init hook ensure"},
                        ]
                    },
                ],
                "PreToolUse": [
                    {
                        "matcher": "Bash",
                        "hooks": [{"type": "command", "command": "keep-tool-hook"}],
                    }
                ],
            },
            "enabledPlugins": {
                routing.HEADROOM_PLUGIN: True,
                "other@example": True,
            },
            "extraKnownMarketplaces": {"headroom-marketplace": {"source": "github"}},
        }

        self.assertTrue(routing.reconcile_settings(settings))
        self.assertEqual({"KEEP": "value"}, settings["env"])
        self.assertEqual(
            [{"hooks": [{"type": "command", "command": "keep-session-hook"}]}],
            settings["hooks"]["SessionStart"],
        )
        self.assertEqual("keep-tool-hook", settings["hooks"]["PreToolUse"][0]["hooks"][0]["command"])
        self.assertFalse(settings["enabledPlugins"][routing.HEADROOM_PLUGIN])
        self.assertTrue(settings["enabledPlugins"]["other@example"])
        self.assertIn("headroom-marketplace", settings["extraKnownMarketplaces"])

    def test_removes_any_global_gateway_but_preserves_unrelated_environment(self) -> None:
        settings = {
            "env": {
                "ANTHROPIC_BASE_URL": "https://gateway.example.com",
                "ENABLE_TOOL_SEARCH": "auto",
                "ANTHROPIC_AUTH_TOKEN": "real-token",
            }
        }

        self.assertTrue(routing.reconcile_settings(settings))
        self.assertEqual(
            {
                "ENABLE_TOOL_SEARCH": "auto",
                "ANTHROPIC_AUTH_TOKEN": "real-token",
            },
            settings["env"],
        )

    def test_is_idempotent_when_direct_routing_policy_is_current(self) -> None:
        settings = {
            "hooks": {
                "SessionStart": [
                    {"hooks": [{"type": "command", "command": "keep-session-hook"}]}
                ]
            },
            "enabledPlugins": {
                routing.HEADROOM_PLUGIN: False,
                "other@example": True,
            },
        }
        before = copy.deepcopy(settings)

        self.assertFalse(routing.reconcile_settings(settings))
        self.assertEqual(before, settings)

    def test_reconcile_file_writes_once_then_becomes_a_noop(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "settings.json"
            path.write_text(
                '{"env":{"ANTHROPIC_BASE_URL":"http://localhost:8787"},'
                '"enabledPlugins":{"headroom@headroom-marketplace":true}}\n'
            )

            self.assertTrue(routing.reconcile_file(path))
            first_result = path.read_text()
            self.assertFalse(routing.reconcile_file(path))
            self.assertEqual(first_result, path.read_text())


if __name__ == "__main__":
    unittest.main()
