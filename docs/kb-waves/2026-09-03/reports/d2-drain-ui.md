# d2-drain-ui — report

Wave `d2` of `docs/kb-waves/2026-09-03/plan.md` (§d2, Appendix A.4/A.5).
Harness: claude (opus), worktree `d2-drain-ui`, branch `feature/d2-drain-ui`
stacked on `feature/g2-strict-stack` (`cd6a5b9`).
Scope: `tools/kb/packages/ui` only. 11 commits, `bun run verify` green.

---

## 1. Headline

| | before (`cd6a5b9`) | after |
|---|---|---|
| oxlint findings in `@kb/ui` | 1378 | **881** |
| of which in `src/` (not tests) | — | 532 |
| oxlint **errors**, workspace | 0 | **0** |
| rules at 0 in ui that were not | — | **19** |
| rules promoted `warn` → `error` | — | **11** |
| `#gap` nodes created | 0 | **30** |
| ratchet baseline rules (blocking) | 64 | 56 |
| `typescript/no-deprecated` (advisory, workspace) | 104 | 12 |

`bun run verify` (typecheck → lint → fmt:check → knip → harness): **green**,
36/36 harness tests. `bun run test:ui`: 630 tests, green — modulo two
load-sensitive tests described in §6.

## 2. Per-rule before/after (ui)

Rules the wave moved. `→ error` marks a promotion, each with red-then-green
evidence in §4.

| Rule | before | after | how |
|---|---|---|---|
| `typescript/no-unnecessary-type-assertion` | 116 | **0** | `oxlint --fix` |
| `typescript/no-unnecessary-type-conversion` | 21 | **0** | `--fix-suggestions` |
| `typescript/consistent-return` | 17 | **0** | explicit `return undefined` in effect callbacks; `never` default in the two value-producing switches |
| `unicorn/no-array-sort` | 61 | **0** | `toSorted` (unblocked by the `lib` bump, §3) |
| `typescript/no-deprecated` (advisory) | 102 | **10** | 92 phosphor `*Icon` renames; 10 gapped |
| `typescript/require-await` | 73 | **0** | test-file override (§7 — a rule-scope call, not a drain) |
| `eslint/complexity` | 23 | **0** | 23 disables, 23 `#gap` nodes |
| `eslint/default-case` | 6 | **0** | `// no default` on exhaustive unions; one real default |
| `eslint/no-console` | 9 | **0** | one output seam, `packages/ui/src/lib/log.ts` |
| `eslint/no-shadow` | 8 | **0** | renames |
| `typescript/consistent-type-imports` | 8 | **0** | inline `import()` types hoisted |
| `react/only-export-components` | 7 | **0** → error | `allowConstantExport` + 5 helper moves |
| `react/no-array-index-key` | 7 | **0** → error | 1 real key; 6 disables + 1 gap |
| `promise/always-return` | 7 | **0** → error | 7 disables + 1 gap (oxlint lacks `ignoreLastCallback`) |
| `typescript/no-explicit-any` | 6 | **0** | six `as any` casts were unnecessary |
| `typescript/no-redundant-type-constituents` | 4 | **0** | `LensRenderer` derives from `LENS_RENDERERS` |
| `unicorn/prefer-add-event-listener` | 4 | **0** → error | 4 disables + 1 gap (the `WsLike` port) |
| `react-hooks/rules-of-hooks` | 3 | **0** → error | one real conditional-hook bug in `node-block.tsx` |
| `eslint/no-eq-null` | 3 | **0** | `=== null`, or `??` where the runtime value can be `undefined` |
| `unicorn/no-new-array` | 2 | **0** → error | 2 disables + 1 gap (measured perf bar) |
| `unicorn/no-useless-spread` | 2 | **0** → error | `Array.from(map)` states the snapshot intent |
| `react/no-did-update-set-state` | 2 | **0** → error | both boundaries reset via `getDerivedStateFromProps` |
| `typescript/require-array-sort-compare` | 2 | **0** | keyed comparator |
| `typescript/no-unnecessary-boolean-literal-compare` | 2 | **0** | `oxlint --fix` |
| `typescript/no-base-to-string` | 1 | **0** | stub records `Request.url` |
| `typescript/await-thenable` | 1 | **0** | `?? Promise.resolve()` |
| `unicorn/no-array-reverse` | 1 | **0** | `toReversed` |
| `react/no-children-prop` | 0 | **0** → error | already 0; promoted |
| `typescript/consistent-type-assertions` | 0 | **0** → error | already 0; promoted |
| `unicorn/no-useless-fallback-in-spread` | 0 | **0** → error | already 0; promoted |
| `typescript/no-unused-vars` | 0 | **0** | already `error` and 0 at base; the plan's count of 11 predates `w1` |

