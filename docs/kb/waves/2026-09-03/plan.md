# Wave 2026-09-03 — kb as if started today: workspace, tags, strict stack (Track 1)

Owner mission, verbatim:

> 1. There's a refrepo repo/project … make kb stack up to date. Use the lint
>    configs and setup from there (… can we have a production stack that's sort
>    of have all good categories cranked up as error). Write an md to show all
>    you want to pull in before taking action. Also the nx/module cohesion
>    setup. Also everything technical rules that you think they have: good way
>    to enforce. Also does effectjs have skills and guidelines, should we import
>    those as well. Also their rules (especially the no patchy fix, ground up
>    thoughtful design)
> 2. The persistence thing, probably after the first track. I also need a good
>    option there.
>
> use your best discernment for the best, tightest in terms of type, most
> checked repo as well. also the way they do pnpm workspace stuff is very
> clean, should we adopt it?
>
> make it so that it looks like we just start the project anew, and have those
> best practices built in from the start. so make it look clean, clean
> entrypoints, modern, powerful in terms of enforceable boundaries, etc.

Revision 2 (owner comments applied). **Track 1 only is live**; Track 2
(persistence, query IR, Cypher question) is parked in `briefs/p1-persistence.md`
and `reports/datalog-vs-cypher/` and resumes after Track 1 ships.

Evidence: `reports/recon-*.md` (four Opus recon reports),
`reports/measurements.md` (every number below, measured on this checkout).

## Decisions (owner-confirmed unless marked *rec*)

| # | Decision | Outcome |
|---|---|---|
| D1 | Package manager | **Bun workspaces. Strict: every internal dep `workspace:*`, every external dep `catalog:`. No literal versions in any manifest** (harness-enforced; `OFF_CATALOG_BY_DECISION` exists but starts empty). Not pnpm — Bun is already runtime, test runner, PM, and what `pkgs/kb` builds with. |
| D2 | Boundary enforcement without ESLint | **Nx for the project graph and tags; boundaries checked by a harness test over `nx graph` output; oxlint stays the only linter.** Nx supports Bun workspaces. `@nx/enforce-module-boundaries` is skipped because it drags in ESLint + a TS 6 alias (typescript-eslint has no TS 7 support — refrepo carries exactly that wart). The harness reads `nx graph --file` (project deps derived from imports + manifests) plus each package's `nx.tags`, and applies the constraint matrix (D11). Same semantics, one linter. `nx affected` and task caching come along for `verify`. |
| D3 | Query engine | DataScript stays (Track 2). Not touched by Track 1. |
| D4 | Owner's data-model vision (recorded, feeds Track 2) | "The backbone of kb is always a graph. Fields, tags, children are how kb *represents* relationships visually; they must always be queryable as plain named relationships. System relationships exist so an opinionated app can be built on top, but everything can go back to its genesis: a named relationship." Query IR is **not** decided; the vision favours a uniform relationship model. Revisit with `reports/datalog-vs-cypher/` when Track 2 resumes. |
| D5 | Rules and drift markers | **kb nodes.** `#rule` nodes with `enforcement` (ref → `prose \| lint \| tsc \| harness \| hook \| ci` nodes), `#gap` nodes for drift; code carries `// GAP [[id]]`; `docs/kb/rules.md` materialized. |
| D6 | Effect guidance | Pointer in `CLAUDE.md` to `node_modules/effect/AGENTS.md`; **install official skills with the skills CLI at repo scope** (`bunx skills add Effect-TS/skills` from the repo root → `.agents/skills/` + `.claude/skills/` link, lockfile committed). No `effect-mcp`. `@effect/tsgo` diagnostics through `tsc`. |
| D7 | Effect version | `effect` + `@effect/platform-bun` → `4.0.0-rc.112` lockstep, `datascript` → `^1.8.1`, in `w1`. |
| D8 | "bin thing" | Node `01KZG17R7FA9QVYAER8N0E5K8Y` → done in `r2`; child notes the remaining direnv shim + `.mcp.json` pointing at the shim. |
| D9 | `noPropertyAccessFromIndexSignature` | Rejected, recorded with counts (114 + 239). |
| D10 | Hosted Tana-scale trajectory | Recorded; drives Track 2. |
| D11 | **Package layout — "as if started today"** | `tools/kb` becomes a Bun workspace of small packages under `tools/kb/packages/*`, each with one concept, a curated `exports` barrel (named exports only), and two tags. Details and the constraint matrix in `briefs/w1-workspace.md`. The `@kb/*` alias maps (4 hand-synced copies today) disappear: `@kb/*` become real packages. |
| D12 | Soft-rule mechanism | Two mechanisms by count, never three: **≤ ~30 sites → rule at `error` + pinpoint `// oxlint-disable-next-line <rule> -- GAP [[id]]`** (harness: every disable carries a GAP ref); **> ~30 sites → ratchet lane** (`warn`, frozen count, promote at 0). Size sensors (`max-lines*`, `max-params`) stay `warn` forever with ratchet. `complexity` in ui (23 sites) takes the disable+GAP route, so it is `error` from day one. |
| Q1 | `no-non-null-assertion` in tests | Ratchet now, promote later; `src` → `error` in drains. |
| Q4 | Pre-commit | Runs full `verify` when `tools/kb/**` staged; warn-and-skip when deps missing. |

## Split (Track 1)

| Wave | Harness | Deliverable | Brief |
|---|---|---|---|
| `w1-workspace` | claude (opus), worktree | Restructure into tagged packages; Bun workspace + strict catalog; Nx graph + boundary harness check; skills CLI; effect rc + datascript bump; `pkgs/kb` rebuilt from the new layout; one `bun.lock`; tsgolint binary fixed. **Moves and wiring only — no behaviour change; suite green throughout.** | `briefs/w1-workspace.md` |
| `g2-strict-stack` | omp | tsconfig contract; oxlint cranked + two lanes; type-aware; `@effect/tsgo`; fmt gate; knip incl. exports; `harness/` checks; `verify` in pre-commit + CI | `briefs/g2-strict-stack.md` (paths updated for D11) |
| `d1-drain-backend` | cursor (grok 4.6) | ratchet rules → 0 in backend packages; 25 Effect warnings; dead exports | §d1 |
| `d2-drain-ui` | omp | same for `@kb/ui`; 23 complexity disables paired with GAP nodes; 102 deprecations triaged | §d2 |
| `r2-rules` | claude | Rule 1 sharpened; canonical-statement rule; `#rule`/`#gap` nodes + `docs/kb/rules.md`; Effect pointer; DESIGN.md doctrine + drift fixes | §r2 |

Merge order: `w1` → `g2` → (`d1` ∥ `d2` ∥ `r2`). Nothing else runs while `w1`
is open: it moves every file.

## Standing constraints for every worker

1. `intent/gate.sh session <harness>` first.
2. Rule 1 outranks everything. Each brief names the parallel mechanism it must
   not create (two linters, two formatters, two alias maps, two clocks, a
   second config home). The correct output when the clean version does not
   fit is a named `#gap`, not a stopgap.
3. **A rule or test that has never gone red is not known to work.** Every
   harness check and every promoted lint rule ships with red-then-green
   evidence in the report.
4. `.kb/nodes.jsonl` is owner data. Only `r2` (and `d2` for its GAP nodes)
   writes to it, only through `kb` commands.
5. No `rtk rebuild`, no push, no merge into main; commit on the wave branch;
   conventional commits, small and green.
6. Report to `reports/<wave>.md`: shipped / cut / shared-file touches /
   red-then-green table / gaps as node ids.

## Base state

Base commit: `74cffa3`. Baselines (must not regress): backend `bun test` green,
`tsc --noEmit` clean in both packages, `npm run verify` green, ui `vp test`
green, `pkgs/kb` builds. Known red at base, not any worker's:
`tests/benchmark.test.ts` (Track 2). Known live bug (Track 2): `graph.query`
revives aggregate integers into node ids — node `01M1KW4G0HK0Q0RBNSV0ZHMM5J`.

## What is deliberately not ported

