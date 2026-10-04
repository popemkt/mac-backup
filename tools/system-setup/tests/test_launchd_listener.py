from unittest.mock import patch

import pytest

from system_setup.checks import CheckFailed, run_check
from system_setup.models import LaunchdListenerCheck
from system_setup.native import NativeResult

ARGV = ["/nix/store/example-kb/bin/kb", "--root", "/graphs/home", "ui", "--port", "9000"]
JOB = "state = running\narguments = {\n" + "\n".join(ARGV) + "\n}\npid = 1234\n"
CHECK = LaunchdListenerCheck(
    kind="launchd_listener", label="org.nixos.kb-ui", expected_argv=ARGV, port=9000
)


def test_launchd_listener_requires_the_declared_job_to_own_the_port() -> None:
    with patch("system_setup.checks.run_native") as native:
        native.side_effect = [NativeResult(0, JOB, ""), NativeResult(0, "1234\n", "")]
        assert "owns port 9000" in run_check(CHECK)
        argv = native.call_args_list[1].args[0]
        assert argv == [
            "/usr/sbin/lsof",
            "-nP",
            "-a",
            "-p",
            "1234",
            "-iTCP:9000",
            "-sTCP:LISTEN",
            "-t",
        ]


@pytest.mark.parametrize(
    "job", [NativeResult(1, "", "not loaded"), NativeResult(0, "state = waiting\n", "")]
)
def test_launchd_listener_rejects_missing_or_stopped_jobs(job: NativeResult) -> None:
    with (
        patch("system_setup.checks.run_native", return_value=job),
        pytest.raises(CheckFailed, match=r"not loaded|not running"),
    ):
        run_check(CHECK)


def test_launchd_listener_rejects_an_outdated_command() -> None:
    with (
        patch(
            "system_setup.checks.run_native",
            return_value=NativeResult(0, JOB.replace("/graphs/home", "/graphs/other"), ""),
        ),
        pytest.raises(CheckFailed, match="declared command"),
    ):
        run_check(CHECK)


@pytest.mark.parametrize("listener", [NativeResult(1, "", ""), NativeResult(0, "9999\n", "")])
def test_another_server_cannot_mask_a_stalled_launchd_job(listener: NativeResult) -> None:
    with patch("system_setup.checks.run_native") as native:
        native.side_effect = [NativeResult(0, JOB, ""), listener]
        with pytest.raises(CheckFailed, match="not listening"):
            run_check(CHECK)
