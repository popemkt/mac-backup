# b4-tighten-ui-src — burn the ui `src` ledger to zero

Wave `b4` of `docs/kb/waves/2026-09-03/plan.md`. Harness: claude. Branch from
`kb-wave/2026-09-03` (head includes `c1`: `oxc/no-map-spread` rejected,
refrepo size caps, tests exempt from function-length/callback-nesting).
Scope: `tools/kb/packages/ui/src/**` **excluding** `*.test.ts(x)` and
`tests/` (those are `b5`, running in parallel — touch a test only when a
`src` change forces it). Backend packages are `b6`.

Read first: `CLAUDE.md` (Rule 1, drift markers), `tools/kb/DESIGN.md`
("Ratchet scope", "Size is a signal", "Domain typing"),
`reports/b3-burndown-ui.md` §5 (the per-shape inventory you are closing),
`reports/d2-drain-ui.md`. Run `intent/gate.sh session claude-code` first.

## 0. Owner decisions this wave carries (do not re-litigate)

The owner has decided the previously "needs owner" questions for ui `src`:

- **Ids are never empty strings.** A `string | undefined` binding whose name
  or type says id/key (`nodeId`, `canvasId`, `afterSiblingId`, `focusId`,
  `instanceKey`, anything typed `NodeId`) is tested with `!== undefined`.
  Record this once as an invariant sentence in `DESIGN.md` "Domain typing"
  (one sentence; Track 2 brands `NodeId`, you only state the fact).
- **Display text keeps its semantics exactly.** `if (title)` on user text is
  `title !== undefined && title !== ""`; `x || "Untitled"` stays an
  empty-string fallback. If the same shape recurs ≥ 3 times, one helper in
  `packages/ui/src/lib/` (`textOr(value, fallback)`), never a second.
- **Code paths are tight, not defensive.** kb's functionality is known and
  small. When a check tests a state the types say cannot happen, delete the
  check (that is what `no-unnecessary-condition` is telling you); do not add
  fallbacks for impossible states.
- **The one narrowing helper is `present` from `@kb/model`.** Use it only for
  construction invariants the type system cannot carry; restructure first so
  the invariant disappears (`for … of` / `.entries()` instead of `arr[i]!`,
  a single `map.get(k)` with a guard instead of `has` + `get(k)!`, a guarded
  destructure instead of `match[1]!`).
- **Type assertions become checks or adapters.** `e.target as HTMLElement`
  → one `instanceof` guard helper in `packages/ui/src/lib/dom.ts` (or the
  existing dom module if one exists — find it first) that returns
  `HTMLElement | undefined`; `as FgLink`/`as FgNode` → one typed adapter
  module that wraps `3d-force-graph` and is the only file importing it;
  `e.target.value as ThemePref` → decode with the `Schema.Literal` that the
  const option list already implies, unexpected value = no-op. `node as Text`
  after `nodeType === TEXT_NODE` → a type predicate is acceptable only if it
  performs the check itself.

## 1. Targets (counts at `c1`, ui `src` only)

| Rule | n | Expected end state |
|---|---|---|
| `typescript/strict-boolean-expressions` | 195 | 0 |
| `typescript/no-non-null-assertion` | 91 | 0 |
| `typescript/no-unsafe-type-assertion` | 78 | 0 |
| `typescript/no-unnecessary-condition` | 23 | 0 |
| `eslint/max-depth` (now cap 5) | 2 (`canvas-page.tsx` ~776, ~790) | 0 |
| `eslint/max-params` (cap 5) | 2 | 0 — options object |
| `typescript/no-deprecated` | 7 | 0 |
| `eslint/no-await-in-loop` | 4 | 0 — restructure, else `// eslint-disable-next-line eslint/no-await-in-loop -- <why sequential>` |
| `unicorn/consistent-function-scoping` | 3 | 0 |
| `eslint/max-lines-per-function` (120) | 37 | lower only where a hook or sub-component falls out on its own; do not force splits |
| `eslint/max-lines` (900) | 2 | leave; list them |

`bun run lint` (type-aware) is the measurement; `bun run harness:snapshot`
regenerates `packages/harness/lint-warn-baseline.json` — never hand-edit it.
Do **not** change rule severities or `.oxlintrc.json`; the coordinator
promotes rules at integration once every scope reads zero.

## 2. Rules of the wave

- Rule 1 applies to every fix: a recurring shape gets one owned helper, in
  one place, or the model gets fixed; never a third copy.
- Behaviour changes are allowed only under §0. Every other change is
  behaviour-neutral. List each §0-driven change in the report.
- `bun run verify` green at every commit; `bun run test:ui` green except the
  known `palette-index` 50k perf bar (fails identically on base).
- Commit in small, rule-scoped commits (`refactor(kb-ui): …`). No push.

## 3. Report

`docs/kb/waves/2026-09-03/reports/b4-tighten-ui-src.md`, committed on the
branch: before/after table per rule; the helpers introduced (path, signature,
why one); behaviour changes under §0; anything left with why; remaining
`max-lines-per-function` list.
