# Interaction Surfaces

This repo is the durable record of an intent => behavior translation process.
Admission to it is gated by one script — `intent/gate.sh` — and every way an
actor can touch the repo (a *surface*) routes there through a thin shim.

Rules:

- New surface (new harness, new automation, new entry point) => add its shim
  **and** a row here, in the same commit.
- `intent/gate.sh audit` parses the table: every backticked path in the Shim
  column must exist and reference `gate.sh`. Run it after changing any shim.
- Shims carry no logic. All admission logic lives in the gate.

| Surface | Actor class | Shim | Admission | Enforcement |
|---|---|---|---|---|
| direnv shell entry | human, interactive shell | `.envrc` | session | soft — advisory print; flake devShell supplies tools |
| Claude Code session | agent (Claude Code) | `.claude/hooks/require-tools.sh` | session + edit deny | hard within this harness (SessionStart context, PreToolUse deny on Edit/Write) |
| Other agent harnesses | agent (Codex, Cursor, ...) | `AGENTS.md` | session | protocol — instruction-following only |
| git commit | any actor that persists changes | `.githooks/pre-commit` | record | hard, universal locally (`core.hooksPath` — bypassable via `--no-verify`) |
| git push to origin | any actor that replicates | none yet | record | planned — branch protection + required CI check |
| raw filesystem edits | any | none | — | unenforceable on a plain filesystem; ephemeral until commit. Capture option: jj op log / DeltaDB — see intent decisions |

Enforcement ladder: soft shims fail early with good errors; the hard guarantee
comes from record admission (commit) and, once wired, remote replication
(push). A surface with no shim is either covered by those choke points or
explicitly documented above as unenforceable.
