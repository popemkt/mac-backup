# g1-guardrails — handoff

Wave: 2026-08-24 · Harness: opencode · Branch: `popemkt/kb-g1-guardrails`
Normative input: `docs/kb-waves/2026-08-23/reports/i11-lint-report.md`
Brief: `docs/kb-waves/2026-08-24/briefs/g1-guardrails.md`

Gate: `intent/gate.sh session opencode` → exit 0 (SOFT_MISSING: shellcheck,
actionlint, nvfetcher — informational only).

## What shipped

The repo's prose intent (AGENTS.md "surface → foundation direction", "UI not
reaching into backend internals", "one mechanism per concept") is now machine
enforced by a single oxlint ruleset plus knip dead-code analysis. Everything the
report prescribed (§5b, §6, §7, §8, §9 order) landed, with the deviations called
out below.

### Files added

- `tools/kb/.oxlintrc.json` — the single oxlint ruleset. `import/no-cycle`,
  `react/exhaustive-deps`, `typescript/ban-ts-comment`,
  `typescript/no-explicit-any` (warn), plus two `eslint/no-restricted-imports`
  boundary overrides and the mandatory `**/*.css` override. Plugins:
  `eslint, typescript, react, import, unicorn, oxc`.
- `tools/kb/knip.json` — dead-file + orphan-dependency config. Entrypoints:
  `index.ts`, `src/surface/{cli,ui,mcp}.ts` (root workspace) and
  `ui/src/main.tsx` (ui workspace); `@/*` + `@kb/*` aliases wired. Test files
  are auto-detected by knip; ignored files/deps are documented below.
- `tools/kb/ui/src/types/three.d.ts` — ambient module for `three` (ships no
  types; `@types/three` not installed), mirroring the existing
  `datascript.d.ts` pattern. Replaces the `@ts-nocheck` declaration debt.

### Files changed

- `tools/kb/package.json` — added scripts `lint:all` (whole-tree oxlint),
  `knip`, `verify`; pinned `knip@6.32.2` devDependency. Edits kept contiguous
  for the t1 merge.
- `AGENTS.md` — added a one-line "Linting & boundaries" pointer to the
  Runtime/tooling boundary section (per report §10).
- Three leak files are `any`-free:
  - `ui/src/components/canvas/canvas-page.tsx` — the paste handler now reuses
    `parseCanvasDoc` (from `@kb/canvas`) instead of a bespoke `any`-laden
    `JSON.parse`; this is also a Rule 1 win (one canvas-parse mechanism).
  - `ui/src/components/graph/force3d-three.ts` — removed `@ts-nocheck`; the
    tiny three surface is declared in `three.d.ts`.
  - `ui/src/api/ws.ts` — was already `any`-free (the only "any" hit is a code
    comment).
- The two `import/no-cycle` edges are broken (see "Boundaries / cycles").
  The recursion is inverted via a `renderNode` render-prop:
  - `ui/src/components/outline/query-results.tsx` — no longer imports
    `node-block`; takes `renderNode` instead.
  - `ui/src/components/outline/node-block.tsx` — passes `renderNode`.
- `react/exhaustive-deps` findings resolved (see "Exhaustive-deps").

## Acceptance criteria

1. **`npm run verify` exists and is the single entry point.** It is:
   `npm run typecheck && npm run check && npm run lint:all && npm run knip`.
   Exit 0 measured on a clean tree.
2. **Boundary rules are real.** `eslint/no-restricted-imports` forbids (a) the
   UI reaching the backend via any relative `src/` path, and (b)
   `foundation`/`operations` reaching up into `surface`/`render`. Red-then-green
   evidence below.
3. **`import/no-cycle` is on and the tree is cycle-free.** 0 cycles; the two
   real cycles (outline `node-block` ↔ `query-results`) were broken.
4. **`react/exhaustive-deps` is on.** 22 findings handled — 10 fixed, 12
   justified inline suppressions (each with a `-- reason` comment, never a bare
   disable).
5. **`typescript/ban-ts-comment` is on** (error). The three leak files are
   `any`-free.
6. **knip runs green, is not in `.githooks/pre-commit`**, and its entrypoints
   are exactly `index.ts`, `src/surface/{cli,ui,mcp}.ts`, `ui/src/main.tsx`
   (plus auto-detected test globs). `knip --include files,dependencies` exits 0.
7. **The `**/*.css` override from §7 is present.**
8. **Four-command verification green** — see "Verification".

## Verification (counts observed)