| RefRepo thing | Reason |
|---|---|
| `@nx/enforce-module-boundaries`, `@nx/eslint-plugin`, ESLint | needs ESLint + TS 6 alias; same rule delivered by harness over the Nx graph (D2) |
| pnpm, `pnpm dedupe --check`, catalog↔lockfile provenance test | Bun; no equivalents (D1) |
| `node --test` over compiled `dist/` + its guard rules | Bun runs TS; keep only "chained scripts exist" |
| Azure pipelines, Sigrid, submodules, Docker, Temporal, NestJS | not this repo |
| Effect *containment* pattern | kb is Effect-all-the-way; keep only "one boundary folds foreign failures into `DomainError`" |
| `typescript/array-type`, `no-underscore-dangle`, `import/no-named-as-default-member` | style-only or false-positive class (measured) |
| dprint, Effect repo's lint `off`s | second formatter / library-author concessions |
| `PROMPT_REVIEW_RULES.md` | parked as a `#gap` for the dotfiles skills dir |

## §d1 — drain backend (short brief; harness: cursor grok 4.6)

Consumes `g2`'s baseline. Promote rules to `error` as scopes reach 0; one
commit per promotion (fix → 0 → harness demands promotion → flip → re-snapshot).
Order by value: promises family (~0 already) → `no-unnecessary-type-assertion`
(autofix) → `no-console` through one output seam → `node/no-process-env`
through the config seam → `consistent-type-imports` (autofix) →
`no-non-null-assertion` in non-test (one owned narrowing helper if needed) →
`strict-boolean-expressions` → `no-unnecessary-condition` → `require-await` →
`unicorn/no-array-sort` → `complexity` (6 named functions: SLAP-extract named
steps, never split for line count) → knip dead exports (delete, never re-export).
Also: the 25 `@effect/tsgo` warnings — `cli`/`registry` fold every foreign
failure into `DomainError` (one mapper); `context`/`http`/`server` collapse
chained `Effect.provide` into one merged Layer. **Not** `lazyEffect` /
`leakingRequirements` on the Store port (Track 2).

## §d2 — drain ui (short brief; harness: omp)

Same protocol for `@kb/ui`. `complexity` is already `error` after `g2`: the 23
offenders carry `// oxlint-disable-next-line complexity -- GAP [[id]]` with one
`#gap` node each (expected shape / why deferred / what closes). `d2` may close
any it can cheaply; the rest stay visible. `no-deprecated` (102): triage into
fix-now vs `#gap` naming the upstream version that removes it.
`react/no-children-prop` 13, `no-unused-vars` 11, `consistent-return` 17 → 0.

## §r2 — rules (short brief; harness: claude)

- `CLAUDE.md` Rule 1: append refrepo's symptom list and reviewer test; add
  "bridges over mirrors" and "a dead seam is still a duplicate". Rule 1 stays
  the one home; no second rule.
- Canonical-statement rule; Effect pointer + v4 non-negotiables; drift marker
  `// GAP [[id]]`; the D12 two-mechanism rule.
- `#rule`/`#gap` tags with fields; one `#rule` node per enforced rule with an
  honest `enforcement`; `docs/kb/rules.md` via the existing docs extension.
  Flip D8's node.
- `tools/kb/DESIGN.md`: compiler strictness contract table (read by harness);
  testing doctrine (property anti-patterns, coverage-is-a-signal, mutation
  advisory, L1/L2/L3); domain typing → Effect `Schema`; fix the "streaming line
  parse" and "tsgolint not verified" drift.

---

## Appendix A — every measure, in one table

Legend — **State**: `on` (this wave, `error`/enforced) · `lane:R` (ratchet:
`warn`, count frozen, promote at 0) · `lane:A` (advisory: reported, never
gates) · `disable+GAP` (`error`, pinpoint disables paired with `#gap`) ·
`reject` (measured, recorded). **Scope**: `all` = every package; `be` = backend
packages; `ui` = `@kb/ui`; `test` = test files/harness. Counts = today.

### A.1 Workspace & supply chain (`w1`)

| Measure | State | Enforced by |
|---|---|---|
| Bun workspace root `tools/kb`, packages under `packages/*` | on | `bun install`; harness `workspace-shape` |
| Every internal dep `workspace:*`; every external dep `catalog:` | on | harness `version-authored-once` |
| No `latest`/`*`/`next` specifiers | on | harness `version-authored-once` |
| One `bun.lock`; CI `--frozen-lockfile` | on | CI |
| `bunfig [install] minimumReleaseAge = 4320` | on | harness `version-authored-once` |
| `bunfig [install] trustedDependencies` explicit allowlist | on | harness |
| `linker = "isolated"` | on if ui build tolerates; else recorded | `w1` report |
| Nx project graph (`nx.json` minimal, no cloud, `analytics:false`) | on | `nx graph` |
| Two-axis tags per package (`layer:*`, `scope:*`) | on | harness `boundaries` |
| Boundary constraint matrix (D11) incl. **application ↛ infrastructure** | on | harness `boundaries` over `nx graph --file` |
| Curated `exports`: single `.` barrel, named exports only | on | harness `public-surface` |
| `nx affected` / task cache for `verify` | on | `nx run-many` |
| `@oxlint-tsgolint/darwin-arm64` present | on | `oxlint --type-aware` runs |
| `effect`/`@effect/platform-bun` `4.0.0-rc.112`, `datascript ^1.8.1` | on | catalog |
| Skills CLI at repo scope (`Effect-TS/skills`), lockfile committed | on | `.agents/skills/` |
| `pkgs/kb` builds from the new layout | on | `nix build .#kb` |

### A.2 TypeScript (`g2`, one `tsconfig.base.json`, packages declare only their delta)

| Flag | be | ui | State |
|---|---|---|---|
| `strict` | 0 | 0 | on |
| `noUncheckedIndexedAccess` | on | 2 | on |
| `noImplicitOverride` | on | 6 | on |
| `noFallthroughCasesInSwitch` | on | 0 | on |
| `verbatimModuleSyntax` | on | 0 | on |
| `exactOptionalPropertyTypes` | 17 | 31 | on (drain) |
| `noUnusedLocals` + `noUnusedParameters` | 2 | 1 | on |
| `noImplicitReturns` | 0 | 0 | on |
| `allowUnreachableCode: false`, `allowUnusedLabels: false` | ? | ? | on (measure) |
| `noUncheckedSideEffectImports` | ? | css | on (measure; `css.d.ts`) |
| `erasableSyntaxOnly` | ? | ? | on (measure) |
| `forceConsistentCasingInFileNames`, `useUnknownInCatchVariables` | 0 | 0 | on (stated) |
| `skipLibCheck: true` | 3 upstream | — | keep; recorded exception; shim checked by harness |
| `noPropertyAccessFromIndexSignature` | 114 | 239 | **reject** |
| Contract table in `DESIGN.md` = `tsconfig.base.json` | — | — | harness `tsconfig-contract` |
| `@effect/tsgo` plugin, `ignoreEffectSuggestionsInTscExitCode:false`, `prepare: effect-tsgo patch` | 0e/25w/13m | — | on (be only) |

### A.3 oxlint categories

| Category | State |
|---|---|
| `correctness` | error |
| `suspicious` | error |
| `perf` | error (tests: `no-await-in-loop` off) |
| `pedantic`, `style`, `restriction`, `nursery` | off as categories; rules cherry-picked below |

### A.4 oxlint rules — Tier E (`error`, count ≤ 21 or 0)

