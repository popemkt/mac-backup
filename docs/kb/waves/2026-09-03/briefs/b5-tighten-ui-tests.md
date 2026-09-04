# b5-tighten-ui-tests — ui test files off the ledger

Wave `b5` of `docs/kb/waves/2026-09-03/plan.md`. Harness: cursor. Branch
from `kb-wave/2026-09-03` (head includes `c1`). Scope: **only**
`tools/kb/packages/ui/src/**/*.test.ts`, `*.test.tsx`, and
`tools/kb/packages/ui/tests/**`. Do not edit non-test ui files (`b4` owns
them, in parallel) or any other package (`b6`).

Read first: `CLAUDE.md` Rule 1, `tools/kb/DESIGN.md` "Testing doctrine",
`reports/b3-burndown-ui.md` §5a. Run `intent/gate.sh session cursor` first.

## 1. Targets (ui test files, counts at `c1`)

| Rule | n | Fix |
|---|---|---|
| `typescript/no-non-null-assertion` | 300 | see §2 |
| `typescript/no-unnecessary-condition` | 7 | delete the impossible branch, or fix the type of the fixture |
| `typescript/strict-boolean-expressions` | 5 | explicit comparison preserving semantics |
| `unicorn/consistent-function-scoping` | 5 | hoist the helper to module scope |
| `typescript/no-deprecated` | 3 | use the replacement API |

## 2. The `!` policy

The repo has **one** narrowing helper: `present(value, message)` from
`@kb/model` (`packages/model/src/present.ts`). `expectDefined` in
`@kb/test-kit` is being retired by `b6`; do not import it, and `@kb/ui`
cannot reach `@kb/test-kit` anyway (scope matrix).

For each `x!`:
1. If the test already asserts presence (`expect(x).toBeDefined()`), replace
   the pair with `const y = present(x, "<what the test needs>")`.
2. If the `!` is on `arr[i]` / `map.get(k)` / `match[1]`, prefer restructuring
   the fixture access (destructure, `.at()` + `present`, iterate) over
   sprinkling `present` per line — one `present` per fixture, not per field.
3. Never replace `!` with `as`. Never add `?? fallback` in a test: a missing
   fixture value must fail, not pass silently.

## 3. Rules of the wave

- Test semantics unchanged: every test still asserts the same thing.
- Do not change rule severities or `.oxlintrc.json`; do not hand-edit
  `packages/harness/lint-warn-baseline.json` — run `bun run harness:snapshot`
  (from `tools/kb`) after fixes.
- `bun run verify` and `bun run test:ui` green (known `palette-index` 50k perf
  bar excepted). Commit style `refactor(kb-ui): …`. No push.

## 4. Report

`docs/kb/waves/2026-09-03/reports/b5-tighten-ui-tests.md` committed on the
branch: before/after per rule, how many `!` became `present` vs restructure,
anything left with why.