Backend (`tools/kb`):
```
bun test         → 740 pass / 0 fail   (note: benchmark 50k test is timing-flaky;
                                        passes in a quiet run, see gaps)
npm run typecheck → exit 0 (tsc --noEmit)
npm run check     → exit 0 ("Found no warnings or lint errors in 89 files")
npm run lint:all  → exit 0, 0 errors, 41 warnings
npm run knip      → exit 0
npm run verify    → exit 0 (aggregate)
```
UI (`tools/kb/ui`):
```
tsc --noEmit → exit 0
vp test       → 509 pass / 1 fail (editor-behavior §3.3 "prunes on 10ms" —
               a timer test that misses under full-suite parallel load; it
               passes 5/5 in isolation. Not caused by this wave: the test is
               about focus-pruning, unrelated to the files touched.)
```
(`ui/tests-render/*` is the protocol's named pre-existing failure set and the
render harness needs npm 12 — not part of the runnable bar.)

The 41 `lint:all` warnings are pre-existing latent gaps surfaced now that
`react`/`import`/`unicorn`/`oxc` plugins are enabled (e.g.
`no-unused-vars` in a few files, `no-children-prop` in tests, `no-new-array`,
`no-did-update-set-state`, `no-useless-escape`, and `no-explicit-any` at the
documented seam/test sites). They are warn-level and non-blocking; see follow-ups.

## Boundaries / cycles — design

The report's §5b `no-restricted-imports` patterns (`@kb/foundation/*`,
`@kb/operations/*`) are not the actual boundary here: the sanctioned `@kb/*`
seam in this repo maps to `@kb/ontology`/`@kb/order`/`@kb/field-type` (all under
`src/foundation/`), so blanket-blocking `@kb/foundation/*` would forbid the
legal seam. I implemented the boundary as the repo's prose describes it:

- **UI → backend internals**: forbid any relative import from `ui/src/**` whose
  specifier reaches a backend `src/` path (`^(?:\.\./)+src/`). The UI must use
  `@kb/*`.
- **Layer direction (surface ↔ foundation)**: `src/foundation/**` and
  `src/operations/**` may not import `../surface|operations|render/*`
  (`^(?:\.\./)+(?:surface|operations|render)/`). `src/foundation` is a leaf;
  the direction is surface → operations → foundation.

The outline cycle (`node-block` ↔ `query-results`) was broken by inverting the
render dependency: `query-results` now receives a `renderNode` callback instead
of importing `node-block`. This removes the static cycle without adding a
Suspense boundary, and keeps the shared `NodeRow`/`TagChip` components the
W8b invariant protects.

## Exhaustive-deps — 22 findings

Fixed (behavior-preserving because the memo is a pure function of the remaining
deps, or the dep was genuinely unused):
- Removed redundant `rev` invalidation key from pure `useMemo`s:
  `sidebar.tsx` (4), `graph-page.tsx` (2), `ontology-list-page.tsx`,
  `schema-section.tsx` (and deleted the now-unused `rev` declaration).
- `graph-page.tsx` — memoized `restrictTo` (was a fresh `new Set()` per render,
  causing the effect to fire every render); dropped the stable React Router
  `navigate` from `onNodeOpen` deps.
- `node-content.tsx` — removed unused `nodeId` from two callbacks; added the
  genuinely-missing `content`/`nodeId`/`instanceKey` to `handleKeyDown` deps.
- `use-node-keydown.ts` — removed the unused `node` destructure (and its
  interface keeps the prop so callers are unaffected).

Justified inline suppressions (each carries a specific `-- reason`, not a bare
disable — these are deliberate dep choices or oxlint-incapable patterns):
- `canvas-page.tsx:522` (zoomToFit not stable → one-shot listener),
- `sigma-graph.tsx` Sigma lifecycle effect (`refreshReducers` derives from
  `highlightIds`; re-running this effect would re-init sigma),
- `ontology-page.tsx` ×4 (`includeTags`/`extendsIds` are fresh arrays each
  render; the `.join(",")` dep is the deliberate stable-primitive key),
- `node-command-palette.tsx` (`pickerItems` changes every render by construction),
- `view-filter-popover.tsx` (`rev` is the reactive key — the body reads the
  store imperatively via `getState()`).

## What was cut, and why

