# b5-tighten-ui-tests — report

Wave `b5` of `docs/kb-waves/2026-09-03/plan.md`. Harness: cursor (grok 4.6).
Branch `feature/b5-tighten-ui-tests`, child of `kb-wave/2026-09-03` @ `5a052f7`
(c1). Scope: **only** `tools/kb/packages/ui/src/**/*.test.ts`, `*.test.tsx`.
No `packages/ui/tests/**` directory exists. Non-test ui files and every other
package were left alone (`b4` / `b6`). `.kb/nodes.jsonl` was not touched.
`.oxlintrc.json` was not touched. The ledger was regenerated with
`bun run harness:snapshot`, not hand-edited.

Final `bun run verify` (tools/kb): **green**. Harness 44 pass / 0 fail.
`bun run test:ui`: **630/630**. The known `palette-index` 50k perf bar
passed on this run.

---

## 1. Per-rule before / after (ui tests at c1 → this branch)

Counts are oxlint hits in ui **test** files. Workspace ledger after the
snapshot is in parentheses.

| Rule | before (ui tests) | after | workspace ledger |
|---|---:|---:|---|
| `typescript/no-non-null-assertion` | 300 | **0** | 391 → **91** (all remaining are ui src) |
| `typescript/no-unnecessary-condition` | 7 | **0** | 31 → **24** |
| `typescript/strict-boolean-expressions` | 5 | **0** | 200 → **195** |
| `unicorn/consistent-function-scoping` | 5 | **0** | 15 → **10** |
| `typescript/no-deprecated` | 3 | **0** | 12 → **9** (advisory) |

No rule reached 0 in both ui tests and ui src, so nothing was promoted.
`tools/kb/.oxlintrc.json` is unchanged.

---

## 2. How the 300 `!` drained

The repo's one narrowing helper is `present(value, message)` from `@kb/model`.
`@kb/ui` cannot import `@kb/test-kit`; `expectDefined` was not used.

| Fate | n (approx) | Shape |
|---|---:|---|
| Became `present(...)` | **232** call sites | one present per fixture: `map.get`, `.find`, `querySelector`, `localStorage.getItem`, `arr.at(i)` |
| Absorbed by restructure | **~68** former `!` | those 232 presents cover 300 sites because a fixture is bound once and then read by field |

Restructure, not a second helper:

- `expect(x).not.toBeNull()` / `toBeTruthy()` plus `x!` collapsed to
  `const y = present(x, "…")`.
- Repeated `pills[0]!` / `rgb!` / `plan!` / `db!` bound once, then fields
  read off the binding.
- Index access after a bounds check became `.at(i)` + `present`.
- Plan upserts share one finder, `upsertOf(plan, id)`, which is `present` of
  `.find` — the concept is "the upsert with this id", not a second narrowing
  API.

Never `as` in place of `!`. Never `?? fallback` for a missing fixture.

---

## 3. The other four rules

**`no-unnecessary-condition` (7).** Deleted optional chains / `??` that the
typed value already rules out: `textContent.trim()` (happy-dom `string`),
`dom.NodeFilter` and `dom.PointerEvent` without a fallback.

**`strict-boolean-expressions` (5).** Explicit comparisons that preserve
truthiness, including empty string: `selected !== null && selected !== ""`,
and `text !== undefined && text !== "" ? text : id` for ontology labels.
The `Record<string, unknown>` `if (!g.NodeFilter)` became
`if (!("NodeFilter" in g))`.

**`consistent-function-scoping` (5).** Hoisted to module scope:
`fireKey`, `settle`, `seedRefRow`, `selectAt`, `wire`.

**`no-deprecated` (3).**

- `getNextVisibleNode` / `getPreviousVisibleNode` →
  `getNextVisibleInstance` / `getPreviousVisibleInstance` with
  `outlineInstanceKey` (same neighbour ids).
- `cursorPosition` → `pendingCaret` asserted inside the same `act()` as
  `activateNode`, before the mounted host consumes the intent. That is the
  outline contract; `cursorPosition` remains a canvas projection.

---

## 4. What's left

| Site | Why this wave did not change it |
|---|---|
| ui **src** `no-non-null-assertion` (91) | `b4`. Not test files. |
| ui src remainder of the other four rules | `b4`. |
| Backend remainder | already `error` on backend-all / backend-src; not this scope. |
| `let resolve!:` definite assignment in two tests | different syntax; oxlint `no-non-null-assertion` does not count it. |
| Rule promotions | none. Every drained rule still has ui-src (or backend) hits. |

No `#gap` nodes. No skipped tests.
