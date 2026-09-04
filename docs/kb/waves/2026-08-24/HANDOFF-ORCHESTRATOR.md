# Wave 2026-08-24 — orchestrator handoff

Base `6334d4d` → `827d0ed`. 38 commits, 5 merges, 66 files, +4976 / −313.
Five delegated waves, all merged. Nothing was pushed by a worker; the
orchestrator merged each branch after independently verifying it.

## The mission

> 1. implement the guardrails mentioned in `reports/i11-lint-report.md`
> 2. Make this tool ready for mutation testing, deterministic simulation
>    testing and properties based testing.
> 3. are we using effect throughout. If not, plan something, don't do it yet.
> 4. Are we using storybook? if not please do add it.

Delegated per the owner's harness ranking (opencode and omp preferred, roughly
two of every three; then cursor, codex, claude).

| Wave | Item | Harness | Merge |
|---|---|---|---|
| `g1-guardrails` | 1 | opencode | `506b8f6` |
| `t1-property-mutation` | 2a | omp | `827d0ed` |
| `t2-dst` | 2b | opencode | `0e1ead1` |
| `s1-storybook` | 4 | omp | `5e8ad3d` |
| `r1-effect-plan` | 3 | cursor | `9753fd1` |

## Final state of main

| Check | Result | Baseline |
|---|---|---|
| `bun test` (core) | **802 pass / 0 fail** | 740 |
| `vp test` (UI) | **536 / 536** | 510 |
| `npm run verify` | **exit 0** | did not exist |
| `bun tests/dst/run-many.ts` | **12/12 seeds green** | did not exist |
| `npm run test:mutation` | **86.94%** on `src/foundation/**` | did not exist |
| `.kb/nodes.jsonl` | not committed by any wave | — |

The three pre-existing `ui/tests-render/graph.e2e.ts` failures carried in from
i11 are untouched and still open.

## What shipped

### Item 1 — guardrails (g1)

`tools/kb/.oxlintrc.json` is the single ruleset: `no-restricted-imports`
boundaries (UI must not reach the backend by relative path; `foundation` /
`operations` must not import `surface` / `render`), `import/no-cycle`,
`react/exhaustive-deps`, `typescript/ban-ts-comment` at error,
`no-explicit-any` at warn, and the §7 `**/*.css` override. `knip.json` is
pinned at `knip@6.32.2`, CI/on-demand only. `npm run verify` = typecheck +
`vp check` + `lint:all` + knip.

Two premises in the i11 report were **false** and were corrected rather than
worked around:

- **`vp check` does not read `.oxlintrc.json`.** Proved with a deliberate
  `eqeqeq` marker rule: `vp check` ignored it, a direct oxlint run honoured it.
  The report's "ONE config, ONE `vp check`" model is unachievable, so §5b is
  enforced by `npm run lint:all` inside `verify`. This is a real, named
  divergence from the recommendation, not a silent fork.
- **`ui/src/api/ws.ts` was already `any`-free** — the report's hit was a comment.

Beyond the config, it found and fixed real structure: two genuine import cycles
(`node-block` ↔ `query-results`), broken by inverting the recursion through a
`renderNode` prop rather than suppressing; a `@ts-nocheck` in
`force3d-three.ts` (worse than the `any` being counted) replaced with a real
ambient module; and `canvas-page.tsx`'s bespoke `any`-laden canvas JSON parse
replaced by the existing `parseCanvasDoc` — a Rule 1 win, since the fix deleted
a second parse path instead of typing it.

22 `exhaustive-deps` findings: 10 fixed, 12 suppressed with per-line reasons,
no bare disables.

### Item 2a — property-based + mutation testing (t1)

fast-check properties for all six briefed targets (ordering algebra, field-type
round trip, ontology resolver, store round trip, mention parsing, seed
idempotence), each demonstrated red on a deliberate break with its shrunk
counterexample recorded in the commit.

StrykerJS via the **command runner** driving `bun test tests/`, scoped to
`src/foundation/**`, `npm run test:mutation` on demand and out of pre-commit.
The vitest runner was evaluated and is **impossible here**: all 28 core test
files import from `bun:test`, which vitest cannot resolve. Converting them
would be out of zone and a second test convention.

Two integration snags, documented inline in `stryker.config.json`: TS 7's
native port dropped `ts.parseConfigFileTextToJson`, which Stryker's
`TSConfigPreprocessor` calls unconditionally on any tracked `tsconfig.json` and
crashes on — worked around by pointing `tsconfigFile` at a name that does not
exist; and `ignorePatterns: ["ui/**"]`, because Stryker symlinks only the
nearest `node_modules` into its sandbox.

