# Wave 2026-09-10 — the two gaps wave 2026-09-09 left at the top

Two workers, one batch, disjoint ownership. Both branch from `main` @
`e69a0ba` (wave 2026-09-09 fully merged and pushed; verify green, harness 85,
packages 483/0, UI 1052/1052). Merge order: whichever is green first;
`main` fast-forwards only when the merged tip is green.

| wave | harness | branch | gaps | owns |
|---|---|---|---|---|
| h1-ui-test-isolation | claude / opus | `kb-h1-ui-tests` | `01M1XA98A0A7PWEPMHG2T4R5GP` `01M1X8VQT1P6E45NBTQEQ96YDR` | `packages/app/ui/vite.config.ts` test block, `ui/src/test-setup.ts`, `ui/src/test-support/**`, every `*.test.ts(x)` under `ui/src`, `packages/app/test-kit/tests/dst.test.ts`, `tools/kb/package.json` test scripts, `actions/mutations.ts` **only** if the root cause is there |
| h2-text-host-primitive | cursor / grok 4.6 | `kb-h2-text-host` | `01M1RXMRJA3ZRAWPTB0ZH5YEYG` `01M1RXNGSJT2J2VHDSYY7QJSD3` | `components/outline/{field-value,node-content}.tsx`, the new `components/ui/node-text-host.tsx`, a new `stores/` binding hook, `components/canvas/canvas-card.tsx`, the six `NodeContent` importers' import lines, baseline via `harness:snapshot` on the `duplicates:` drop |

Neither worker edits `harness/src/constraints.ts`, `.oxlintrc.json`, or the
baseline by hand. h1 touches no component; h2 touches no test config. If a
fix needs the other's files, finish everything else and report the seam.

Briefs: `briefs/h1-ui-test-isolation.md`, `briefs/h2-text-host-primitive.md`.
Reports land in `reports/`.

## Close-out

Both waves merged; both reviewers' verdict MERGE against Rule 1.

| wave | tip | merged as | gaps |
|---|---|---|---|
| h1-ui-test-isolation | `833420a` | fast-forward (`main` had not moved) | `01M1XA98A0A7PWEPMHG2T4R5GP` re-scoped and done, `01M1X8VQT1P6E45NBTQEQ96YDR` done |
| h2-text-host-primitive | `f3ad948` | merge `e642fa4`; `docs/kb/rules.md` regenerated, `.kb/nodes.jsonl` by the driver | `01M1RXMRJA3ZRAWPTB0ZH5YEYG` done, `01M1RXNGSJT2J2VHDSYY7QJSD3` done |

**h1's finding.** The gap's stated mechanism was wrong: `vp test` forks a
process per file, so no two UI test files ever share a store. The reds were
wall clock inside one file — `activateNode` arms a 250 ms
`fallBackFromMissingHost`, and suites that render one row or none never
mounted a text host for the row a chord crossed to. One `test-support`
helper restores that invariant; the polling helper that had been outrunning
the timer is deleted and the assertions read the store once. Load matrices
went UI 3/5, packages 2/5 → 5/5, 5/5. DST scenarios carry a measured
32 s budget in the file. Nothing in the vitest config changed.

**h2's shape.** `NodeTextHost` in `components/ui/` takes everything as props;
`useNodeTextHostBinding` in `stores/` supplies the store half; outline and
canvas each pass their two `mutations.*` callbacks because no shared zone may
import both `stores` and `actions`. `ui-boundaries` 8 → 6 sanctioned
breaches, zero new rows or markers; the `NodeContent|NodeTextHost` knip
duplicate is gone.

**Coordinator fix-up.** h2's hook took `(nodeId, instanceKey)` and only
handed them back — a signature the brief itself named. Dropped at merge;
noted in `reports/h2.md`.

**Dispatch notes.** `run-create` takes `--objective`, not `--title`; two tasks
created before the run existed landed in the previous wave's run and cannot
be updated from a terminal bound to this one — they sit `ready` in
`run_a9712d937346`, harmless. Cursor's agent blocks on a workspace-trust
prompt on a fresh worktree; answered with `orca terminal send --text a`,
then the dispatch was retried with `--retry-of` on the same terminal. Grok
hit one transient "High Load" mid-turn and resumed on a nudge.

Gates on the merged tip: verify green (harness 85), packages 483/0, UI
117/117 files, 1054/1054. Store: 83 gaps, 50 done, 33 open (from 46 / 37).