| Rule | be | ui |
|---|---|---|
| `import/no-cycle` (uncapped) | 0 | 0 |
| `import/no-duplicates` | 3 | 2 |
| `import/no-self-import`, `import/no-empty-named-blocks` | 0 | 0 |
| `import/no-unassigned-import` (allow css) | 0 | 1 |
| `typescript/ban-ts-comment` (expect-error w/ description) | 0 | 0 |
| `typescript/no-explicit-any` | 1 | 6 |
| `typescript/consistent-type-imports` (inline) | 12 | 9 |
| `typescript/no-import-type-side-effects` | 1 | 0 |
| `typescript/consistent-type-assertions` (`as`, literals never) | 7 | 2 |
| `typescript/no-redundant-type-constituents` | 2 | 4 |
| `typescript/no-base-to-string` | 2 | 1 |
| `typescript/await-thenable` | 5 | 1 |
| `typescript/no-floating-promises` | 1 | 0 |
| `typescript/no-misused-promises` | 0 | 0 |
| `typescript/switch-exhaustiveness-check` | 0 | 0 |
| `typescript/restrict-template-expressions` | 2 | 0 |
| `typescript/no-implied-eval`, `no-misused-spread` | 0 | 0 |
| `typescript/require-array-sort-compare` | 1 | 2 |
| `typescript/unbound-method` | 0 | 0 |
| `typescript/no-unnecessary-type-constraint`, `no-useless-empty-export` | 0 | 0 |
| `typescript/no-unnecessary-type-conversion` | 19 | 21 |
| `typescript/no-unnecessary-type-arguments` | 4 | 0 |
| `typescript/no-unnecessary-boolean-literal-compare` | 1 | 2 |
| `typescript/consistent-return` | 3 | 17 |
| `typescript/no-unused-vars` (`^_`) | 0 | 11 |
| `typescript/no-extraneous-class` | 0 | 4 |
| `promise/always-return` | 0 | 7 |
| `promise/catch-or-return` | 0 | 0 |
| `eslint/no-var`, `prefer-const` | 3 | 1 |
| `eslint/no-eq-null` | 1 | 3 |
| `eslint/default-case` | 2 | 6 |
| `eslint/no-shadow` | 4 | 8 |
| `eslint/no-useless-constructor`, `no-unneeded-ternary`, `no-useless-concat` | 0 | 0 |
| `eslint/no-useless-escape` | 0 | 3 |
| `eslint/max-depth` (5) | 0 | 2 |
| `eslint/max-nested-callbacks` (4) | 2 | 0 |
| `eslint/no-console` (allowed: `packages/cli` output seam, `packages/*/bin`) | 19 | 18 |
| `eslint/no-await-in-loop` (perf; off in tests) | 2 | 5 |
| `node/no-process-env` (allowed: config seam module) | 9 | 0 |
| `oxc/no-accumulating-spread` | 2 | 0 |
| `oxc/no-map-spread` | 6 | 9 |
| `oxc/misrefactored-assign-op` | 0 | 0 |
| `unicorn/no-abusive-eslint-disable`, `prefer-array-flat-map`, `no-accessor-recursion` | 0 | 0 |
| `unicorn/no-array-reverse` | 2 | 1 |
| `unicorn/prefer-add-event-listener`, `no-useless-spread`, `no-useless-fallback-in-spread`, `no-new-array` | 0 | 4/2/2/2 |
| `react/exhaustive-deps`, `react/rules-of-hooks` | — | 0 / 3 |
| `react/button-has-type`, `react/no-danger` | — | 0 |
| `react/no-array-index-key` | — | 7 |
| `react/no-children-prop` | — | 13 |
| `react/no-did-update-set-state` | — | 2 |
| `react/only-export-components` (`allowConstantExport`) | — | 5 |
| `react/react-in-jsx-scope` | — | off |

### A.5 oxlint rules — Tier R (ratchet lane) and disable+GAP

| Rule | be | ui | State | Promote when |
|---|---|---|---|---|
| `typescript/no-non-null-assertion` | 232 | 400 | lane:R | non-test 0 (`d1`/`d2`); tests later |
| `typescript/no-unsafe-type-assertion` | 156 | 191 | lane:R (tests off) | 0 |
| `typescript/no-unnecessary-type-assertion` | 28 | 227 | lane:R | autofix → immediately |
| `typescript/strict-boolean-expressions` | 79 | 262 | lane:R | 0 |
| `typescript/no-unnecessary-condition` | 10 | 86 | lane:R | 0 |
| `typescript/require-await` | 8 | 73 | lane:R | 0 |
| `unicorn/no-array-sort` | 48 | 61 | lane:R | 0 |
| `eslint/complexity` (20) | 6 | 23 | **disable+GAP** (error) | `d1` fixes 6; `d2` disables 23 with GAP nodes |
| `eslint/max-lines-per-function` (120) | 24 | 62 | lane:R (forever) | never |
| `eslint/max-params` (5) | 0 | 2 | lane:R (forever) | never |
| `eslint/max-lines` (900) | 1 | 2 | lane:R (forever) | never |
| `unicorn/consistent-function-scoping` | 6 | 8 | lane:R (forever) | never |
| `typescript/no-deprecated` | 2 | 102 | lane:A | n/a |

### A.6 oxlint rules — rejected

| Rule | be | ui | Why |
|---|---|---|---|
| `typescript/array-type` (generic) | 408 | 450 | style; no bug story |
| `eslint/no-underscore-dangle` | 2 | 9 | style |
| `import/no-named-as-default-member` | 180 | 0 | false-positive class (`fc.*` namespace) |

### A.7 `@effect/tsgo` diagnostics (be)

| Group | Diagnostics | State |
|---|---|---|
| correctness | `floatingEffect`, `missingEffectError`, `missingEffectContext`, `missingLayerContext`, `missingStarInYieldEffectGen`, `missingReturnYieldStar`, `outdatedApi`, `classSelfMismatch`, `duplicatePackage`, `anyUnknownInErrorContext`, `unsupportedServiceAccessors` | error |
| anti-patterns | `tryCatchInEffectGen`, `runEffectInsideEffect`, `leakingRequirements`†, `unknownInEffectCatch` (1), `globalErrorInEffectCatch` (6), `globalErrorInEffectFailure` (12), `multipleEffectProvide` (6), `scopeInLayerEffect`, `lazyEffect`† (2), `schemaNumber`† (1), `unnecessaryFailYieldableError` (2) | lane:R → error (`d1`; † Track 2) |
| Effect-native preferences | `processEnv`, `globalDate`, `globalConsole`, `globalRandom`, `globalTimers`, `asyncFunction` | lane:R |
| style | `missedPipeableOpportunity`, `effectFnOpportunity`, `importFromBarrel` | off |
| duplicate guard removed | `tests/dst/guard.test.ts` grep for `Date.now`/`Math.random` | delete when `globalDate`/`globalRandom` are `error` |

### A.8 Formatter, dead code, tests

| Measure | Today | State |
|---|---|---|
| `vp fmt --check` (pinned config file) | 77 + 180 files drift | on after one format-only commit |
| `knip --include files,dependencies,exports,types,nsExports,nsTypes,duplicates` | 113 exports, 33 types, 1 dup, 1 devDep, 4 hints | lane:A → on after `d1`/`d2` |
| `index.ts` dead "kb M1" stub | knip entry | delete (`g2`) |
| `bun test` explicit paths; bunfig ignore list deleted | recursive + 6 ignores | on |
| Stryker: pure core only, `testRunner: command`, no `thresholds`, weekly | `break: 60` | advisory (remove threshold) |
| Coverage | none | reporter only, never a gate (recorded) |
| Playwright render suite | manual | unchanged (manual) |

### A.9 Harness checks (`packages/harness`, `bun test`)

| # | Check | Red case to demonstrate |
|---|---|---|
| 1 | `lint-scope-coverage` — every tracked/untracked-not-ignored TS file in exactly one lint scope parsed from the `lint` script | add an unlinted dir |
| 2 | `lint-warn-ratchet` — two lanes, rise fails, `warn` at 0 fails ("promote"), unknown rule = rise from 0; ingests tsgo warnings | add one `!` |
| 3 | `tsconfig-contract` — base = DESIGN.md table; packages extend and redeclare nothing; base has no module/target/paths | flip a flag |
| 4 | `skip-pairing` — every `.skip`/`.todo` has `GAP [[id]]` within 3 lines; grandfather list empty | add a bare skip |
| 5 | `gap-markers-resolve` — every `GAP [[id]]` and every `oxlint-disable* -- GAP [[id]]` names an existing `#gap` node; every `oxlint-disable` carries one | fake id |
| 6 | `no-conflict-markers` | commit a marker |
| 7 | `boundaries` — `nx graph --file` deps × package tags satisfy the D11 matrix; every package has both axes | import infra from application |
| 8 | `public-surface` — every package: single `.` export, named exports only, no `export *` | add `export *` |
| 9 | `scripts-chain-exists`; no `prepare`/`postinstall` compiles | chain to a missing script |
| 10 | `datascript-shim-typechecks` — `datascript.d.ts` under `skipLibCheck:false` in isolation | break the shim |
| 11 | `version-authored-once` — `workspace:*`/`catalog:` everywhere; no floating; `minimumReleaseAge ≥ 4320`; trusted deps explicit | add a literal version |
| 12 | `gitignore-covers-derived` — `nodes.jsonl.lock`, `.kb/cache/`, `*.bak`, mutation reports | remove a line |
| 13 | `workspace-shape` — every dir under `packages/` is a workspace member with `name`, `private`, `exports`, `nx.tags`, `scripts.{typecheck,lint,test?}` | drop a tag |