### Item 2b — deterministic simulation testing (t2)

Effect's `Clock` and `Random` became the **single owner** of store time and
identity, exposed from `foundation/model.ts` as `currentIso` and `freshId`. No
parallel capability record — Effect was already vendored, so the existing
services *are* the capability. `tests/dst/guard.test.ts` greps all of `src/**`
and fails if any store-reachable file reads the wall clock, `Date`,
`Math.random`, `ulid` or `nowIso` outside the seam owner and its documented
exceptions.

`tests/dst/` runs seeded histories through the **real plan surface**
(`mapAdd`/`mapSet`/`mapUnset`/`mapMv`/`mapRm`/`mapFieldDefine`/`mapTagDefine`
plus `invokeReceiptEffect` — the same path the CLI, UI and MCP use), asserts
invariants after every op, and proves same-seed replay is byte-identical.
`run-many.ts` runs many seeds on demand.

**Dangling-ref decision, encoded:** dangling inbound *content* refs are
intended (deleting a node must never silently rewrite another node's content),
dangling *structural* children are a violation. The harness surfaced a third
kind nobody had listed — a prop **key** naming a deleted field node — and put
it in the tolerated bucket, enforcing "no prop key invented or dropped" as
round-trip byte-stability instead.

### Item 3 — Effect audit (r1) — RESEARCH ONLY, no code

**Answer: no, and it should not be.** 24/57 backend files (~42%), 0/206 in the
UI, 32 `run*` sites (no `runSync`), 3 live services, and — at audit time — zero
owners for `Clock`/`Random`, which t2 has since fixed.

**Recommendation: hold the current boundary and formalise it.** Effect is
genuinely load-bearing on the write path and `DomainError` is a real typed error
channel, deliberately collapsed to `never` at HTTP/MCP edges as policy. The
missing 58% is mostly correctly-pure code plus a thin Promise/`node:fs` skin for
tests, bins and Bun host APIs; finishing it as a purity crusade buys consistency
and little else.

The structural finding worth acting on: every `run*` site is classified leaf,
event-leaf, or **compat facade**, and the facades (`openKb`, `invoke`,
`store.load`, `runWithKb`, the operation wrappers) mean any Effect program that
calls the wrong export re-enters `runPromise` mid-graph. **The boundary is
coherent by convention, not by type.** Hence its phase 1 is a boundary guard and
its phase 0 is t2's seam, already landed.

### Item 4 — Storybook (s1)

Storybook **10.5.10** + `@storybook/react-vite` + `addon-a11y`, 37 stories,
`storybook` and `build-storybook` scripts. The brief said 9; 9.x's newest
release (9.1.20) was already superseded, the registry was checked live, and no
acceptance criterion pinned a major.

The flagged integration risk did **not** materialise: `ui/package.json` remaps
`overrides.vite` to `@voidzero-dev/vite-plus-core@0.2.8`, and that remap is
transparent to Storybook's Vite builder. Tested before a single story was
written. `.storybook/main.ts` supplies its own `viteFinal` only for Tailwind and
the `@` / `@kb/*` aliases, and deliberately does **not** import
`../vite.config.ts`, whose `vp` `defineConfig` carries `lint`/`check` keys plain
Vite would choke on.

**One story format.** All six hand-rolled catalog modules migrated to CSF3 —
none remain — and `catalog.smoke.test.tsx` now reads them through
`composeStories`, so a story added to the viewer is exercised by the suite for
free: 37 stories → 49 smoke cases, no second fixture set.

Found in passing: **Bun does not implement `import.meta.glob`**, so a
glob-import story loader broke `bun test` (which recurses into `ui/`) while
`vp test` was unaffected. Fixed with one static import per story file.

## Defects found in code that 740 passing tests had approved

| Defect | Found by | Reachable today? |
|---|---|---|
| `MENTION_RE` let a stray leading `[` corrupt the captured id — `[[[id]]` yields `[id`, silently dropping the backlink | mention-parse property | **yes** — `[[id\|label]]` is the ref form |
| `ulid()` falls back to `Date.now()` when `!seedTime`, so an epoch-0 clock read live time | replay-equality assertion | yes, and it would have made the DST harness fraudulent |
| `isFieldType` used `in`, so `__proto__` / `toString` / `constructor` passed as field types | mutation testing | yes, via legacy string field values |
| `canonicalJson` dropped a `__proto__`-named key (`out[key]` sets the prototype) | store round-trip property | no — prop keys are ULID/`sys.*` only |
| `migrateOrderKeys` root-order comparator was never asserted; a flipped tie-break passed silently | mutation score 82.64 → 90.08 | coverage hole |
| A property whose generator filtered through its own subject: circular, and it **hung** fast-check's rejection sampling once the subject was mutated to always-true | mutation testing | test-suite defect |

Two of these are the same root cause — a plain object used as a map without
`Object.hasOwn` / `Object.fromEntries`. That is a lint-rule-shaped problem;
`no-prototype-builtins` catches neither.

## Open follow-ups

1. **Nothing runs the new lint rules automatically.** `.githooks/pre-commit`
   runs docs-check, the kb-assets check, and `tsc --noEmit` for changed kb
   packages — it does not invoke oxlint. Until a CI step calls `npm run verify`,
   the boundary rules, `import/no-cycle` and `ban-ts-comment` bite only when a
   human types it. g1 chose this deliberately (a minutes-long hook gets
   `--no-verify`'d), but the CI half was never built.
2. **Unseeded fast-check makes the mutation score non-authoritative.** Three
   runs of `stryker run --mutate src/foundation/ontology.ts` over
   byte-identical source and tests produced **9, then 53, then 68** survivors —
   each mutant is tested by a fresh `bun test` process drawing fresh random
   data. `numRuns` was raised to 500 (1000 for ontology) and two consecutive
   runs then matched, but that is evidence of smaller variance, not of none.
   This is why `thresholds.break` sits at **60** against an observed **86.94**,
   a gate too loose to notice a slide to 65. Pinning a seed per property in CI,
   with an unseeded nightly sweep, would let the threshold move to ~80.
3. **The determinism seam guard is narrower than its docstring.** Its allowlist
   keys on **basename**, so a new file named `model.ts` anywhere under `src/`
   inherits the seam owner's exemption; and its token list misses
   `performance.now()`, `crypto.randomUUID()` and `Bun.nanoseconds()`.
4. **Storybook coverage gaps, named by s1:** `NodeCommandPalette` (positions
   itself via `document.querySelector` against a node outside its own render
   tree) and the four canvas-imperative graph renderers. Both would need the
   mock empire the brief said to refuse.
5. **knip config hints** — two redundant entry patterns and one `.css`
   exclusion note, cosmetic.
6. **Three pre-existing render-spec failures** from i11 remain open.

## Merge notes

- `tools/kb/package.json` conflicted between g1 and t1 exactly as predicted;
  resolved as a union (`fast-check` + `@stryker-mutator/core` + `test:mutation`
  alongside `knip` + `lint:all` + `verify`). `bun.lock` regenerated rather than
  hand-merged.
- One integration defect neither worker could see, fixed by the orchestrator in
  `6578f16`: g1 configured knip against a tree with no Storybook, s1 added the
  `storybook` CLI dependency without knowing knip existed. knip finds no import
  (it is a script binary) and failed `verify`. Listed in the
  `ignoreDependencies` array that file already uses for this class. Adding
  `.storybook` to the ui workspace globs was tried first and rejected — knip
  auto-detects those files and reported the patterns redundant.
- After merging s1, `tools/kb/ui/node_modules` lacked Storybook, so
  `composeStories` could not load and whole test files failed to import,
  *dropping* counts (core 751→729, UI 510→487). Falling counts mean load
  failures, not assertion failures. `bun install` in `ui/` fixed it.
- `.kb/nodes.jsonl` was guarded in every worktree with
  `git update-index --skip-worktree`, because opening the kb rewrites it and
  four of five harnesses would otherwise have staged it. No wave committed it.

## Process notes for the next orchestrator

- **opencode `run` mode is one-shot and cannot be messaged mid-flight.** Plan
  for no mid-course correction on those workers; put everything in the brief.
- **omp stays alive at an idle prompt after finishing**, so process liveness is
  not a completion signal for it. Read the terminal or check for the handoff
  report instead.
- **Do not override omp's model.** Its configured default is the owner's
  choice.
- **Check probe exit codes, not piped ones.** Three separate monitoring bugs
  this wave came from reading `$?` after a pipe (`head`, `grep`) or from
  `pgrep -fc`, which macOS does not support — each turned a crashed probe into
  a confident false report. `AGENTS.md` already warns about exactly this for
  activation executors; it applies to orchestration tooling too.
