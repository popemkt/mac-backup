import re
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
PROXY = LaunchdListenerCheck(
    kind="launchd_listener",
    label="org.nixos.local-proxy",
    domain="system",
    expected_argv=ARGV,
    port=443,
    addresses=["127.0.0.1", "::1"],
)

# Rows as macOS `netstat -anv -p tcp` prints them (columns after the state
# trimmed to the ones the parser reads past).
HEADER = (
    "Active Internet connections (including servers)\n"
    "Proto Recv-Q Send-Q  Local Address          Foreign Address        (state)  "
    "rxbytes txbytes rhiwat shiwat process:pid state options gencnt flags flags1\n"
)


def row(local: str, process: str, pid: int, proto: str = "tcp4") -> str:
    return (
        f"{proto}       0      0  {local:<22} *.*                    LISTEN   "
        f"0 0 131072 131072 {process}:{pid}  00100 00000006 00000000003cab9e 00000001\n"
    )


def netstat(*rows: str) -> NativeResult:
    return NativeResult(0, HEADER + "".join(rows), "")


def run(check: LaunchdListenerCheck, listeners: NativeResult, job: str = JOB) -> str:
    with patch("system_setup.checks.run_native") as native:
        native.side_effect = [NativeResult(0, job, ""), listeners]
        result = run_check(check)
        assert native.call_args_list[1].args[0] == ["/usr/sbin/netstat", "-anv", "-p", "tcp"]
        return result


def test_launchd_listener_requires_the_declared_job_to_own_the_port() -> None:
    other = row("127.0.0.1.9001", "Google Chrome Helper", 77)
    assert "owns port 9000" in run(CHECK, netstat(other, row("127.0.0.1.9000", "bun", 1234)))


def test_a_system_daemon_is_read_from_the_system_domain_at_its_exact_addresses() -> None:
    listeners = netstat(row("127.0.0.1.443", "caddy", 1234), row("::1.443", "caddy", 1234, "tcp6"))
    with patch("system_setup.checks.run_native") as native:
        native.side_effect = [NativeResult(0, JOB, ""), listeners]
        assert "at 127.0.0.1, ::1" in run_check(PROXY)
        assert native.call_args_list[0].args[0] == [
            "/bin/launchctl",
            "print",
            "system/org.nixos.local-proxy",
        ]


@pytest.mark.parametrize(
    "rows",
    [
        [row("127.0.0.1.443", "caddy", 1234)],
        [row("*.443", "caddy", 1234), row("*.443", "caddy", 1234, "tcp6")],
        [
            row("127.0.0.1.443", "caddy", 1234),
            row("::1.443", "caddy", 1234, "tcp6"),
            row("192.168.1.5.443", "caddy", 1234),
        ],
    ],
)
def test_a_listener_off_its_declared_addresses_fails(rows: list[str]) -> None:
    with pytest.raises(CheckFailed, match=re.escape("not exactly 127.0.0.1, ::1")):
        run(PROXY, netstat(*rows))


def test_another_process_on_the_port_fails() -> None:
    listeners = netstat(
        row("127.0.0.1.443", "caddy", 1234),
        row("::1.443", "caddy", 1234, "tcp6"),
        row("*.443", "squatter", 999),
    )
    with pytest.raises(CheckFailed, match="also bound by pid 999"):
        run(PROXY, listeners)


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


@pytest.mark.parametrize(
    "listeners",
    [
        NativeResult(1, "", "netstat: failed"),
        netstat(),
        netstat(row("127.0.0.1.9000", "bun", 9999)),
        netstat(row("127.0.0.1.19000", "bun", 1234)),
    ],
)
def test_another_server_cannot_mask_a_stalled_launchd_job(listeners: NativeResult) -> None:
    with pytest.raises(CheckFailed, match=r"not listening|cannot list|also bound"):
        run(CHECK, listeners)
