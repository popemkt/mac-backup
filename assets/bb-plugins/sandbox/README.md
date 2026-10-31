# sandbox (bb plugin)

Isolated, resource-capped sandboxes behind one provider contract, an admission queue that keeps
the host under its budget, and declarative AgentSpec runs that fan agent work out through both.
The design, its decisions and what is deliberately left out are in
[docs/research/2026-10-31-sandboxes.md](../../../docs/research/2026-10-31-sandboxes.md) §8–§15;
usage is [skills/sandbox/SKILL.md](skills/sandbox/SKILL.md).

| File | Role |
|---|---|
| `core/spec.ts` | zod schemas: SandboxSpec, ExecRequest, AgentSpec (the one home of their shape) |
| `core/contract.ts` | the provider contract and capability check |
| `core/providers/` | the registry (`index.ts`) and the local provider (`bwrap.ts`) |
| `core/queue.ts` | admission: sandbox count, CPU and memory budget, priority, pressure |
| `core/policy.ts` | the host policy, `/etc/bb-sandbox/policy.json` (written by the `sandboxes` NixOS stack) |
| `core/service.ts` | records, lifecycle, lifetimes, reconciliation after a reload |
| `core/ops.ts` | the op table: every operation once, with its input schema and CLI flags |
| `core/agent/` | AgentSpec files and matrices, the runner, ATIF trajectories |
| `server.ts` | generates `bb sandbox …`, the `sandbox_*` tools and `POST /op` from the op table |
| `sdk/index.ts` | the TypeScript SDK, a thin client of `POST /op` |

Tests: `npm test` (the contract suite runs over every registered provider; the bubblewrap one
needs `bwrap` on PATH or `BWRAP=<path>`), `npm run typecheck`, `npm run lint`.

Try a change without a rebuild: `bb-plugins-sync --path <worktree>/assets/bb-plugins/sandbox`.