Not moved (see §7 for why each):

| Rule | ui before | ui after | be | state |
|---|---|---|---|---|
| `typescript/no-non-null-assertion` | 400 | 391 | 245 | lane:R — 300 of 391 are in tests |
| `typescript/strict-boolean-expressions` | 245 | 245 | 101 | lane:R |
| `typescript/no-unsafe-type-assertion` | 94 | 94 | 49 | lane:R |
| `typescript/no-unnecessary-condition` | 49 | 49 | 16 | lane:R |
| `eslint/max-depth` | 12 | 12 | 6 | lane:R |
| `oxc/no-map-spread` | 9 | 9 | 6 | lane:R — recommend rejecting |
| `eslint/no-await-in-loop` | 4 | 4 | 3 | lane:R — ordered protocols |
| `eslint/max-lines-per-function` | 55 | 55 | 22 | lane:R forever (by plan) |
| `unicorn/consistent-function-scoping` | 8 | 8 | 7 | lane:R forever (by plan) |
| `eslint/max-params`, `eslint/max-lines` | 2, 2 | 2, 2 | 0, 0 | lane:R forever (by plan) |

## 3. Two changes worth calling out before the detail

**`@kb/ui` moved from `lib: ES2022` to `lib: ESNext`.** Every other package in
the workspace is already `ESNext`, and `@kb/ui`'s own `target` was `ESNext`
while its `lib` was not — the package contradicted itself. `unicorn/no-array-sort`
(61 sites) and `unicorn/no-array-reverse` want `toSorted` / `toReversed`, which
are ES2023, so the lane was unreachable until this was aligned. `lib` affects
typechecking only, never emit; Vite's build target is a separate setting and is
untouched. It does raise the browser floor for the *typed* API surface to
Baseline 2023 (Chrome 110 / Safari 16.4), which is fine for a tool served on
127.0.0.1 but is a real decision, so it is stated here rather than buried.

**`packages/ui/src/lib/log.ts` is the ui's one console seam.** `no-console` had
9 sites across 6 files. Rather than 9 disables or 6 override entries, the ui now
has `logWarn` / `logError`, and the `no-console` override in `.oxlintrc.json`
names exactly that file — the same shape `packages/cli/src/output.ts` already
has for the CLI.

## 4. Red-then-green evidence for every promotion

Each red case was written into a scratch file under `packages/ui/src`, linted,
and deleted; green is the full workspace at 0 errors afterwards.

| Rule promoted | Red case | Red output |
|---|---|---|
| `typescript/consistent-type-assertions` | `export const y = <number>x;` | `error typescript(consistent-type-assertions): Use \`as number\` instead of \`<number>\`.` |
| `unicorn/no-new-array` | `new Array(5)` | `error unicorn(no-new-array): Do not use \`new Array(singleArgument)\`.` |
| `unicorn/no-useless-spread` | `[...[1, 2, 3]]` | `error unicorn(no-useless-spread): Using a spread operator here creates a new array unnecessarily.` |
| `unicorn/no-useless-fallback-in-spread` | `{ ...(o ?? {}) }` | `error unicorn(no-useless-fallback-in-spread): Empty fallbacks in spreads are unnecessary` |
| `react/no-children-prop` | `<div children={<span />} />` | `error react(no-children-prop): Avoid passing children using a prop.` |
| `react/no-did-update-set-state` | `componentDidUpdate() { this.setState(…) }` | `error react(no-did-update-set-state): Do not use \`setState\` in \`componentDidUpdate\`.` |
| `react/no-array-index-key` | `xs.map((x, i) => <li key={i}>…)` | `error react(no-array-index-key): Usage of Array index in keys is not allowed` |
| `promise/always-return` | `void p.then(() => { g(); })` | `error promise(always-return): Each then() should return a value or throw` |
| `react/only-export-components` | a helper + a component in one file | `error react(only-export-components): Fast refresh only works when a file only exports components.` |
| `react/rules-of-hooks` | `useState` after an early return | `error react-hooks(rules-of-hooks): React Hook "useState" is called conditionally.` |
| `unicorn/prefer-add-event-listener` | `ws.onopen = () => {…}` | `error unicorn(prefer-add-event-listener): Prefer \`addEventListener()\` over their \`on\`-function counterparts.` |

