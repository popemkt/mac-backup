from __future__ import annotations

import json
import os
import sys
from typing import Annotated

import typer
from rich.console import Console
from rich.table import Table

from system_setup.checks import CheckFailed, evaluate, run_check
from system_setup.manifest import ManifestError, load_manifest
from system_setup.models import CheckResult, Integration, Manifest
from system_setup.native import NativeCommandError, run_native

app = typer.Typer(no_args_is_help=True, help="Inspect and complete machine onboarding.")
console = Console()
error_console = Console(stderr=True)

STATE_MARKS = {
    "ready": "[green]✓[/green]",
    "action-needed": "[yellow]![/yellow]",
    "blocked": "[dim]·[/dim]",
    "error": "[red]✗[/red]",
}


def _load() -> Manifest:
    try:
        return load_manifest()
    except ManifestError as error:
        error_console.print(f"[red]error:[/red] {error}")
        raise typer.Exit(code=1) from error


def _required_incomplete(results: list[CheckResult]) -> bool:
    return any(result.required and result.state != "ready" for result in results)


def _render_status(manifest: Manifest, results: list[CheckResult]) -> None:
    table = Table(title=f"System setup · {manifest.host.name} ({manifest.host.role})")
    table.add_column("State", no_wrap=True)
    table.add_column("Integration")
    table.add_column("Required by")
    table.add_column("Detail")
    for result in results:
        required_by = ", ".join(result.required_by) or ("host" if result.required else "optional")
        table.add_row(STATE_MARKS[result.state], result.name, required_by, result.detail)
    console.print(table)


@app.command()
def status(
    json_output: Annotated[
        bool, typer.Option("--json", help="Emit stable machine-readable JSON.")
    ] = False,
    advisory: Annotated[
        bool,
        typer.Option("--advisory", help="Report incomplete setup without a nonzero exit."),
    ] = False,
) -> None:
    """Show every declared integration without changing the machine."""
    manifest = _load()
    results = evaluate(manifest)
    if json_output:
        typer.echo(
            json.dumps(
                {
                    "schema_version": 1,
                    "host": manifest.host.model_dump(),
                    "ready": not _required_incomplete(results),
                    "results": [result.model_dump() for result in results],
                },
                indent=2,
                sort_keys=True,
            )
        )
    else:
        _render_status(manifest, results)
        if _required_incomplete(results):
            console.print("Run [bold]system-setup next[/bold] for the next required action.")
    if not advisory and _required_incomplete(results):
        raise typer.Exit(code=2)


@app.command(name="next")
def next_action() -> None:
    """Explain the first unresolved required setup action."""
    manifest = _load()
    results = evaluate(manifest)
    integration_by_id = {integration.id: integration for integration in manifest.integrations}
    for result in results:
        if not result.required or result.state == "ready":
            continue
        integration = integration_by_id[result.id]
        console.print(f"[bold]{integration.name}[/bold]")
        console.print(integration.enrollment.instructions)
        if integration.enrollment.kind != "none":
            console.print(f"Run: [bold]system-setup enroll {integration.id}[/bold]")
        if integration.enrollment.url:
            console.print(f"Manual URL: {integration.enrollment.url}")
        console.print(f"Recovery: {integration.recovery}")
        return
    console.print("[green]All required setup is ready.[/green]")


def _find_integration(manifest: Manifest, identifier: str) -> Integration:
    for integration in manifest.integrations:
        if integration.id == identifier:
            return integration
    choices = ", ".join(integration.id for integration in manifest.integrations)
    error_console.print(f"[red]error:[/red] unknown integration {identifier!r}; choose: {choices}")
    raise typer.Exit(code=2)


@app.command()
def enroll(
    identifier: Annotated[str, typer.Argument(help="Integration ID from system-setup status.")],
    open_manual: Annotated[
        bool, typer.Option("--open/--no-open", help="Open manual control-plane URLs.")
    ] = True,
) -> None:
    """Run one explicitly requested interactive enrollment action."""
    manifest = _load()
    integration = _find_integration(manifest, identifier)
    results = {result.id: result for result in evaluate(manifest)}
    blockers = [
        dependency for dependency in integration.depends_on if results[dependency].state != "ready"
    ]
    if blockers:
        error_console.print(f"[yellow]blocked:[/yellow] resolve {', '.join(blockers)} first")
        raise typer.Exit(code=2)

    action = integration.enrollment
    console.print(action.instructions)
    try:
        if action.kind == "none":
            raise typer.Exit(code=2)
        if action.kind == "manual":
            if action.url and open_manual:
                run_native(["/usr/bin/open", action.url], capture=False)
            console.print("Complete the control-plane action, then run system-setup verify.")
            return
        if not sys.stdin.isatty():
            error_console.print("[red]error:[/red] enrollment requires an interactive terminal")
            raise typer.Exit(code=2)
        run_native(action.argv, capture=False, timeout_seconds=None)
        detail = run_check(integration.check)
        console.print(f"[green]ready:[/green] {detail}")
    except (NativeCommandError, FileNotFoundError, CheckFailed) as error:
        error_console.print(f"[red]enrollment failed:[/red] {error}")
        raise typer.Exit(code=1) from error


@app.command()
def verify(
    identifier: Annotated[
        str | None, typer.Argument(help="Optional integration ID; defaults to all required items.")
    ] = None,
    include_optional: Annotated[
        bool, typer.Option("--all", help="Include optional integrations.")
    ] = False,
) -> None:
    """Fail unless the selected integrations are operationally ready."""
    manifest = _load()
    results = evaluate(manifest)
    if identifier is not None:
        _find_integration(manifest, identifier)
        selected = [result for result in results if result.id == identifier]
    elif include_optional:
        selected = results
    else:
        selected = [result for result in results if result.required]
    _render_status(manifest, selected)
    if any(result.state != "ready" for result in selected):
        raise typer.Exit(code=2)


def main() -> None:
    os.environ.setdefault("PYTHONUTF8", "1")
    app()


if __name__ == "__main__":
    main()