### A.10 Gates

| Gate | Runs | Content |
|---|---|---|
| `bun run verify` | pre-commit (when `tools/kb/**` staged; warn-skip if deps missing) and CI | `typecheck` (all packages, incl. tsgo) → `lint` (type-aware, all scopes) → `fmt:check` → `knip` → `harness` |
| `bun run test` / `test:ui` / `test:dst` | CI | suites |
| `docs-check`, `check-kb-assets-backup.sh` | pre-commit + CI | unchanged |
| Stryker weekly | CI cron | advisory |

### A.11 Rules & docs (`r2`)

| Measure | Home |
|---|---|
| Rule 1 + symptom list + reviewer test + bridges-over-mirrors + dead-seam | `CLAUDE.md` |
| Canonical-statement rule; D12 two-mechanism rule; `GAP [[id]]` marker | `CLAUDE.md` |
| Effect pointer + v4 non-negotiables | `CLAUDE.md` |
| `#rule` / `#gap` tags; enforcement option nodes; `docs/kb/rules.md` | `.kb`, docs ext |
| Compiler strictness contract table | `tools/kb/DESIGN.md` |
| Testing doctrine (property anti-patterns, coverage signal, mutation advisory, L1/L2/L3) | `tools/kb/DESIGN.md` |
| Domain typing → Effect `Schema` (no optional-where-discriminated, literal discriminators, one canonical schema) | `tools/kb/DESIGN.md` |

## Appendix B — the full `tools/kb/.oxlintrc.json` (target, deduplicated)

Checked against `oxlint --rules --format=json` (1.76.0): with `correctness`,
`suspicious`, `perf` at `error`, **45 of the rules first listed were already
on** and are not repeated below. The explicit block now contains only (a) rules
from categories we do not enable wholesale (`restriction`, `pedantic`, `style`,
`nursery`), (b) severity overrides where a lane differs from its category, and
(c) rules that need options. Appendix A.4 remains the human-readable inventory
of everything that is on, whichever mechanism turns it on.

Auto-on via categories and worth knowing about (no config line needed):
`eslint/no-unused-vars`, `no-await-in-loop` (perf), `no-eval`, `no-constant-condition`,
`typescript/{await-thenable,no-floating-promises,unbound-method,no-base-to-string,
restrict-template-expressions,no-implied-eval,no-misused-spread,
require-array-sort-compare,no-redundant-type-constituents,consistent-return,
no-unnecessary-type-{conversion,arguments},no-unnecessary-boolean-literal-compare,
no-extraneous-class,no-useless-empty-export}`, `import/{no-self-import,
no-empty-named-blocks,no-unassigned-import,no-named-as-default(-member)}`,
`promise/always-return`, `eslint/{no-shadow,no-useless-*,no-unneeded-ternary}`,
`oxc/{no-accumulating-spread,no-map-spread,misrefactored-assign-op}`,
`unicorn/{prefer-array-flat-map,no-accessor-recursion,no-array-reverse,
prefer-add-event-listener,no-useless-spread,no-useless-fallback-in-spread,
no-new-array,no-array-sort,consistent-function-scoping}`,
`react/{exhaustive-deps,no-array-index-key,no-children-prop,
no-did-update-set-state,jsx-key,no-unstable-nested-components,…}`.

Paths assume D11's layout. `g2` lands it verbatim, then re-snapshots the
ratchet baseline.