Two promotions the plan asked for were **not** made, because the option the plan
specifies breaks a package outside this wave's scope:

- `typescript/consistent-type-assertions` was promoted at default options, not
  with `objectLiteralTypeAssertions: "never"` — that option fails
  `packages/operations/src/session.ts:56`.
- `eslint/max-nested-callbacks` stayed at `warn`. The plan wants `["error", 4]`;
  at 4 it fails `packages/cli/src/cli.ts:681` (5 levels). Promoting it to plain
  `"error"` would have used oxlint's default max of 10, which is a promotion in
  name only — the rule would read as covered while checking nothing this repo
  would ever hit. A named gap beats that, so it is listed under §7.

## 5. `#gap` nodes (30)

All created through `kb add --tag gap` with `expected` / `current` / `impact` /
`closes`. The `#gap` tag and its four fields were minted with **the same node
ids r2 used** (`kb tag define gap --id 01M1M029QRJ6KP5NYK28WAEH20`, fields
`01M1M01QDFMQYJQCPAD8NG4C0Z` / `…QTWDC6JP1T1QN2SFRN5` / `…RB2P8V85GCS46SW7MYJ` /
`…RWT1ABKJHT5DRKW1Q2T`), so the two branches describe one concept rather than
two. **Merge note for the coordinator:** r2's `gap` tag node also lists a fifth
field (`rule`, `01M1M01SAAA17AM22SX9HZCCG1`, a ref to `#rule`); take r2's
version of that one line, and this branch's gap instance nodes.

### complexity (23, one per disabled site)

| Node | Site |
|---|---|
| `01M1MGCDRS0K28YBF1Q86YY61S` | `use-selection-keymap.ts` `applySelectionAction` (30) |
| `01M1MGCEBYDFRNJX1JKXXN825H` | `graph-lens.ts` `parsePerspective` (27) |
| `01M1MGCF0ECBDEPTHPKMSQ4YFD` | `node-command-palette.tsx` `NodeCommandPalette` (24) |
| `01M1MGCFTMWY5EYHEWP9QVH8Z9` | `graph-page.tsx` `GraphPage` (35) |
| `01M1MGCGKSAJSB6GFR30SZNATJ` | `node-block.tsx` `NodeBlock` (28) |
| `01M1MGCH7SD69CRSSV75X789QW` | `selection-keymap.ts` `mapSelectionKey` (46) |
| `01M1MGCHQH499KS0RV9J461F73` | `field-row.tsx` `FieldRow` (27) |
| `01M1MGCJAKKST0C1R54VVX9HPX` | `view-config.ts` `getViewConfig` (45) |
| `01M1MGCJYB7PZXM68T4AVBECYG` | `view-config.ts` `resolveTableColumns` (21) |
| `01M1MGCKK69CQBZQYAKRMESW5S` | `view-config.ts` sort comparator (29) |
| `01M1MGCM9RWXE3CYANZK5K4KC0` | `md-inline.ts` `parseOnce` (41) |
| `01M1MGCMX698XJ0VDCSVQBGSQB` | `bullet.tsx` `Bullet` (46) |
| `01M1MGCND3KMDYJPSSMD2E4Q9J` | `field-value.tsx` `PropValueEditor` (24) |
| `01M1MGCP1EF5GM8NA32JEJRJ9Q` | `field-value.tsx` `RefEditor` (22) |
| `01M1MGCPJTV66QSFCR44XG29YM` | `sigma-graph.tsx` lifecycle effect (32) |
| `01M1MGCQ3JT5GE3FY5XJ9EB67Q` | `cluster-graph.tsx` lifecycle effect (28) |
| `01M1MGCQKVQCG3H9YYCWQX0A0Y` | `use-node-keydown.ts` keydown callback (64) |
| `01M1MGCR50QEXX7R4JDJ51HQFY` | `graph-layouts.ts` `hierarchicalLayout` (21) |
| `01M1MGCRNVNBE5HW27Z83PK67B` | `run-command.ts` `runPaletteCommand` (37) |
| `01M1MGCS6A29HT51G40W5TEEYK` | `canvas-page.tsx` keydown effect (66) |
| `01M1MGCSQY0M708HYYTWHP0XP2` | `canvas-page.tsx` `onPointerMove` (36) |
| `01M1MGCT80E1FMXMEAEATS1VER` | `canvas-page.tsx` `onPointerUp` (21) |
| `01M1MGCTRFEHBF15DSCNDXW0GZ` | `canvas-page.tsx` `onModeChange` (22) |