- **jsx-a11y plugin not enabled.** The report's §5b config (the thing I was told
  to build) contains no a11y rules; the prose about the keyboard/focus/role
  subset is advisory. Enabling the plugin surfaced a wall of pre-existing a11y
  gaps that `ui/ARCHITECTURE.md` explicitly assigns to surface waves (NodeRow
  click-div, TextCard ports, graph-search dismiss). Per brief §11 ("lenient where
  it would force a same-wave refactor outside your zone") I deferred a11y
  entirely rather than ship a disable-heavy a11y noise layer. Named as a gap.
- **knip scoped to `--include files,dependencies`.** Full knip (with
  `includeEntryExports` off) still reports 116 unused exports + 33 unused types.
  These are the `src/index.ts` public-API surface, `export *` barrels, and
  extension actions registered by id (extensions-bundled/*) — library/barrel
  false positives, not actionable dead code. I scoped the green gate to the
  files+deps slice (the report §10's stated knip value) and document the export
  findings as a follow-up rather than an ignore-dump (ignoring all of `src/**`
  would disable the tool).
- **`vp check`/`vp lint` unchanged (still `vp check --no-fmt`/`vp lint`).** See
  "Conflict with the report" below. The authoritative §5b gate moved to
  `lint:all` (direct oxlint) inside `verify`.
- **No wiring of `lint:all` into `.githooks/pre-commit`.** Matches the report's
  "slow pre-commit is the step people skip" hypothesis; `verify` is the entry
  point (and the brief requires knip to stay out of pre-commit).

## Conflict with the report (report wins, but it needed a fix)

The report assumes `vp check`/`vp lint` read `.oxlintrc.json`. Empirically **it
does not**: `vp` reads only the `lint` block of `tools/kb/vite.config.ts`, and
it never loads `.oxlintrc.json` for rules (verified via `vp lint --print-config`
+ a deliberate `eqeqeq` marker rule: vp check ignored it; a direct oxlint run
honored it). The report's "ONE config, ONE `vp check`" model is therefore not
reachable without duplicating the ruleset into the vite config, which would
violate Rule 1 (two config surfaces). Resolution: the rules live only in
`.oxlintrc.json` (single source) and are enforced by direct oxlint via
`npm run lint:all`, which is part of `verify`. `vp check` is retained unchanged
as the fast package-local path. This conflict is noted per the brief.

## Shared-file touches (for the orchestrator)

| Path | Why |
|---|---|
| `tools/kb/package.json` | scripts + pinned `knip` devDep (contiguous; expected conflict with t1) |
| `tools/kb/ui/src/components/outline/shared-components.test.tsx` | updated one W8b assertion to reflect the deliberate `node-block`↔`query-results` cycle inversion (see boundaries) |
| `AGENTS.md` | one-line linting-and-boundaries pointer |

The rest of the changed files are the three leak files, the cycle-break pair,
the exhaustive-deps fixes/suppressions, `types/three.d.ts`, `.oxlintrc.json`,
`knip.json`, and `bun.lock`.

## Evidence the guardrails have teeth (red → green)

All run against the shipped `.oxlintrc.json`/`knip.json`; each "red" is a
deliberate violation that was then reverted.

```
# Boundary: UI reaching backend via relative src/ path  (temp file in ui/src)
'../../src/foundation/model.ts' import is restricted ... [Error/eslint(no-restricted-imports)]
exit=1  →  green (uses @kb seam) exit=0
# Boundary: foundation reaching up into surface
'../surface/cli.ts' import is restricted ... [Error/eslint(no-restricted-imports)]
exit=1
# Cycle: cross-importing pair
error import(no-cycle): Dependency cycle detected   (both files; exit=1)
# ban-ts-comment
error typescript(ban-ts-comment): Do not use @ts-nocheck ...  exit=1
# no-explicit-any
warning typescript(no-explicit-any): Unexpected `any`   exit=0 (warn, as intended)
# exhaustive-deps
error react-hooks(exhaustive-deps): missing dependency 'x'   exit=1
green (dep added)   exit=0
# CSS override (§7): with the override, .css is not linted (excluded)
# knip: throwaway unused file → "Unused files (1)" → removed → exit=0
```

The tree after resolving all violations: `lint:all` reports **0 errors**.

## Follow-ups

- **jsx-a11y subset** — enable the keyboard/focus/role rules once the
  surface-wave a11y gaps (ARCHITECTURE.md) land, or with a scoped override.
- **knip unused-export sweep** — defer full pruning of the 116 public/barrel
  exports + 33 types; needs per-symbol verification (public API + extension
  registration) before removal.
- **`lint:all` in a CI step** — it is not wired to `pre-commit`; recommend a CI
  `npm run verify` gate so the boundary/cycle rules run outside a human's local
  verify.
- **`benchmark 50k` flake** — the `load + query well under 1s` test is
  timing-sensitive (fails at ~1.2–1.3s under load, passes in a quiet run).
  Unrelated to this wave; worth a threshold check.

## Self-grade

Honest gaps: (1) a11y deferred (above); (2) knip export pruning deferred
(scoped to files+deps); (3) the UI suite has one unrelated timer flake; (4) the
report's "vp enforces §5b" assumption was wrong, so the §5b gate lives in
`verify`/`lint:all` rather than `vp check` — the code in `tools/kb/vite.config.ts`
was intentionally left untouched. Otherwise I believe the wave is complete
against the brief's acceptance list, with the rules demonstrably non-vacuous.