```jsonc
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  // One lint config for the whole workspace. oxlint is the only linter.
  // Categories are cherry-picked, never adopted wholesale (refrepo spec 20:
  // pedantic 4,099 / style 37,580 / restriction 11,375 findings).
  // Soft rules use exactly one of two mechanisms (plan D12):
  //   lane:R  -> "warn" + frozen count in packages/harness/lint-warn-baseline.json
  //   GAP     -> "error" + `// oxlint-disable-next-line <rule> -- GAP [[node-id]]`
  // A rule appears below only if (a) its category is not enabled, (b) its
  // severity differs from its category, or (c) it needs options. Everything in
  // correctness/suspicious/perf is on without being named (plan Appendix A.4).
  // Rejected with counts: typescript/array-type (858, style),
  // eslint/no-underscore-dangle (11, style), import/no-named-as-default-member
  // (180, all fast-check `fc.*` namespace calls).
  "plugins": ["eslint", "typescript", "react", "import", "unicorn", "oxc", "promise", "node"],
  "env": { "builtin": true },
  "ignorePatterns": ["**/dist/**", "**/node_modules/**", "**/storybook-static/**", "packages/ext-sdk/generated/**"],
  "categories": {
    "correctness": "error",
    "suspicious": "error",
    "perf": "error"
  },
  "rules": {
    // ---- (a) not in an enabled category: imports
    "import/no-cycle": "error",                                   // restriction
    "import/no-duplicates": "error",                              // style

    // ---- (a) type safety, non type-aware
    "typescript/ban-ts-comment": ["error", { "ts-expect-error": "allow-with-description" }], // pedantic
    "typescript/no-explicit-any": "error",                        // restriction
    "typescript/consistent-type-imports": ["error", { "fixStyle": "inline-type-imports" }],  // style
    "typescript/no-import-type-side-effects": "error",            // restriction
    "typescript/consistent-type-assertions": ["error", { "assertionStyle": "as", "objectLiteralTypeAssertions": "never" }], // style
    "typescript/no-non-null-assertion": "warn",                   // restriction; lane:R 232+400

    // ---- (a) type-aware, not in an enabled category
    "typescript/no-misused-promises": "error",                    // pedantic
    "typescript/switch-exhaustiveness-check": "error",            // pedantic
    "typescript/strict-boolean-expressions": "warn",              // pedantic; lane:R 79+262
    "typescript/no-unnecessary-condition": "warn",                // nursery;  lane:R 10+86
    "typescript/require-await": "warn",                           // pedantic; lane:R 8+73
    "typescript/no-deprecated": "warn",                           // pedantic; lane:A 2+102

    // ---- (b) severity overrides on category rules (lane:R)
    "typescript/no-unnecessary-type-assertion": "warn",           // suspicious; 28+227, autofix → promote
    "typescript/no-unsafe-type-assertion": "warn",                // suspicious; 156+191
    "unicorn/no-array-sort": "warn",                              // suspicious; 48+61
    "unicorn/consistent-function-scoping": "warn",                // suspicious; lane:R forever

    // ---- (b) category rules turned off (rejected)
    "eslint/no-underscore-dangle": "off",                         // suspicious; style-only
    "import/no-named-as-default-member": "off",                   // suspicious; fc.* false positives
    "react/react-in-jsx-scope": "off",                            // suspicious; React 19 runtime

    // ---- (c) options on a category rule
    "eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],

    // ---- (a) promises
    "promise/catch-or-return": "error",                           // restriction

    // ---- (a) core JS
    "eslint/no-var": "error",                                     // restriction
    "eslint/prefer-const": "error",                               // style
    "eslint/no-eq-null": "error",                                 // restriction
    "eslint/default-case": "error",                               // restriction
    "eslint/no-console": "error",                                 // restriction

    // ---- (a) L2 branching sensors (gate) and size sensors (signal)
    "eslint/complexity": ["error", 20],                           // restriction; GAP mechanism in ui
    "eslint/max-depth": ["error", 5],                             // pedantic
    "eslint/max-nested-callbacks": ["error", 4],                  // pedantic
    "eslint/max-lines-per-function": ["warn", { "max": 120 }],    // pedantic; lane:R forever
    "eslint/max-params": ["warn", 5],                             // style;    lane:R forever
    "eslint/max-lines": ["warn", { "max": 900 }],                 // pedantic; lane:R forever

    // ---- (a) unicorn / node / react
    "unicorn/no-abusive-eslint-disable": "error",                 // restriction
    "node/no-process-env": "error",                               // restriction
    "react/rules-of-hooks": "error",                              // pedantic (!)
    "react/button-has-type": "error",                             // restriction
    "react/no-danger": "error",                                   // restriction
    "react/only-export-components": ["error", { "allowConstantExport": true }] // restriction
  },
  "overrides": [
    {
      // Isomorphism fence: scope:shared packages run in the browser too.
      // The Nx graph cannot see runtime builtins, so this lives here (w1 §2).
      "files": ["packages/model/**", "packages/canvas/**", "packages/query/**", "packages/contracts/**", "packages/ext-sdk/**"],
      "rules": {
        "eslint/no-restricted-imports": ["error", {
          "patterns": [{ "regex": "^(bun:|node:|@effect/platform-bun)", "message": "scope:shared packages are isomorphic; runtime access belongs in an infrastructure or app package." }]
        }]
      }
    },
    {
      // Test files and the repo-shape harness: assertion-shaped code is fine;
      // a floating Effect/Promise in a test is a silently passing test, so
      // no-floating-promises stays ON here.
      "files": ["**/*.test.ts", "**/*.test.tsx", "**/tests/**", "packages/harness/**", "**/*.stories.tsx"],
      "rules": {
        "eslint/no-console": "off",
        "eslint/no-await-in-loop": "off",
        "typescript/no-unsafe-type-assertion": "off",
        "typescript/consistent-type-assertions": "off"
      }
    },
    {
      // The one place process.env is read: the config seam.
      "files": ["packages/server/src/paths.ts"],
      "rules": { "node/no-process-env": "off" }
    },
    {
      // Console is the CLI's output channel, and the bin entrypoints'.
      "files": ["packages/cli/src/output.ts", "packages/*/bin/**"],
      "rules": { "eslint/no-console": "off" }
    },
    {
      "files": ["**/*.css"],
      "rules": {}
    }
  ]
}
```

Invocation (one scope map; harness check 1 parses this line):

```jsonc
"lint": "oxlint --config .oxlintrc.json --type-aware packages"
```

## Run log (autonomous night run, 2026-09-03)

Owner instruction: keep running until Track 1 is done; then burn ratchet lanes
to 0 where possible; anything needing a *logical* change (behaviour, API,
data model) is **not** done — it is recorded under "Needs owner" below.
Harness ratio claude : omp : cursor ≈ 2 : 1 : 1 (omp dropped after its quota
wall; burn-down ran claude ×2, cursor ×1). Scheduling after `w1`/`r2`
goes through **Orca orchestration**: Run `run_d4ff6636ad03`; tasks
`g2`=`task_62e58dada703`, `d1`=`task_d04ba1e30694`, `d2`=`task_dc3d24cae723`,
`d3`=`task_71eebf5eac2b` (d1/d2/d3 depend on g2). Inspect with
`orca orchestration task-list --run run_d4ff6636ad03 --json`.

| Wave | Harness | Branch | Status |
|---|---|---|---|
| `w1-workspace` | claude opus | `worktree-agent-afc5f21d10581247f` @ `6ab1b1d` | **done** — 10 commits, verify green, `nix build .#kb` ok, report `reports/w1-workspace.md`; drop `f18150a` (release-pin refresh) at merge |
| `r2-rules` | claude opus | `worktree-agent-a82ac792607c64b1a` | **done** — 4 commits, report `reports/r2-rules.md` |
| `g2-strict-stack` | omp (Gemini 3.8 Flash default) | `feature/g2-strict-stack` @ `cd6a5b9` (Orca worktree `/Volumes/Data/workspace/repos/_worktrees/.dotfiles/g2-strict-stack`) | **done** — one commit; coordinator re-ran `bun run verify`: green in 33s; 13 harness checks, 36 tests; report `reports/g2-strict-stack.md`. Review found: 15/17 package tsconfigs repeat the same ~50-line runtime+Effect-plugin block (Rule 1) and knip prints ~20 config hints → `g2b` |
| `g2b-tsconfig-presets` | omp → **claude** (omp's Gemini 3.8 Flash hit a 429 quota wall at 4/7 todos, resets 2026-09-03T23:20Z; dispatch `ctx_8f85f6d71298` stopped, work left uncommitted in the tree and handed to a claude worker as `g2b-finish`) | `feature/g2-strict-stack` @ `ed068af` | **done** as `g2b-finish` (claude opus high): two presets, 17 package tsconfigs = extends+include (−881 lines), preset chosen from the scope tag, sanctioned deltas declared with reasons, JSONC reader in harness, nx `sharedGlobals` includes presets, knip hints 20→0, verify green (harness 39/39), 6 red→green cases; report §6 notes the g2 report's `Effect.fail` exit-1 claim was wrong under the shipped config. Original task `task_280d73708075` marked failed (omp quota). Was: base → `tsconfig.bun.json`/`tsconfig.browser.json` presets, packages declare only `include`; knip hint-free |
| `d1-drain-backend` | cursor grok 4.6 high | `feature/d1-drain-backend` (child of g2 @ `cd6a5b9`) | **done** after ~6.5h — 2 commits (`564dacf` drain+promote+snapshot, `757b0b6` report), verify green; 11 §d1 rules → 0 in backend and promoted (global / backend-all / backend-src scopes), ratchet 64→59 blocking, one `ensureDomainError` mapper, one `kbRuntimeLayer` provide, output seam `runtime/src/output.ts`, config seam `server/src/paths.ts`, 6 complexity offenders SLAP-extracted, backend knip exports 0. Left: `exactOptionalPropertyTypes` (17), test non-null (201), Store-port tsgo (Track 2). First attempt `ctx_bd1c460eed20` died on Cursor's trust prompt. |
| `i1-integrate-d1` | claude opus high | `feature/i1-integrate-d1` → fast-forwarded into `kb-wave/2026-09-03` | **done** — merge `2d874a3` + report `ba1e039`; 12 conflicts resolved as guided; union of d1+d2 promotions unlocked 13 more rules to global `error`; ledger 59→**40** blocking; verify green, `bun test packages` 354/1 (known-red benchmark only), ui 630/630. Coordinator then closed gap `01M1M08VXGJ5RTQJ3AJNK12G79` (`status=done`) → `c541b27`. **Track 1 integrated at `c541b27`.** |
| `d2-drain-ui` | claude opus high | `feature/d2-drain-ui` (child of g2 @ `cd6a5b9`) | **done** — 13 commits, verify green; ui findings 1378→881, 19 rules to 0, 11 promoted warn→error with red→green; complexity 23→0 (23 disables + 23 `#gap` nodes), no-deprecated 102→10 (92 phosphor renames, 10 gapped), one real `rules-of-hooks` bug fixed; 30 `#gap` nodes via `kb`; report `reports/d2-drain-ui.md` §7 = needs-owner list. Merged into integration (`038fba2`, one conflict: ui lib ESNext moved into `tsconfig.browser.json`), verify green |
| `d3-template-seam` | claude opus high | `feature/d3-template-seam` (child of g2 @ `cd6a5b9`) | **done** — 3 commits (`0b7f4b8` templates as extension contributions, `1d1bd9f` r2's rules template ported, mutation + GAP marker gone), verify green, report `reports/d3-template-seam.md`; gap `01M1M08VXGJ5RTQJ3AJNK12G79` closes at integration (flip node then). Was: extensions contribute render templates through the extension contract (same shape as actions); removes the `templates["rules"] =` mutation in `extensions-bundled/docs.ts` (gap `01M1M08VXGJ5RTQJ3AJNK12G79`) |
| `b1-burndown-backend` | claude opus high | `feature/b1-burndown-backend` (child of `c541b27`) | **done** @ `c9d6472` — 13 small-count rules → 0 + promoted (all backend-only); 5 tsgo diagnostics promoted; Effect suggestions drained through `output.ts` / `ensureDomainError` / `paths.ts`; ratchet tsgo collector counts suggestions only under `packages/*/src/` (`asyncFunction` 303→68, red→green test, DESIGN.md 'Ratchet scope'); ledger 40→21 blocking; verify green. Merged into integration (`f4a4eb9`, baseline re-snapshotted). Was: 13 small-count rules → 0 + promote; Effect suggestions in backend src via existing seams (not `globalDate`, not Store-port tsgo); ratchet counts Effect *suggestions* only under `src/` (documented + harness test) |
| `b2-burndown-backend-tests` | cursor grok 4.6 high | `feature/b2-burndown-backend-tests` (child of `c541b27`) | **done** @ `23eda39` — one `expectDefined` helper in `@kb/test-kit`; `no-non-null-assertion` 592→391 and `strict-boolean-expressions` 272→245 (rest is ui); both widened to backend-all `error`, `no-confusing-non-null-assertion` promoted globally; verify green. Merged into integration (`1a709f4`; conflicts: oxlintrc union, b1's guard form kept in workspace-shape test, baseline re-snapshotted). Was: backend test `no-non-null-assertion` 201 + `strict-boolean-expressions` 28 via one test-kit narrowing helper; widen promotions to backend-all |
| `b3-burndown-ui` | claude opus high | `feature/b3-burndown-ui` (child of `c541b27`) | **done** — 4 fix commits + report @ `92bdddb`; ui 881→801, ledger findings 1586→1506 (`strict-boolean-expressions` 272→227, `no-unsafe-type-assertion` 143→127, `no-unnecessary-condition` 50→31); no rule reached 0 in both scopes so nothing promoted; verify green, ui 629/630 (palette perf bar, fails identically on base). Remaining 391/185/78/30 listed with file:line in report §Needs owner. Merged into integration. |
| `c1-lint-policy` (day 2) | coordinator | `kb-wave/2026-09-03` @ `5a052f7` | **done** — owner decisions of 2026-09-04 applied to config: `oxc/no-map-spread` rejected (off, recorded in DESIGN.md); refrepo caps `max-depth` 5 / `max-nested-callbacks` 4 (warn until the 3 sites are fixed, then error); test files exempt from `max-lines-per-function` and `max-nested-callbacks`; ratchet 21 rules / 906 |
| `b4-tighten-ui-src` | claude opus high | `feature/b4-tighten-ui-src` @ `764a2a6` (child of `5a052f7`), Orca `task_97a0241b6354` / `ctx_20cf41b6762a` | **done, merged** `2163540` (+ promotion `d61fd59`) — 7 commits; ui src 444→48 findings: strict-boolean 195→0, non-null 91→0, unnecessary-condition 23→0, unsafe-assert 78→4, depth/params/await-in-loop/function-scoping → 0, deprecated 7→5; 10 owned helpers (`lib/dom.ts`, `lib/text.ts`, `force3d-instance.ts` seam, `EnumSelect`, …), 3 duplicate implementations deleted; 8 behaviour changes all under §0; left: 4 assertions (`ActionReceiptSchema` belongs to contracts/b6, 2 vendor typings, `caret.ts` document cast), 5 own `@deprecated` markers with gap nodes, 37 functions > 120 lines listed; report `reports/b4-tighten-ui-src.md` |
| `b5-tighten-ui-tests` | cursor grok 4.6 high | `feature/b5-tighten-ui-tests` @ `5896151` (child of `5a052f7`), Orca `task_7fabe6ce4ed1` / `ctx_30f5b933f297` | **done, merged** `4ee9418` — ui tests: non-null 300→0 (232 `present` calls, rest restructured), unnecessary-condition 7→0, strict-boolean 5→0, function-scoping 5→0, deprecated 3→0; verify green, test:ui 630/630; report `reports/b5-tighten-ui-tests.md` |
| `b6-tighten-backend` | claude opus high | `feature/b6-tighten-backend` @ `9090d6a` (child of `5a052f7`), Orca `task_c026370817ab` / `ctx_8e9f8304932b` | **done, merged** `5813670` — 8 commits; Effect lane 82→1 (asyncFunction 68→0 via one Effect edge per package: CLI command table, `serveUi`, `bindMcpHandlers`; Clock for time incl. canvas stamp; tagged errors; store port no longer requires FileSystem), backend unsafe-assert 49→4, await-in-loop/function-scoping/nested-callbacks → 0, `expectDefined` retired for `present` (205 sites), ratchet collector skips `scope:tooling`; 11 behaviour changes all under §0 (notably `--type` parsed, `num` must be finite, canvas stamp deterministic); merge dropped b6's prettier sweep over 5 doc files; report `reports/b6-tighten-backend.md` |
| `r4-backend-recon` (Track 2, owner-queued 2026-09-04) | claude opus high | `feature/r4-backend-recon` @ `9cab3e3`, Orca `task_f5079e90ee06` / `ctx_9300497c415a` | **done, merged** `b0b06db` (docs only) — 10 configurations at 100k/1M datoms; p1's memory trigger is the wrong metric (320 vs 348 MB heap), query latency is the wall: closure 1570 ms DataScript vs 5.4 ms `bun:sqlite` (294×), reopen 150×, scans 14×; **recommends `SqliteIndex` behind p1's `KbIndex` port, drop p1 Phase 3**; DuckDB and LadybugDB re-opened with dated facts and re-rejected on fit; Oxigraph fallback; TerminusDB daemon-only, rejected on shape (§5.8); 2 live defects in `tools/kb` (rules never normalized; `child-order` join is cartesian); proposed p1 §0 diff in README §9 **not applied — owner decision**; report `reports/backend-recon/README.md` |
| `f1-leftovers-mechanical` | cursor grok 4.6 high | `feature/f1-leftovers-mechanical` @ `3c4e2e5` (child of `5813670`), Orca `task_2bbb7253923e` / `ctx_8938a22e13e2` | **done, merged** — 7 commits; `ActionReceiptSchema` (zod, in contracts/actions.ts — f2 conflict resolved at integration if any), `caretRangeFromPoint` bound (Chrome click-to-caret fixed), legacy localStorage migration deleted (gap `01M1MGT2A6Y9ZVG5J1CGJMJ2AH` closed; pre-migration keys stranded), MCP `Server` pinpoints, harness impossible branch; `no-unnecessary-condition` → 0; 2 new gaps: caret `CaretDocument` cast `01M1P2R0XMSK1MRVQ8P2JH5V0Z`, 3d-force-graph typings `01M1P2RAJVTB4CESYGEVF7NDE1`; verify green, test:ui 631/631; report `reports/f1-leftovers-mechanical.md` |
| `f2-effect-promotion` | claude opus high | `feature/f2-effect-promotion` @ `16b16f9` (child of `5813670`), Orca `task_c4b639dec88b` / `ctx_3806421596c1` | **done, merged** `8a93135` — 8 commits; chose per-path `@effect/language-service` `overrides` (option b: `plugins` is replaced across `extends`, so a test preset would mirror the severity map) → 15 Effect diagnostics promoted to `error` under `packages/*/src/**` minus `scope:tooling`; new harness `typecheck-scope` check + one `scopes.ts` reader; extension contract decoded via Schema (`ActionHandlerError`, `CodedError`), backend assertions 4→1 (registry seam, pinpointed); ext-sdk generator moved to `scripts/`; `cursorPosition` proven dead and deleted (gap `01M1MGT307N4K243CBPJTXNG5X` closed; new gap `01M1P63E3Y5KVHV3XMM6TBV2BM`: 23 ui tests hand-copy the store reset); 3 behaviour changes (store shape, generator path string, Schema-formatted loader errors); report `reports/f2-effect-promotion.md` |

Integration: branch `kb-wave/2026-09-03` (worktree
`/Volumes/Data/workspace/repos/_worktrees/.dotfiles/kb-wave-integration`) =
`w1` ← `g2`+`g2b` (`ed068af`) ← `d3` (merged clean, verify green) ← `d2` (merged, verify green) ← `r2` (merged `f4d0724`: docs.ts dropped for d3's seam, DESIGN.md = g2/d3 tooling+contract + r2 doctrine sections, nodes.jsonl union, rules.md re-materialized `6d05ad4`, verify + docs.check green) ← `d1` (merged in that order, conflicts resolved by the coordinator; ratchet
re-snapshotted once at the end). **Nothing lands
on `main`**; owner reviews the integration branch.

### g2 deviations from the brief (accepted by coordinator)

- `ignoreEffectSuggestionsInTscExitCode: true` (brief said `false`): Effect
  *suggestions* are counted in the ratchet baseline instead of failing `tsc`
  until `d1` drains them; correctness diagnostics are `error` and do fail `tsc`
  (proved red→green with `Effect.fail(new Error())`).
- `eslint/complexity` and `react-hooks/rules-of-hooks` sit in the ratchet lane
  (30 / 3) instead of `error`; same end state once `d1`/`d2` reach 0. The 3
  `rules-of-hooks` hits are real-bug candidates for `d2`.
- `exactOptionalPropertyTypes` recorded `deferred` (17 backend + 31 ui sites)
  — drained by `d1`/`d2`, then flipped `on`.

### Needs owner

- **b3 found a real latent ui bug and deliberately preserved it**:
  `ui/src/components/outline/caret.ts` calls `caretRangeFromPoint` unbound, so
  Chrome's preferred click-to-caret path silently falls through to `null`.
  One-line fix, but it changes behaviour → your call.

- **d1 `present()` throws a plain `Error`, not `DomainError`**, to avoid an
  import cycle (`ontology → errors → resolve`); Effect boundaries fold it via
  `ensureDomainError`. Acceptable seam or should the cycle be broken the other
  way? d1 flagged it.
- **d1 shipped one source+promotion+snapshot commit** instead of one per rule
  (fixes land in the same files; harness/oxlint ordering constraints make a
  per-rule series need `git add -p`). Promotions are still scoped.

- **d2 remaining ui ratchet counts are not mechanical** (d2's judgment, opus):
  `no-non-null-assertion` 391, `strict-boolean-expressions` 245,
  `no-unsafe-type-assertion` 94, `no-unnecessary-condition` 49, `max-depth` 12
  — per-site narrowing or behaviour decisions. d2 recommends **rejecting**
  `oxc/no-map-spread` (its fix mutates immutable store data) and keeping the 4
  `no-await-in-loop` sites (deliberately sequential protocols). Coordinator will
  attempt one more mechanical pass on `no-non-null-assertion` /
  `no-unnecessary-type-assertion` classes in the burn-down; the rest stays.
- **d2 scoped `require-await` out of test files** (one-line rule-scope call;
  revert if you disagree).
- **Harness check 5 (`gap-markers-resolve`) second half** "unimplementable as
  written without inventing 8 fake gaps" — d2's words; see its report §7.
- **Three tests are wall-clock flaky under load** (ui palette perf,
  editor-behavior transient prune, test-kit DST replay); reproduced failing on
  unmodified base files. Not fixed by anyone; recommend perf budgets become
  advisory or run isolated.

- **d3: `render.view` / `render.views` core actions now require the
  `TemplateRegistry` service and render nothing with no extension loaded.**
  Ruling needed: does `render.view` stay a core action (mechanism that renders
  whatever templates extensions contributed — coordinator's reading of "core is
  mechanism only"), or move to `@kb/ext-docs`?
- **d3: `docs/kb/rules.md` is committed as the empty render** on the d3 branch
  (rules nodes live on r2's branch). Re-run `docs.materialize` at integration
  — coordinator will do this, listed so the interim state is not mistaken for
  a bug.
- **Ratchet lane has no allowance for legitimately new code**: any new `async`
  test raises `effect/asyncFunction` and blocks the commit (d3 fixed 7
  would-be rises rather than absorbing them). Coordinator's fix for the
  burn-down phase: scope Effect *suggestion* diagnostics to `src/` (tests
  excluded), keep correctness diagnostics everywhere. Mechanical; flagged
  because it changes what the gate measures.

- **omp's default model is Gemini 3.8 Flash on a per-user quota.** It ran
  out mid-`g2b` (429, ~3h reset). Consider setting omp's default/slow model
  to a paid provider before using it for long waves; the omp share of the
  2:1:1 ratio was replaced by claude for the rest of the night.

- **w1 `f18150a` refresh GitHub release pins** — `intent/gate.sh` refuses `pkgs/`
  commits while pins are stale, so `pkgs/kb` could not land without it. Not
  kb work; drop or keep at merge (owner's call).
- **w1 changed git `core.hooksPath`** from the absolute main-checkout path to
  the relative `.githooks` that AGENTS.md documents, so worktrees run their
  own hook. Same behaviour in the main checkout; flagging because it is a
  local git-config change outside the repo.
- **w1 matrix deviations** from the brief: `extension → application` allowed,
  `test-support → app` allowed, `tooling` layer added, `scope:extension`
  dropped. Justified in `packages/harness/src/constraints.ts` + report §2.
  Review the justification; a logical choice, not a mechanical one.
- **`@kb/ext-canvas` stamps `updatedAt` from the wall clock** and persists it
  (determinism bypass the move exposed). Behaviour change to fix → owner.


## Day 2 (2026-09-04) — owner decisions on the remaining ledger

Owner, on the 21-rule / 965-finding remainder: (1) rule rejections at the
coordinator's discretion; (2) behaviour/type-changing fixes at the
coordinator's discretion — "we know the actual functionality, make code paths
as tight as possible, except utilities"; (3) size caps from refrepo, not
overdone. Categories question: `correctness`, `suspicious`, `perf` are at
`error` (refrepo has the first two); `pedantic`/`style`/`restriction` stay
opt-in per rule, as in refrepo.

Decisions taken (all reversible in `.oxlintrc.json` / DESIGN.md):

- **Rejected:** `oxc/no-map-spread` (14). Recorded in DESIGN.md "Ratchet
  scope".
- **Kept, fixed by policy:** `no-await-in-loop` (7) — restructure or pinpoint
  disable with reason, then `error` (two-mechanism rule, ≤ 30 sites).
- **Behaviour policy (b4/b5/b6 briefs §0):** id-shaped `string | undefined`
  → `!== undefined` (ids are never `""`; stated once in DESIGN.md); display
  text keeps exact semantics; impossible-state checks are deleted, not
  guarded; `present` from `@kb/model` is the single narrowing helper
  (`expectDefined` retired); type assertions become `instanceof` guards,
  typed adapters, or `Schema` parses; backend `async` → Effect with one edge
  per package; `Date`/timers → `Clock`/`Effect.sleep`; errors tagged.
- **Size (refrepo):** `complexity` 20 error, `max-depth` 5, `max-nested-callbacks`
  4 (error once the 3 sites close), `max-lines-per-function` 120 /
  `max-params` 5 / `max-lines` 900 stay `warn` on `src`; tests exempt from
  the function-length and nesting sensors. The ~40 functions over 120 lines
  are **not** force-split; they stay in the ratchet.
- **omp** skipped for this round: Orca's `--model` cannot select a non-quota
  model for omp, and its default Gemini 3.8 Flash 429'd last night.
  Ratio this round: claude ×2, cursor ×1.

Expected end state after integration: ledger = `max-lines-per-function`
(~40), `max-lines` (2); every other rule at `error`.

State after b4/b5/b6 merged (`5813670`): ledger **6 rules / 53** — `max-lines-per-function` 40, `max-lines` 2, `no-unsafe-type-assertion` 8, `no-unnecessary-condition` 1, `effect/anyUnknownInErrorContext` 1, `effect/globalConsole` 1; advisory `no-deprecated` 7. Promoted so far (`d61fd59`, `bbbeef0`): non-null, strict-boolean, max-depth, max-params, max-nested-callbacks, no-await-in-loop, consistent-function-scoping. f1/f2 target the six non-size entries.

## Day 2 close-out (2026-09-04 evening, coordinator)

**Merged to `main` @ `5e3e586` (2026-09-04, owner request).** Review branch `kb-wave/2026-09-03` @ **`7a908c1`** (`58cfa20` + the carried bug node) in
`/Volumes/Data/workspace/repos/_worktrees/.dotfiles/kb-wave-integration`:
99 commits over `main` @ `74cffa3`, tree clean. Gates on the head:
`bun run verify` green (harness 50/50), `bun test packages` 378/378,
`bun run test:ui` 631/631.

| | start of day 1 | morning of day 2 | now |
|---|---|---|---|
| ratchet ledger | 64 rules / ~2500 | 21 rules / 965 | **2 rules / 42** (`max-lines-per-function` 40, `max-lines` 2 — kept by policy) |
| advisory lane | — | `no-deprecated` 12 | **empty** |
| oxlint rules | — | 50 error / 13 warn / 4 off | **60 error / 2 warn / 5 off** |
| Effect diagnostics | all suggestion | 82 findings in `src/` | **0**; 14 preference diagnostics `error` under `packages/*/src/**` (per-path plugin override), suggestion elsewhere |

Day-2 waves: `c1` (policy), `b4`/`b5`/`b6` (drain), `f1`/`f2` (leftovers),
`r4` (Track 2 recon) — all merged; promotions `d61fd59`, `bbbeef0`, `58cfa20`.
Harness split: claude ×5 (b4, b6, f2, r4 + coordinator), cursor ×2 (b5, f1),
omp ×0 (quota model not selectable through Orca). Orca run
`run_d4ff6636ad03`: 17 tasks completed, 1 failed (omp g2b, superseded).

Behaviour changes shipped today, all under the owner's discretion of
2026-09-04 (each listed in its wave report §"Behaviour changes"): ids treated
as never-empty; impossible-state checks deleted; CLI `--type` parsed
(unknown → usage error); `num` props must be finite; canvas `updatedAt`
deterministic via Clock; `caretRangeFromPoint` bound (Chrome click-to-caret
works); legacy localStorage migration removed; `cursorPosition` deleted (dead);
extension-loader errors Schema-formatted; `present` is the one narrowing
helper (`expectDefined` gone).

Open owner decisions (new today):
- **r4 → p1 §0 diff** (`reports/backend-recon/README.md` §9): latency trigger
  replaces the memory trigger; DuckDB/Kuzu rejections corrected; Phase 3
  snapshot cache replaced by `SqliteIndex` behind the `KbIndex` port.
  Accepting it schedules p1 Phase 0–2 as the next waves.
- Two live defects r4 found (`reports/backend-recon/README.md` §8): rules
  vector never normalized (recursive rules via MCP throw); `:node/child-order`
  join is cartesian. Both belong in p1 2f; fix earlier if MCP users hit it.
- Gaps filed and open: `01M1P2R0XMSK1MRVQ8P2JH5V0Z` (caret cast vs lib.dom
  `@deprecated`), `01M1P2RAJVTB4CESYGEVF7NDE1` (3d-force-graph typings),
  `01M1P63E3Y5KVHV3XMM6TBV2BM` (23 ui tests hand-copy the store reset).
- Size sensors stay in the ratchet by decision; the 40 functions > 120 lines
  are listed in `reports/b4-tighten-ui-src.md` §5c and `b6` §7.

Worktrees to remove after review: `b4-tighten-ui-src`, `b5-tighten-ui-tests`,
`b6-tighten-backend`, `f1-leftovers-mechanical`, `f2-effect-promotion`,
`r4-backend-recon` under `/Volumes/Data/workspace/repos/_worktrees/.dotfiles/`
plus yesterday's list below.

## Morning report (2026-09-04, coordinator)

**Done.** Track 1 shipped and integrated; ratchet burn-down ran to the end of
what is mechanical. Nothing touched `main`.

| | |
|---|---|
| Review branch | `kb-wave/2026-09-03` @ `1a709f4`, worktree `/Volumes/Data/workspace/repos/_worktrees/.dotfiles/kb-wave-integration` |
| Base | `main` @ `74cffa3`; 56 commits, 7 merges, 501 files (+16670 / −16681) |
| Gates on the head | `bun run verify` green (typecheck 17/17, 0 oxlint errors, fmt, knip advisory, harness 39/39 + ratchet-scope test); `bun test packages` 362/0; `bun run test:ui` 629/630 (palette 50k perf bar, fails identically on `main`); `docs.check` green |
| oxlint rules | 50 `error` · 13 `warn` (ratchet) · 4 `off` (rejected, measured) |
| Ratchet ledger | 64 blocking rules / ~2500 findings at g2 → **21 rules / 965 findings** now; advisory `no-deprecated` 102 → 12 |
| kb nodes | +26 `#rule`, +39 `#gap` (r2 9 + d2 30), D8 done, template-ownership gap done; `docs/kb/rules.md` generated |

### What is left in the ledger and why it stayed

Every remaining count needs a decision, not a mechanical edit (per-site lists
with `file:line` are in the wave reports named):

| Rule | Count | Where | Why it stayed | Report |
|---|---|---|---|---|
| `no-non-null-assertion` | 391 | ui | app-wide invariants encoded as `!`; guard-or-lookup where local was done | b3 §Needs owner |
| `strict-boolean-expressions` | 200 | ui | nullable-string truthiness with real empty-string semantics | b3 |
| `no-unsafe-type-assertion` | 127 | ui | needs Schema parse at boundaries (design) | b3 |
| `no-unnecessary-condition` | 31 | ui | remaining ones encode defensive checks | b3 |
| `asyncFunction` (Effect) | 68 | backend src | `async` functions in src that are Effect-idiom decisions | b1 §7 |
| `max-lines-per-function` 75 · `consistent-function-scoping` 15 · `max-depth` 13 · `max-lines` 2 · `max-params` 2 | — | both | size sensors: **ratchet forever by plan** (A.5) | — |
| `oxc/no-map-spread` | 14 | ui | d2 recommends **reject** (fix = mutate immutable store data) | d2 §7 |
| `no-await-in-loop` | 7 | ui | deliberately sequential protocols; keep or disable+GAP | d2 §7 |
| `globalDate` 5 · `globalTimers` 1 | — | backend | wall-clock stamps / fs-watch debounce = behaviour | b1 §7 |
| `globalErrorInEffectFailure` 5 · `globalErrorInEffectCatch` 1 | — | cli | folding `UsageError`/`RootNotFoundError` into `DomainError` changes CLI exit codes | b1 §7 |
| `globalConsole` 3 · `anyUnknownInErrorContext` 1 | — | backend | boundary-fenced from the output seam | b1 §7 |
| `lazyEffect` 2 · `leakingRequirements` 1 · `schemaNumber` 1 | — | Store port | Track 2 (`p1-persistence`) | plan |

### How to review

1. `cd /Volumes/Data/workspace/repos/_worktrees/.dotfiles/kb-wave-integration && git log --oneline --merges 74cffa3..HEAD` — one merge per wave.
2. Reports, all committed on the branch: `docs/kb/waves/2026-09-03/reports/{w1-workspace,g2-strict-stack,d3-template-seam,d2-drain-ui,r2-rules,d1-drain-backend,i1-integrate-d1,b3-burndown-ui,b1-burndown-backend,b2-burndown-backend-tests}.md`.
3. **Needs owner** list above (this file) — the only decisions the night did not
   take. Nothing in it blocks merging the branch.
4. Merge is your call: `git merge --no-ff kb-wave/2026-09-03` onto `main`, or
   land the wave merges one at a time. Drop `f18150a` (release-pin refresh) if
   you do not want it. After merging, `rtk rebuild` (not run tonight) picks up
   the new `pkgs/kb`.

### Committed 2026-09-04

This file, `briefs/*`, `reports/recon-*.md`, `reports/measurements.md` and
`reports/datalog-vs-cypher/*` were untracked until 2026-09-04, when the whole
wave record moved from `docs/kb-waves/` to `docs/kb/waves/` and was committed
on `main` with the reference repo anonymised as "refrepo".

### Worktrees left in place (Orca-managed unless noted)

`g2-strict-stack`, `d1-drain-backend`, `d2-drain-ui`, `d3-template-seam`,
`i1-integrate-d1`, `b1-burndown-backend`, `b2-burndown-backend-tests`,
`b3-burndown-ui` under `/Volumes/Data/workspace/repos/_worktrees/.dotfiles/`;
`kb-wave-integration` (plain git worktree); `.claude/worktrees/agent-*` (w1, r2).
All are merged into the review branch; safe to remove after review.
Orca Run `run_d4ff6636ad03`: 9 tasks completed, 1 failed (omp `g2b`, superseded).