**None was closed cheaply, and that is the finding.** These are not 23
independent functions that each drifted; they are four recurring shapes:

1. **Keymap and command dispatch as branch chains instead of tables** —
   `mapSelectionKey` (46), `use-node-keydown` (64), the canvas keydown effect
   (66), `runPaletteCommand` (37), `applySelectionAction` (30),
   `NodeCommandPalette` (24). Six of the top seven. The binding set exists only
   as control flow, so nothing can enumerate the shortcuts, two bindings can
   silently overlap, and the palette and the runner each re-derive availability.
2. **Node props decoded by hand instead of through a `Schema`** —
   `getViewConfig` (45), `parsePerspective` (27), and the comparator that reads
   the decoded specs (29). Defaults are stated twice (code and ontology) and bad
   props degrade per field. This is the same thing `DESIGN.md`'s domain-typing
   section already says should be `Schema`.
3. **Renderer lifecycle effects that *are* the renderer** — `sigma-graph` (32),
   `cluster-graph` (28). Pure geometry (hulls, hit-testing) is trapped inside a
   `useEffect`.
4. **Pointer drag handled twice** — `onPointerMove` (36) and `onPointerUp` (21)
   each re-derive what a drag kind means, so they can disagree.

Cutting any one function in half would have satisfied the linter and left all
four shapes intact, which is what Rule 1 forbids. Each gap's `closes` names the
real move.

### other gaps (7)

| Node | What |
|---|---|
| `01M1MFJXAQ8NVBMA6E6CZ7CY9W` | `palette-index.ts` keeps `new Array(n)` ×2 — the alternatives cost enough to threaten the 50k-node latency bar |
| `01M1MFP33RDP5MVB4827DR5RE7` | six React lists key by index because the index *is* the identity (ordered multi-value slots; a two-element overlay) |
| `01M1MFS8RQ2BMQVZD02J4TQT7W` | seven terminal `.then` callbacks — oxlint has not implemented `promise/always-return`'s `ignoreLastCallback` |
| `01M1MHKS8EV3DD378TZSX44EJG` | the ws client's four `on*` assignments; `WsLike` is a deliberate four-handler port |
| `01M1MGT2A6Y9ZVG5J1CGJMJ2AH` | the legacy `localStorage` migration in `loadExpandedIds` has no removal condition |
| `01M1MGT307N4K243CBPJTXNG5X` | `OutlineNode.cursorPosition` — a second caret mechanism the canvas card still reads |
| `01M1MGT3K0DNGEQFXQNZYE83NY` | `getPreviousVisibleNode` / `getNextVisibleNode`, the by-id twins of the by-instance accessors |

## 6. `no-deprecated` triage (102 → 10)

**Fixed now (92).** All 92 are `@phosphor-icons/react@2.1.10` deprecating every
bare icon export in favour of its `*Icon` twin — the shipped types literally say
`/** @deprecated Use PlusIcon */`. This is not a future upstream removal to wait
for: the replacement is already in the installed version, so every phosphor
import in the package now names the `*Icon` export. Local aliases were preserved
where a file already had one (`Graph as GraphIcon` collapsed to `GraphIcon`), so
no call site changed shape.

**Gapped (10).** These are this repo's own `@deprecated` markers; each needs an
API or data decision, so each got a `#gap` node instead of a fix (see §5). Note
that `no-deprecated` is the *advisory* lane, so none of them carries a disable —
the point is that they stay counted:

- `LEGACY_COLLAPSED_STORAGE_KEY` / `LEGACY_EXPANDED_QUERIES_STORAGE_KEY` (2)
- `OutlineNode.cursorPosition` (4)
- `getPreviousVisibleNode` / `getNextVisibleNode` (4)

## 7. Needs owner

Everything here was left undone deliberately. Each is a decision, not a task.

**a. `typescript/no-non-null-assertion` — 391 in ui (300 in tests, 91 in src).**
Not mechanical: each `!` is a claim about a value the type says can be missing,
and removing one means introducing real narrowing or a real guard. The plan's
promote condition is "non-test 0", i.e. 91 src sites of hand narrowing. Q1 in
the plan already says tests come later. Backend carries 245, so the rule cannot
be promoted from this wave regardless.

**b. `typescript/strict-boolean-expressions` — 245 in ui (239 in src).**
186 are "nullable string in conditional". Rewriting `if (s)` requires deciding,
per site, whether the empty string should be falsy — that is 186 small
behaviour decisions, not a drain. `prefs.store.ts` in this wave is the cautionary
case: `widthPx == null` looked redundant against a `number | null` annotation and
was load-bearing, because happy-dom leaves `window.innerWidth` `undefined`. The
types are not always honest about runtime, so a blanket rewrite is unsafe.
Recommendation: decide whether `allowNullableString` belongs on, or budget a
wave.

**c. `typescript/no-unsafe-type-assertion` — 94 in ui src.** Same class: each is
a real narrowing to write.

**d. `typescript/no-unnecessary-condition` — 49 in ui.** 32 are "unnecessary
optional chain on a non-nullish value". oxlint offers no fix for this rule, and
per (b) the types can be wrong about runtime, so deleting 32 `?.` on the strength
of a type is exactly the mistake `prefs.store.ts` was.

**e. `oxc/no-map-spread` — 9 in ui, 6 in be. Recommend rejecting the rule.**
Its own help text says "if in-place mutation is acceptable" — it is not: every
flagged site is an immutable update over store wire nodes or fixtures. The
alternatives are mutating shared state (wrong) or `Object.assign({}, x, {…})`
(worse code, no faster). This belongs in plan Appendix A.6 with `array-type` and
`no-underscore-dangle`, not in a lane. Owner's call because it edits the agreed
rule set.

**f. `eslint/no-await-in-loop` — 4 in ui src.** All four are deliberately
sequential protocols: compensating actions posted in order, tags removed in
order, plan actions applied one at a time so a failure can trigger recovery.
Parallelising changes correctness. The rule is a perf heuristic that assumes
independence. Either scope it off for the action-dispatch modules or leave the
lane; not a drain.

**g. `eslint/max-depth` — 12 in ui src.** Ten of the twelve are inside functions
that already carry a complexity `#gap`; the extraction that closes those closes
these. Doing it separately would mean two half-refactors of the same functions.

**h. `eslint/max-nested-callbacks` cannot be promoted as specified.** The plan
wants `["error", 4]`; that fails `packages/cli/src/cli.ts:681` (5 levels), which
is d1's package. Left at `warn`. Promoting it at oxlint's default of 10 would be
a promotion that checks nothing.

**i. `typescript/consistent-type-assertions` is promoted without the plan's
option.** `objectLiteralTypeAssertions: "never"` fails
`packages/operations/src/session.ts:56`. Add the option in d1's last commit.

**j. `eslint/complexity` is still `warn`.** ui is at 0, but the backend has 7
offenders, so the promotion to `error` that the plan assigns to `d2` actually
belongs to d1's last commit. (§d2 of the plan says complexity is "already error
after g2" — it is not; g2 landed it at `warn`, along with most of Appendix A.4's
Tier E. This wave promoted the eleven that reached 0 workspace-wide; the rest
are still `warn` because backend counts are non-zero.)

**k. `typescript/require-await` was scoped out of test files — revert if
unwanted.** All 73 ui hits and 7 of the 8 backend hits are `async` callbacks
whose async-ness is the contract (fetch/postAction stubs, `await act(async …)`).
Rewriting them as `() => Promise.resolve(x)` makes stubs worse and none more
correct, and 73 pinpoint disables would be worse still, so the rule joined
`no-console` and `no-await-in-loop` in the existing test override. This is a
rule-scope decision rather than a mechanical drain — one line in
`.oxlintrc.json` to revert. The one remaining site is
`packages/mcp/src/mcp.ts:279`, an SDK handler that must be async; the rule can
be promoted once that is settled.

**l. Harness check 5 is missing its second half, and implementing it as written
would force fake gaps.** Plan A.9 #5 says the check should assert both "every
`GAP [[id]]` resolves" (g2 implemented this) *and* "every `oxlint-disable`
carries one" (g2 did not). `packages/ui` now has 50 disables: 42 carry a GAP ref,
and 8 are pre-existing `oxlint-disable-line react-hooks/exhaustive-deps` with
prose justifications. Those 8 are permanent, correct exceptions — nothing would
ever close them — so turning them into `#gap` nodes would put eight lies in the
store. The check needs to accept either a GAP ref or a `-- <justification>`,
which is a doctrine decision (it slightly weakens D12), so it was not written.

**m. Two ui tests are load-sensitive and fail intermittently.**
`palette-index.test.ts` "meets perf bar at 50k nodes" (asserts keystroke <10ms;
observed 12–25ms under a loaded machine) and `editor-behavior.test.tsx` "§3.3: an
empty transient node prunes when focus moves on". Both pass reliably in
isolation and both were reproduced failing on the **unmodified** base file, so
neither is caused by this wave — but a wall-clock assertion inside the shared
suite will keep flaking in CI. Worth either a generous margin or moving the perf
assertion to a dedicated serial run.

**n. `bun.lock` was out of date at base.** g2 catalogued `@effect/tsgo` but
committed the pre-catalog lockfile, so a fresh `bun install` rewrote it. Synced
in the first commit (`55d6d73`) — flagging because it is g2's file, not ui's.

**o. The harness ratchet test runs close to its timeout.** `bun test
packages/harness` takes ~50 s warm and timed out at the 60 s limit on the first
(cold) run of this wave, failing `verify`. `lint-warn-ratchet.test.ts` shells out
to a full type-aware oxlint plus `effect-tsgo diagnostics` for 16 packages. Not
touched (it is g2's file and the fix is a judgement about the budget), but the
margin is thin enough that CI will hit it.

## 8. Shared-file touches outside `packages/ui`

| File | Change |
|---|---|
| `tools/kb/.oxlintrc.json` | 11 promotions to `error`; `allowConstantExport` on `only-export-components`; `packages/ui/src/lib/log.ts` added to the `no-console` override; `typescript/require-await` added to the test override (§7k) |
| `tools/kb/packages/harness/lint-warn-baseline.json` | re-snapshotted after each commit (`bun run harness:snapshot`); 64 → 56 blocking rules |
| `tools/kb/bun.lock` | synced with g2's catalogued `@effect/tsgo` (§7n) |
| `.kb/nodes.jsonl` | 30 `#gap` nodes, the `#gap` tag and its four fields — all through `kb` commands only, ids aligned with r2 (§5) |

## 9. Commits

```
55d6d73 chore(kb): sync bun.lock with the catalogued @effect/tsgo pin
c58901c fix(kb): apply oxlint autofixes in @kb/ui
53b382b fix(kb): drain the small Tier-E lint rules to 0 in @kb/ui and promote them
0396fc1 fix(kb): default-case and consistent-return to 0 in @kb/ui
406ce04 fix(kb): one console seam, no-shadow and no-unnecessary-type-conversion to 0 in @kb/ui
dd038f6 fix(kb): react and promise Tier-E rules to 0 in @kb/ui and promote them
8ae75f2 chore(kb): pair every @kb/ui complexity offender with a #gap node
dd1961d fix(kb): triage no-deprecated in @kb/ui — 92 fixed, 10 gapped
ddd2d58 fix(kb): unicorn/no-array-sort and no-explicit-any to 0 in @kb/ui
ddd920b chore(kb): scope typescript/require-await out of test files
ccdd52b fix(kb): prefer-add-event-listener to 0 in @kb/ui and promote it
```

Every commit was taken with `bun run verify` green and `bun run test:ui` at
630 passing (modulo §7m).
