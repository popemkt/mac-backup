# kb recon — tooling stack + persistence seam

Read-only reconnaissance of `/Users/popemkt/.dotfiles/tools/kb`. Nothing modified.
All paths absolute unless obviously relative to `/Users/popemkt/.dotfiles/`.

Sources read: `tools/kb/DESIGN.md`, `DESIGN-UI.md`, `DESIGN-REFINE.md`,
`DESIGN-RESKIN.md`, `INSPIRATIONS.md`, `README.md`, `ui/README.md`,
`ui/ARCHITECTURE.md`, `CLAUDE.md` §"kb — repo knowledge base",
`.githooks/pre-commit`, `.github/workflows/validate.yml`,
`.github/workflows/kb-mutation.yml`, and the source tree.

---

# PART A — TOOLING / QUALITY STACK (current state, exact)

## A.1 Packages and scripts

### Backend `tools/kb/package.json` (`name: "kb"`, private, `type: module`)

`tools/kb/package.json:10-22` — scripts:

| script | command |
|---|---|
| `test` | `bun test` |
| `test:mutation` | `stryker run` |
| `bench` | `bun test tests/benchmark.test.ts` |
| `typecheck` | `tsc --noEmit` (**authoritative** zero-error gate) |
| `lint` | `vp lint` (oxlint via Vite+) |
| `check` | `vp check --no-fmt` (lint-only here; typeCheck disabled) |
| `lint:all` | `oxlint --config .oxlintrc.json index.ts src ui/src extensions-bundled` |
| `knip` | `knip --include files,dependencies` |
| `verify` | `typecheck && check && lint:all && knip` ← the human/CI entry point |
| `fmt` | `vp fmt` |
| `gen:ext-sdk` | `bun scripts/gen-ext-sdk.ts` |

`tools/kb/package.json:23-40` — deps / devDeps:

- deps: `@effect/platform-bun 4.0.0-beta.106`, `@modelcontextprotocol/sdk ^1.30.0`,
  `commander ^13.1.0`, `datascript ^1.7.8`, `effect 4.0.0-beta.106`,
  `ulid ^3.0.2`, `zod ^4.4.3`
- devDeps: `@stryker-mutator/core ^10.0.0`, `@types/bun ^1.3.14`,
  `fast-check ^4.9.0`, `knip 6.32.2`, `typescript ^7.0.2`, `vite-plus 0.2.8`,
  `vitest 4.1.10`
- `bin.kb → ./src/surface/cli.ts`; note `bin/kb` is actually a bash shim that
  execs Bun (DESIGN.md:35-37). `index.ts` is a one-line stub
  (`tools/kb/index.ts:1`) that still prints "kb M1 …" — dead but knip-entry.

Installed (not declared): `oxlint 1.76.0` and **`oxlint-tsgolint`** are present in
`tools/kb/node_modules` and `tools/kb/ui/node_modules` (pulled in by `vite-plus`).

### UI `tools/kb/ui/package.json` (`name: "kb-ui"`)

`ui/package.json:6-19` — scripts: `dev`/`build`/`preview` (`vp`), `test` (`vp test`
= Vitest), `test:watch`, `test:render` (`vp build --mode test-render` + playwright),
`storybook` / `build-storybook`, `typecheck` (`tsc --noEmit`), `lint`, `check`, `fmt`.

deps (`ui/package.json:20-42`): `react ^19.2.0`, `react-dom ^19.2.0`,
`datascript ^1.7.8`, `zustand ^5.0.9`, `zod ^4.4.3`, `ulid ^3.0.2`,
`tailwindcss ^4.0.6` + `@tailwindcss/vite ^4.0.6`, `sigma ^3.0.3`,
`graphology ^0.26.0` (+ `-layout 0.6.1`, `-layout-forceatlas2 ^0.10.1`,
`-layout-noverlap 0.4.2`, `-communities-louvain 2.0.2`), `3d-force-graph ^1.80.0`,
`d3-hierarchy ^3.1.2`, `@phosphor-icons/react ^2.1.10`, `clsx`, `tailwind-merge`,
`@fontsource-variable/{inter,outfit}`.

devDeps: `@storybook/{react,react-vite,addon-a11y} ^10.5.10`, `storybook ^10.5.10`,
`@vitejs/plugin-react ^5.0.4`, `happy-dom ^20.11.2`, `playwright ^1.62.1`,
`typescript ^7.0.2`, `vite-plus 0.2.8`, `@types/react(-dom) ^19.2.0`,
`@types/d3-hierarchy`.

`ui/package.json:57-67` — `overrides`: `vite → npm:@voidzero-dev/vite-plus-core@0.2.8`,
`vitest → 4.1.10`; `devEngines.packageManager npm@12.0.2` with `onFail: download`
(this is why `ui/README.md:16-20` mandates `bun run`, never `npm run`).

**Note: `tools/kb/ui` has no `verify` script and no `knip`/`stryker` of its own.**
UI is covered by the root package's `lint:all` (which lints `ui/src`) and by
`knip.json`'s `ui` workspace — but *not* by root `npm run check`/`lint`.

## A.2 `.oxlintrc.json` — every rule, exactly

`tools/kb/.oxlintrc.json`:

- `plugins` (line 3): `eslint`, `typescript`, `react`, `import`, `unicorn`, `oxc`.
  Enabling a plugin here only makes its rules *available*; oxlint's default
  category set applies (`correctness` at error by default) plus the explicit list.
- Explicit rules (lines 5-8):
  - `import/no-cycle`: `["error", { "maxDepth": 8 }]`
  - `react/exhaustive-deps`: `"error"`
  - `typescript/ban-ts-comment`: `["error", { "ts-expect-error": "allow-with-description" }]`
  - `typescript/no-explicit-any`: `"warn"` ← **warn, not error**
- Override 1 (lines 11-26), files `ui/src/**`: `eslint/no-restricted-imports` error
  on regex `^(?:\.\./)+src/` — "ui may reach the backend only via the @kb/* seam".
- Override 2 (lines 27-42), files `src/foundation/**`, `src/operations/**`:
  `eslint/no-restricted-imports` error on regex `^(?:\.\./)+(?:surface|operations|render)/`
  — foundation-is-a-leaf + operations-must-not-reach-surface.
- Override 3 (lines 43-46), files `**/*.css`: empty `rules` block (no-op; exists
  only so oxlint accepts CSS files in the glob).

**Not covered by this config (categories deliberately or accidentally absent):**

- No `categories` block at all → only oxlint's built-in defaults (`correctness`)
  plus the four rules above. `suspicious`, `pedantic`, `style`, `restriction`,
  `perf`, `nursery` are all off.
- **No type-aware rules.** `oxlint-tsgolint` is installed but never invoked:
  `tools/kb/vite.config.ts:14-17` and `ui/vite.config.ts:20-24` both set
  `lint.options.typeCheck: false, typeAware: false`, and `lint:all` calls plain
  `oxlint` with no `--type-aware`. DESIGN.md:47-50 states this is deliberate
  ("oxlint-tsgolint is not verified as a meaningful gate for this Bun/Effect tree").
  Consequence: **no `no-floating-promises`, no `no-misused-promises`, no
  `await-thenable`, no `no-unnecessary-condition`, no `strict-boolean-expressions`,
  no `require-await`, no `no-unsafe-*`** — the entire typed-lint family.
- No complexity/size limits (`complexity`, `max-lines`, `max-depth`,
  `max-params`, `max-nested-callbacks`). ui/ARCHITECTURE.md:92-109 documents
  eleven "god components" (1859, 743, 540, 532, 481, 473, 418, 410, 393, 392,
  351 LOC) as a known, un-gated debt.
- No exhaustive-switch enforcement (`typescript/switch-exhaustiveness-check`).
  `noFallthroughCasesInSwitch` is on in tsconfig but that is a different check.
- No promise plugin, no `unicorn` rules explicitly enabled (plugin listed only).
- No `import/no-default-export`, `import/order`, `no-restricted-syntax`,
  `no-console` (ui/ARCHITECTURE.md:112 asserts "no unconditional console.log on
  the boot path" by convention, not by lint).
- No Effect-specific rules (there is no `@effect/eslint-plugin` equivalent in
  oxlint; nothing checks `Effect.runPromise` placement, missing `yield*`,
  un-provided `R`, unhandled `Effect.orDie`, etc. — enforced by review + tsc only).
- No jsx-a11y plugin in the lint config (a11y is checked only through
  `@storybook/addon-a11y` with `a11y.test: "todo"` in
  `ui/.storybook/preview.tsx:11`, i.e. non-blocking).
- No formatting gate. `vp fmt` exists; `check` is run with `--no-fmt` and both
  vite configs set `check.fmt: false`. Nothing in pre-commit or CI checks format.

## A.3 tsconfigs — strictness present vs missing

### `tools/kb/tsconfig.json` (backend)

Present: `strict: true` (19), `noFallthroughCasesInSwitch: true` (21),
`noUncheckedIndexedAccess: true` (22), `noImplicitOverride: true` (23),
`verbatimModuleSyntax: true` (15), `moduleDetection: "force"` (7),
`allowImportingTsExtensions: true` (14), `moduleResolution: "bundler"` (13),
`module: "Preserve"`, `target/lib: ESNext`, `types: ["bun"]`,
`skipLibCheck: true` (20), `noEmit: true`, `allowJs: true`, `jsx: react-jsx`
(inert — `ui` is excluded).

Explicitly **off** (lines 26-28, commented "stricter flags (disabled by default)"):
`noUnusedLocals: false`, `noUnusedParameters: false`,
`noPropertyAccessFromIndexSignature: false`.

**Missing entirely** (not set either way, so default = off):
`exactOptionalPropertyTypes`, `noImplicitReturns`, `useUnknownInCatchVariables`
(actually on via `strict`), `noUncheckedSideEffectImports`, `isolatedModules`
(implied by Preserve/bundler but not stated), `erasableSyntaxOnly`,
`allowUnreachableCode`/`allowUnusedLabels` (default permissive),
`forceConsistentCasingInFileNames` (default true in TS5+).
`skipLibCheck: true` means `datascript`'s hand-written
`src/types/datascript.d.ts` shim is not deeply validated.

Scope (lines 34-35): `include: ["index.ts","src","tests","extensions-bundled"]`,
`exclude: ["ui"]` — the backend `tsc` never sees the UI.

### `tools/kb/ui/tsconfig.json`

Present: `strict: true` (8), `isolatedModules: true` (11), `noEmit`,
`skipLibCheck: true` (10), `esModuleInterop`, `resolveJsonModule`,
`allowImportingTsExtensions: true` (15), `moduleResolution: bundler`,
`jsx: react-jsx`, `target/lib ES2022 + DOM`.

**Missing** (weaker than the backend): `noUncheckedIndexedAccess`,
`noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`,
`noPropertyAccessFromIndexSignature`, `exactOptionalPropertyTypes`,
`noUnusedLocals`/`Parameters`, `noImplicitReturns`.
So the 89-file React tree is meaningfully less strictly typed than `src/`.

`paths` (18-26) declares the `@kb/*` seam: `@/*`, `@kb/protocol`, `@kb/canvas`,
`@kb/ontology`, `@kb/order`, `@kb/field-type`, `@kb/queries`. TS 7 dropped
`baseUrl`, so these are relative (DESIGN.md:64-66).

## A.4 knip.json

`tools/kb/knip.json` — two workspaces:

- `"."`: entries `index.ts`, `src/surface/{cli,ui,mcp}.ts`; project
  `src/**/*.ts` + `extensions-bundled/**/*.ts`.
- `"ui"`: entry `src/main.tsx`; project `src/**/*.{ts,tsx}`; `paths` mirrors the
  `@kb/*` aliases (lines 23-45).
- `ignoreFiles` (48-54): `src/bin/docs-check.ts`, `src/bin/docs-materialize.ts`,
  `src/ext-sdk/surface.ts`, `ui/src/api/queries.ts`, `ui/src/components/canvas/index.tsx`.
- `ignoreDependencies` (55-63): `@fontsource-variable/outfit`,
  `graphology-communities-louvain`, `graphology-layout`,
  `graphology-layout-noverlap`, `storybook`, `tailwindcss`, `zod`.

Run as `knip --include files,dependencies` — **unused *exports* / types /
enum members / duplicate exports are NOT reported.** Note also that
`tests/**` is not in `project`, so a file used only by tests reads as unused
unless it is reachable from an entry.

## A.5 stryker.config.json (mutation testing)

`tools/kb/stryker.config.json`:
- `testRunner: "command"`, `commandRunner.command: "bun test tests/"` — the
  vitest runner cannot host `bun:test` (comment, line 3).
- `tsconfigFile: "stryker-tsconfig-workaround-none.json"` — a deliberately
  nonexistent name, because Stryker's TSConfigPreprocessor calls
  `ts.parseConfigFileTextToJson`, removed in TS 7's native port (line 3).
- `mutate: ["src/foundation/**/*.ts"]` — **foundation only**; operations,
  registry, surfaces, render, extensions are not mutated.
- `coverageAnalysis: "off"`, `ignorePatterns: ["ui/**"]`, `timeoutMS: 15000`.
- `thresholds: { high: 80, low: 60, break: 60 }`, HTML report to
  `reports/mutation/index.html`.

Not a PR gate: `.github/workflows/kb-mutation.yml:18-22` runs it weekly
(Mon 04:00 UTC) + `workflow_dispatch`, 90-minute timeout, uploads the report;
the header comment (lines 3-16) explains the score is non-reproducible because
the fast-check properties use an unseeded random source (9 / 53 / 68 survivors
over byte-identical source), so `break: 60` is a loose floor, not a ratchet.

## A.6 vite configs, bunfig, storybook

- `tools/kb/vite.config.ts`: `lint.ignorePatterns: ["ui/**","**/node_modules/**","dist/**"]`,
  `lint.options.typeCheck:false, typeAware:false`, `check.fmt:false`.
- `tools/kb/ui/vite.config.ts`: own `lint` block is *required* (comment 16-18)
  or `vp` walks up and inherits `ignorePatterns: ["ui/**"]` → lints nothing.
  Same `typeCheck/typeAware:false`, `check.fmt:false`. Plugins tailwind + react.
  `build.assetsDir: "static"` so the bundler's output never collides with the
  server's `/assets` media route (30-35). Dev proxy `/api`, `/assets`, `/ws` →
  `127.0.0.1:${KB_UI_API_PORT ?? 4321}` (47-64). `test`: `environment:"node"`,
  `include: ["src/**/*.test.{ts,tsx}"]`, `setupFiles: ["src/test-setup.ts"]`.
- `tools/kb/bunfig.toml`: `[test].pathIgnorePatterns` lists 6 Vitest-only UI
  files (graph-page, ontology-page, ontology-scope acceptance, ghost-node-row,
  mutations.debounce, view-error-boundary) so recursive `bun test` skips them.
- `tools/kb/ui/bunfig.toml`: `[test].preload = ["./src/test-setup.ts"]`.
- `ui/playwright.config.ts`: `testDir ./tests-render`, `testMatch **/*.e2e.ts`,
  `fullyParallel:false`, `retries: CI?1:0`, `timeout 45s`, chromium 1280x900,
  `baseURL http://127.0.0.1:4323`, `globalSetup ./tests-render/global-setup.ts`.
- `ui/.storybook/main.ts`: `stories: ["../src/catalog/**/*.stories.tsx"]`,
  framework `@storybook/react-vite`, addon `@storybook/addon-a11y`, its own
  `viteFinal` re-declaring tailwind + the `@kb/*` aliases (it deliberately does
  not import `vite.config.ts` because that is a `vite-plus` config).
  **Note: `.storybook/main.ts` is missing `@kb/queries` from its alias map** —
  present in `tsconfig`, `vite.config.ts` and `knip.json`, absent here, so a
  story touching `queryBacklinks` would fail to resolve in Storybook.
  `ui/.storybook/preview.tsx:11` sets `a11y.test: "todo"` (non-blocking).

## A.7 Module boundary rules — what is enforced, and by what

| Boundary | Declared in | Enforced by |
|---|---|---|
| `ui/src/**` may not `../../src/…` (only `@kb/*`) | `.oxlintrc.json:12-25` | oxlint `eslint/no-restricted-imports` — only via `npm run lint:all` (root `vp lint` ignores `ui/**`) |
| `src/foundation/**` and `src/operations/**` may not import `surface`/`operations`/`render` | `.oxlintrc.json:27-42` | same rule; note the regex only matches **relative parent** paths (`^(?:\.\./)+…`), so a same-dir or aliased route would slip through |
| No import cycles | `.oxlintrc.json:5` | oxlint `import/no-cycle` maxDepth 8, **error** |
| Layer direction surface → operations → foundation | DESIGN.md, ui/ARCHITECTURE.md:39-53 | partially by the two rules above; the surface→operations direction and ui's intra-layer table (`lib/ds/api/actions` must not import `components/**`, surfaces must not reach sibling surface internals) are **convention only, no lint rule, no test** |
| `@kb/*` alias set | `ui/tsconfig.json:18-26`, `ui/vite.config.ts:36-45`, `knip.json:23-45`, `.storybook/main.ts` | four hand-maintained copies; nothing checks they agree (and `.storybook` is already out of sync, see A.6) |
| Determinism seam (time/identity) | `src/foundation/model.ts:1-14` | **a real test**: `tests/dst/guard.test.ts` greps every `src/**/*.ts` for `Date.now(`, `Math.random(`, `new Date(`, `ulid(`, `nowIso(`, `Date(` and fails outside an explicit allowlist (`model.ts`, `seed.ts`, `example.ts`, `write-lock.ts`, `durable-replace.ts`) |
| `sys.*` write guard | `src/operations/index.ts:419-440` (`assertNoSysUpsert`) | runtime + tests |

There is **no architecture/dependency-graph test** (no dependency-cruiser, no
`layer.test.ts`). The only structural test is the determinism grep guard.

## A.8 Test layout and how it runs

Backend `tools/kb/tests/` — 35 top-level test files + `dst/` (≈8.9k LOC total):

- Core/unit/integration: `core.test.ts` (475), `persistence.test.ts` (408),
  `cli.test.ts` (412), `ontology.test.ts` (801), `canvas.test.ts` (557),
  `surface-effect.test.ts` (357), `ui.test.ts` (333),
  `ui-surface-boundaries.test.ts` (401 — HTTP/asset traversal + hub semantics,
  not module boundaries), `materialize.test.ts` (319), `contextual-ref.test.ts`,
  `field-target.test.ts`, `field-types.test.ts`, `graph-actions.test.ts`,
  `mcp.test.ts`, `native-actions.test.ts`, `extensions.test.ts`,
  `ext-sdk-fresh.test.ts`, `assets.test.ts`, `node-schema.test.ts`,
  `queries.test.ts`, `query-nodes.test.ts`, `saved-query-names.test.ts`,
  `order.test.ts`, `effect.test.ts`, `example-seed.test.ts`,
  `graph-perspective-seed.test.ts`, `ui-build-lifecycle.test.ts`, `ui-dev.test.ts`.
- **Property tests (fast-check)** — 6: `store-roundtrip.property.test.ts` (89),
  `mentions.property.test.ts` (75), `order.property.test.ts` (246),
  `ontology.property.test.ts` (295), `field-type.property.test.ts` (173),
  `seed.property.test.ts` (85). All unseeded (see A.5 caveat).
- **DST harness** — `tests/dst/harness.ts` (512 LOC): generates op histories from
  a seed through the *real* plan surface (`surface/map.ts` `mapAdd/mapSet/mapUnset/
  mapRm/mapMv/mapFieldDefine/mapTagDefine` + `invokeReceiptEffect`), installs a
  `seededClock(base, stepMs)` and seeded `Random`, and asserts store invariants
  continuously; byte-identical replay is the headline property
  (`harness.ts:25-35`). `dst/dst.test.ts` (125) runs committed seeds;
  `dst/run-many.ts` (26) sweeps N seeds. `dst/guard.test.ts` (66) is the seam grep.
- **Benchmark** — `tests/benchmark.test.ts` (81), see B.7.

UI: 89 colocated `*.test.ts(x)` under `ui/src` (Vitest via `vp test`), plus
`ui/src/catalog/*.stories.tsx` + `catalog.smoke.test.tsx` (portable-stories
`composeStories`, every story is also a test — `ui/README.md:37-41`), plus
Playwright `ui/tests-render/{palette,render,typography}.e2e.ts` with
`fixture.ts`, `global-setup.ts`, `harness-server.ts`, `server.ts`.

Runners: `bun test` (backend, and recursively most of `ui/**` minus the 6
bunfig-ignored paths — needs UI deps installed) vs `cd ui && vp test` (Vitest,
the dedicated UI suite) vs `bun run test:render` (Playwright). DESIGN.md:59-63
explains the split.

**No coverage configuration or threshold anywhere** — grep for `coverage` across
`package.json`, both `vite.config.ts`, `bunfig.toml` returns nothing.

## A.9 Gates: pre-commit and CI

`.githooks/pre-commit` (installed via `git config core.hooksPath .githooks`):
1. lines 12-18 — if `tools/kb` and `.kb` exist and `bun` + `tools/kb/node_modules/effect`
   are present: `bun tools/kb/src/bin/docs-check.ts` (generated `docs/kb/*` must
   match `.kb` data). Otherwise warns and skips.
2. lines 22-25 — `scripts/check-kb-assets-backup.sh check` (`.kb/assets` stays
   Mackup-owned; committed nodes cannot reference unowned state).
3. lines 29-38 — if any staged path matches `^tools/kb/`: `tsc --noEmit` for both
   `tools/kb` and `tools/kb/ui`, invoked as `./node_modules/.bin/tsc`; warns and
   skips if deps missing.
4. line 40 — `exec intent/gate.sh record git-commit`.

Also repo-wide (CLAUDE.md §"Lint And Format"): nixfmt / statix / deadnix /
`nix flake check` on staged Nix files.

**Pre-commit does NOT run**: oxlint, knip, `bun test`, the DST sweep, or `vp check`.

CI `.github/workflows/validate.yml`, job `kb` (macos-15, 30 min):
`bun install --frozen-lockfile` for both packages → `npm run verify` in
`tools/kb` (typecheck + check + lint:all + knip) → `./node_modules/.bin/tsc --noEmit`
in `ui` → `bun test` in `tools/kb` → `./node_modules/.bin/vp test` in `ui` →
`bun tests/dst/run-many.ts 25` (deterministic simulation sweep) →
`bun tools/kb/src/bin/docs-check.ts` → `./scripts/check-kb-assets-backup.sh check`.
Playwright `test:render` is **not** in CI. Mutation is a separate weekly workflow.

## A.10 Gap list — what a strict production stack would add

Ordered roughly by value-per-effort for this tree.

1. **Type-aware linting is installed but switched off.** `oxlint-tsgolint` exists
   in both `node_modules`; `typeCheck`/`typeAware` are `false` in both vite
   configs and `lint:all` never passes `--type-aware`. This is the single largest
   gap: an Effect-heavy codebase with `Effect.runPromise` at surface tips and
   `Promise` handlers for third-party extensions has **no `no-floating-promises`
   and no `no-misused-promises`**. `src/surface/ui/server.ts` uses
   `Effect.runFork` inside `setTimeout` and WS callbacks — exactly the shape those
   rules exist to police. DESIGN.md:47-50 records the decision as "not verified as
   a meaningful gate"; re-evaluating it on the current tree is the top item.
2. **`typescript/no-explicit-any` is `warn`.** `shared/contracts.ts:30` has a
   deliberate `any` (`ActionEffectHandler`'s `R`) with no `eslint-disable`
   comment; making the rule `error` + one documented disable would lock that down.
3. **No complexity or file-size limits**, against eleven documented god
   components up to 1859 LOC (`ui/ARCHITECTURE.md:96-108`) and
   `src/operations/index.ts` at 772 LOC. `max-lines`, `max-lines-per-function`,
   `complexity`, `max-depth` would turn that table from a note into a ratchet.
4. **No exhaustive-switch rule.** The codebase leans on discriminated unions
   (`PropValue.t`, `ActionReceipt.status`, `ServerMessage.op`, `ClientMessage.op`,
   `MemberReason.kind`, `DomainError.code`). `noFallthroughCasesInSwitch` does not
   catch a missing case; `typescript/switch-exhaustiveness-check` (type-aware)
   would. `session.ts:160-189` returns from every case with no `default` — it
   works only because the union is currently total.
5. **No coverage measurement at all**, let alone a threshold. Mutation testing
   covers `src/foundation/**` only, weekly, unreproducibly.
6. **Mutation scope is 1 of ~6 source areas.** `operations/`, `registry.ts`,
   `render/`, `surface/`, `extensions-bundled/` are never mutated.
7. **UI tsconfig is materially weaker than backend tsconfig** (A.3): no
   `noUncheckedIndexedAccess`, no `noImplicitOverride`, no `verbatimModuleSyntax`,
   no `noFallthroughCasesInSwitch`. Bringing `ui` up to the backend's flags is
   mechanical and high-value for 89 test files' worth of React.
8. **`exactOptionalPropertyTypes` is off in both packages.** Directly relevant to
   persistence: `KbNode.order?: string` (`foundation/model.ts:40`) and
   `ActionReceipt.details?`. With the flag on, `{ order: undefined }` stops being
   assignable — which matters when the JSONL round-trip must be byte-exact.
9. **`noUnusedLocals` / `noUnusedParameters` off**, and `knip` runs with
   `--include files,dependencies` so unused *exports* are never reported. A
   public-surface-heavy tree (`foundation/*/index.ts` barrels) accretes dead
   exports invisibly.
10. **No Effect-specific rules.** Nothing checks for `Effect.runPromise` inside a
    handler (DESIGN.md:430-432 says surfaces only), un-`yield*`-ed Effects
    (which silently no-op), `Effect.orDie` on recoverable errors (used at
    `surface/ui/saved-queries.ts:13-14`), or missing `Effect.scoped` around
    `acquireRelease`. This is review-only today. No such oxlint plugin exists;
    the realistic substitutes are (a) type-aware `no-floating-promises` and
    (b) a small `no-restricted-syntax` set.
11. **No architecture test.** The four `@kb/*` alias maps (tsconfig, vite,
    knip, storybook) are hand-synced and already diverge; a test asserting they
    are equal, plus a dependency-graph assertion for the layer table in
    `ui/ARCHITECTURE.md:39-53`, would close both.
12. **No format gate.** `vp fmt` exists and is never enforced.
13. **`import/no-cycle` is at error but `maxDepth: 8`** — a cycle longer than 8
    hops is invisible. Uncapped is the strict setting.
14. **Pre-commit is much weaker than CI** (lint, knip, tests, DST all CI-only)
    and every kb step degrades to a `warning:` + skip when deps are missing.
    Reasonable for a dotfiles repo; worth naming as a deliberate posture.
15. **`skipLibCheck: true`** in both packages, while the DataScript typings are a
    hand-written local shim (`src/types/datascript.d.ts`) — the one `.d.ts` most
    worth checking is the one skipped.
16. **Playwright render suite is not in CI** (`ui/tests-render/*.e2e.ts` runs only
    on demand); Storybook a11y is `test: "todo"`.
17. **`index.ts` is a dead stub** printing "kb M1 — …" yet is a knip entry point,
    which suppresses dead-code detection for anything it transitively reaches.

---

# PART B — PERSISTENCE SEAM

## B.0 The one-paragraph answer

There is **already a named, backend-agnostic port** — `Store` / `EffectStore` in
`src/foundation/storage/store.ts` — with exactly two operations
(`load`, `commit`) and exactly one implementation (`JsonlStore`). It is a real
seam and it is honoured: nothing above `foundation/services.ts` imports
`JsonlStore`. But that port is only half of persistence. The **query index**
(DataScript) is *not* behind any port: `QueryDb` is a concrete struct with a
`db: unknown` DataScript value, `buildQueryDb(nodes)` is called eagerly on every
open/reload/persist, and the public query language is raw DataScript EDN
string-passed through CLI, MCP, HTTP and WS. So "make persistence pluggable" is
two separate refactors with very different difficulty: swapping the *byte store*
is nearly free; swapping the *index* is constrained by an EDN-shaped public API.

## B.1 Where the store lives

`src/foundation/storage/` (6 modules + barrel):

| file | LOC | role |
|---|---|---|
| `store.ts` | 29 | the port: `StoreTx`, `Store`, `EffectStore` |
| `jsonl-store.ts` | 170 | the only implementation + `asPromiseStore` |
| `node-schema.ts` | 63 | Effect `Schema` for a JSONL row |
| `canonical.ts` | 18 | deterministic JSON (recursive key sort) |
| `durable-replace.ts` | 112 | tmp+fsync → .bak → rename → dir fsync |
| `write-lock.ts` | 178 | pid lock file, spin, stale steal |
| `index.ts` | 15 | barrel re-export |

### The port (`storage/store.ts`)

```ts
// store.ts:6-9
export interface StoreTx { upserts: KbNode[]; deletes: NodeId[]; }

// store.ts:15-19  — Promise facade, "retained for tests, benchmarks, KbContext.store"
export interface Store {
  readonly path: string;
  load(): Promise<KbNode[]>;
  commit(tx: StoreTx): Promise<void>;
}

// store.ts:25-29 — the Effect-native port
export interface EffectStore {
  readonly path: string;
  loadEffect(): Effect.Effect<KbNode[], DomainError, FileSystem>;
  commitEffect(tx: StoreTx): Effect.Effect<void, DomainError, FileSystem>;
}
```

Two leaks in the port itself, both small and both fixable:
- `readonly path: string` — a filesystem concept in an abstract port. Used by
  `tests/native-actions.test.ts:132`, `tests/persistence.test.ts:217,286`.
- `FileSystem` in the `R` channel is hard-coded — a SQLite/Cozo backend would
  need a different requirement, so `R` should be the implementation's business
  and the port should quantify over it (or use `never` and let the Layer supply it).

### `KbContext` / `KbCtx` (`src/foundation/services.ts:55-74`)

```ts
export interface KbContext {
  root: string;
  store: Store;            // Promise facade (tests / legacy)
  effectStore: EffectStore;// same JsonlStore instance when live
  nodes: KbNode[];         // FULL in-memory node array
  qdb: QueryDb;            // FULL DataScript db, rebuilt wholesale
}
export class KbStore extends Context.Service<KbStore, EffectStore>()("kb/KbStore") {}
export class KbCtx   extends Context.Service<KbCtx, KbContext>()("kb/KbCtx") {}
```

`KbContext` is **mutable** — `reloadEffect`/`persistEffect` assign `ctx.nodes` and
`ctx.qdb` in place (`services.ts:134-135, 158-159`), and `SubscriptionHub` also
assigns `ctx.qdb` (`surface/ui/session.ts:97, 213`) and `ctx.nodes`
(`session.ts:212`). This mutation-through-a-shared-object pattern is the main
thing a Layer-based refactor would have to replace.

Layers (`services.ts:76-98`): `kbStoreLayer(store)`, `jsonlStoreLayer(root)`
(the one place a Layer names `JsonlStore` — line 82), `kbCtxLayer(ctx)`,
`kbRuntimeLayer(ctx)` = `bunFileSystemLayer + kbStoreLayer + kbCtxLayer`.
`runWithKb(ctx, effect)` (163-169) is the Promise boundary.
`bunFileSystemLayer` = `@effect/platform-bun/BunFileSystem.layer`
(`foundation/platform.ts:6`).

### `openKbEffect` (`services.ts:100-126`)

1. `new JsonlStore(root)` (104) — **the only non-test construction site besides
   `jsonlStoreLayer`** (82). Everything else receives a `Store`.
2. `loadEffect()` (105).
3. `currentIso` from Effect `Clock` (106).
4. `ensureSystemSeed(nodes, at)` → `{nodes, seeded, deletes}` (107).
5. `migrateFieldTypeValues` (108), `migrateOrderKeys` (109) — two in-line
   migrations run on **every open**.
6. If seeded / empty / deletes / any migration changed → `commitEffect` (118).
   **So opening a kb can write to disk.**
7. `buildQueryDb(nodes)` (122) — full index build.
8. Returns `{ root, store: asPromiseStore(effectStore), effectStore, nodes, qdb }`.

### `reloadEffect` (`services.ts:128-137`)

`store.loadEffect()` → `ctx.nodes = …` → `ctx.qdb = rebuildQdb(...)`. Full reload,
full re-index. No incremental path.

### `persistEffect` (`services.ts:139-161`)

1. `txIntegrityError(ctx.nodes, tx)` (145) → fail `invalid_input` if non-null.
2. `store.commitEffect(tx)` (154).
3. Merge tx into an in-memory `Map` (155-157) → `ctx.nodes = [...byId.values()]`.
4. `ctx.qdb = rebuildQdb(ctx, ctx.nodes, previousRealIds)` (159) — **full
   DataScript rebuild after every single write**.

`rebuildQdb` (`services.ts:28-47`) also re-injects "virtual" saved-query nodes
(`sys.queries`, `sys.query.*`) that live only in the index, never in JSONL, and
only if they were not in the previous persisted snapshot (so a genuinely deleted
`sys.query.*` cannot resurrect). This is a **second class of node that exists in
the index but not in the store** — important for any pluggable-index design.

Promise facades: `openKb` / `reload` / `persist` in `src/context.ts:28-53`
(each its own `Effect.runPromise` + `Effect.provide`).

### How `nodes.jsonl` is actually read and written

Read — `jsonl-store.ts:87-110`:
- `fs.exists(path)` → `[]` if absent (91-92); `fs.readFileString(path)` (94-96) —
  **whole file into one string**, then `body.split("\n")` (102). Despite
  DESIGN.md:196-199 ("streaming line parse (no read-whole-string-then-split)"),
  the implementation is exactly read-whole-string-then-split. Documented intent
  and code diverge here.
- Each non-blank line: `JSON.parse` → `Schema.decodeUnknownEffect(KbNodeSchema,
  {onExcessProperty:"preserve"})` (`decodeNodeLine`, 28-61). First bad line fails
  the whole load with a line-numbered `DomainError` — **all-or-nothing, and load
  never rewrites the file** (73-74).
- `onExcessProperty: "preserve"` (`node-schema.ts:61-62`) means unknown own JSON
  keys survive a load→commit round trip. Any alternative backend must preserve
  this or it silently truncates data.

Write — `jsonl-store.ts:112-142`, **full-file rewrite, never append**:
```
Effect.scoped(
  acquireRelease(acquireNodesWriteLockEffect(path), release)  // 118-121
  existing = loadEffect()                                     // 123  ← re-reads inside the lock
  byId = Map(existing); deletes; upserts                      // 124-126
  sorted = [...byId.values()].sort(by id)                     // 128-130
  body = sorted.map(canonicalJson).join("\n") + "\n"          // 131-134
  durableReplaceFile(path, backupPath, body)                  // 136-139
)
```
So one commit = one lock acquire + one full read + one full sort + one full
serialize + one full fsync'd rewrite. At 231 nodes / 72 KB this is free; the
shape is O(n) per write regardless of tx size.

`canonicalJson` (`canonical.ts:2-17`) recursively sorts object keys and uses
`Object.fromEntries` specifically so a key literally named `__proto__` cannot
poison the prototype (comment 10-12).

`durableReplaceFile` (`durable-replace.ts:58-111`): `mkdir -p` → write tmp
`${path}.${pid}.${Date.now()}.tmp` via `openSync`/`writeSync`/**`fsyncSync`** →
if live exists, `copyFileSync` live→`.bak` + `fsyncPath(.bak)` → `renameSync`
tmp→live → best-effort `fsyncDir`. Uses **node:fs sync APIs**, not Bun, not
Effect `FileSystem`. DESIGN.md:214-215: "Ordering-safe; **not** crash-injection
tested (no `F_FULLFSYNC`, no revision/CAS)."

`write-lock.ts`: lock file `<nodes.jsonl>.lock` containing the holder pid
(29-31, 55-68). `pidAlive` treats EPERM as alive (38-42). Stale locks (dead pid)
are unlinked and re-created (`stealIfStale`, 70-80). `acquireNodesWriteLockEffect`
(87-131) spins on `Effect.sleep(25ms)` up to `MAX_WAIT_MS = 15_000`, then fails
`conflict` naming the holder pid. `withNodesWriteLock` (147-169) is a sync
**busy-wait** variant for tests/non-Effect callers. `releaseNodesWriteLock`
(134-141) only unlinks if the recorded pid is ours or unreadable.
DESIGN.md:200-201 notes `nodes.jsonl.lock` is **not** gitignored (known gap) —
confirmed: `.gitignore:36-37` covers `.bak` and `.*.tmp` only.

Fail-soft posture: the lock is advisory, filesystem-local, process-scoped. It
serializes writers but does not make a reader's snapshot binding — there is no
`expect`/CAS precondition on any action input (DESIGN.md:224-229, "parked").

### In-memory model

`foundation/model.ts:32-43`:
```ts
interface KbNode {
  id: NodeId; text: string;
  props: Record<NodeId, PropValue[]>;   // key = FIELD NODE id
  children: NodeId[];                   // ordered outline
  order?: string;                       // fractional sibling rank (optional during migration)
  createdAt: string; updatedAt: string;
}
type PropValue = {t:"str",v:string} | {t:"num",v:number} | {t:"bool",v:boolean}
               | {t:"date",v:string} | {t:"ref",v:NodeId};
```
`order` is a base-36, width-10 fractional rank (`foundation/order.ts:3-37`,
`ranksFor`, `rankBetween`); `migrateOrderKeys` (39+) is additive-only and must
never rewrite an existing rank (comment 42-49 records the bug where it did).

Note `KbNodeSchema` (`node-schema.ts:51-58`) does **not** declare `order` —
it survives only because of `onExcessProperty: "preserve"`. That is a latent
trap for any backend with a real column/schema.

`SYSTEM_IDS` (`model.ts:45-179`) is a ~90-entry frozen map of reserved `sys.*`
ids (fields, tags, field-type options, commands, view config, lens config,
canvas, ontology). `isSysPrefixed` (191) gates writes; `--force` overrides.

## B.2 How the DataScript conn is built from nodes

`src/foundation/query/datascript.ts` — **the entire DataScript surface of the
backend is this one 298-line file.**

`nodesToDatoms(nodes)` (136-218), single pass, produces a flat `Datom[]` plus a
derived schema plus an `IdMap`:

- `buildIdMap` (101-114): sort node ids lexicographically, assign integer eids
  `1..n`. **Eids are positional, not stable across loads** — inserting a node
  renumbers everything after it. Any incremental/persistent backend must own
  stable entity ids instead.
- Per node (148-153): `[eid ":node/id" id]`, `":node/text"`, `":node/created-at"`,
  `":node/updated-at"`.
- Children (156-167): for each resolvable child, `[eid ":node/child" childEid]`
  **and** `[eid ":node/child-order" i]`. Note `:node/child-order` is emitted on
  the *parent* with the index as value and no link to which child — it is
  cardinality-one in the derived schema, so effectively only one survives; it is
  not a usable ordering attribute. Ordering in practice comes from
  `node.children` array order and `node.order`, not from datalog.
  Plus `[eid ":node/children" childEids]` (a raw array value) when non-empty.
- Props (174-184): attribute `":f/" + fieldId` (`fieldAttr`, 116-118). Ref values
  resolve to the target eid and mark the attr as a ref attr; a **dangling ref
  degrades to a string sentinel** (`propDatomValue`, 120-133) — deliberate, see
  `tests/dst/harness.ts:40-64` `DANGLING_REF_DECISION`.
- Mentions (169-195): a `Set<number>` unions ref-prop targets and
  `[[id|label]]` text matches (`MENTION_RE = /\[\[([^[\]|]+)(?:\|[^\]]*)?\]\]/g`,
  line 26), then emits one `[eid ":node/mentions" targetEid]` per distinct target.
  **One relation, two carriers** — the design rationale is at lines 4-15 and
  DESIGN.md:124-160. Only targets that resolve to an existing node become datoms.
- Schema (198-215): `:node/id` → `:db.unique/identity`; `:node/child` and
  `:node/mentions` → `ref`/`cardinality-many`; every field attr that ever carried
  a ref value → `ref`/`cardinality-many`. **The schema is data-derived**: a field
  is a ref attribute iff some node currently holds a ref value for it.

`buildQueryDb(nodes)` (220-228) → `d.init_db(datoms, schema)` and returns
`{ db, ids, nodes: Map<NodeId, KbNode> }` (`QueryDb`, 50-54). Note `db: unknown`
— DataScript is untyped here; `src/types/datascript.d.ts` is a local shim.

**There is no `d.create_conn`, no `d.transact`, no `d.listen` anywhere.**
"conn" in DESIGN.md:232 and DESIGN-UI.md:85-87 is aspirational; the real thing is
an immutable db re-inited from scratch. DESIGN.md:13-16 explicitly leaves the
`d/listen!` door open and says nothing is built — accurate.

`normalizeEdnQuery` (71-99) is a hand-rolled scanner that quotes `:keyword`
tokens into `":keyword"` strings (because the JS DataScript API stores attrs as
strings) while skipping the 8 query directives (`QUERY_DIRECTIVES`, 56-65) and
respecting string literals. **This function is duplicated verbatim in the
browser** (`ui/src/ds/db.ts:24-64` and again in `ui/src/ds/query.ts:25-…`).

`query(db, edn, ...inputs)` (237-251) → `normalizeEdnQuery` → `d.q` → wrap
engine throws in `DatalogError` (36-41) → `reviveValue` (230-234) maps integer
eids back to NodeIds.
`pull(db, pattern, id)` (253-269) → eid or `[":node/id", id]` lookup ref →
`d.pull` → `revivePull` (271-287) which injects `:node/id` next to `:db/id`.
`extractMentions(text)` (290-298) is the standalone text-only extractor.

## B.3 Write path — plan/apply, receipts, registry, time/identity

- **Actions** are the single write abstraction (`src/shared/contracts.ts:41-56`):
  `ActionDefinition { id, title, description, mode: "read"|"apply", inputSchema,
  outputSchema, effect? }`. `ActionReceipt` (63-75) is a
  `succeeded | failed` union with `FailureCode` ∈ {not_found, invalid_input,
  ambiguous, conflict, invalid_move, forbidden, internal, unknown_action} (11-20).
  `DomainError` (`foundation/errors.ts:10-22`) is an Effect `Schema.TaggedError`
  over the same codes minus `unknown_action`.
- **Registry** `src/registry.ts` (412 LOC): `registryFor(root)` builds and caches
  a handler table per root; `manifest(root)`, `invoke` / `invokeReceiptEffect`
  dispatch. Effect handlers run under `Effect.scoped`; only third-party
  `.kb/extensions` Promise handlers go through `tryPromise`
  (DESIGN.md:344-346, 424-426).
- **Built-in actions** (`src/operations/index.ts`, 772 LOC): `node.add` (60),
  `node.update` (82), `node.get` (110), `field.define` (124), `tag.define` (136),
  `graph.query` (149), `graph.run` (163), `graph.search` (179). Plus
  `ontology.members` (`operations/ontology.ts`), `asset.upload`
  (`operations/assets.ts`), `render.view` / `render.views` (`render/index.ts:138,155`),
  and bundled extensions `ext.docs.materialize` / `ext.docs.check` /
  `ext.canvas.tx.apply`.
- **Every write funnels through `persistEffect`** — `operations/index.ts:386`
  (node.add), `:461` and `:539` (node.update). Those are the only three
  `persistEffect` call sites in `src/`.
- **One bypass**: `src/surface/cli.ts:396` calls `ctx.effectStore.commitEffect({upserts: exampleSeedNodes, deletes: []})` directly during `kb init`, then patches
  `ctx.nodes` by hand (line 401) — skipping `txIntegrityError` **and leaving
  `ctx.qdb` stale**. Benign today (init exits immediately) but it is a second
  write path that a Persistence service must either absorb or delete.
- **Integrity** `foundation/tx-validation.ts:5-51` validates the *prospective*
  forest before commit: no self-parent (15), no missing child (16), no duplicate
  child (17), no multiple parents (20), no orphaned descendant after a shallow
  delete (25-40), no cycle (42-50). This is the outline invariant a relational
  backend would express as FKs + a check.
- **Time & identity** are a single owned seam (`foundation/model.ts:1-14, 195-231`):
  `currentIso` = `Effect.map(Clock.currentTimeMillis, isoFromMillis)`;
  `freshId` = `ulid(ms || 1, () => rnd.nextDoubleUnsafe())` reading Effect
  `Random`. The `ms || 1` coercion is there because `ulid(0, …)` silently falls
  back to `Date.now()`. `tests/dst/guard.test.ts` enforces the seam by grep.
- **Transactions**: `StoreTx {upserts, deletes}` is the only transaction shape.
  There is no multi-step transaction, no rollback, no revision/CAS. The lock is
  the only concurrency control.
- **Is DataScript incrementally transacted?** No, in both processes:
  - backend — `rebuildQdb` → `buildQueryDb` → `d.init_db` on every reload and
    every persist (`services.ts:46, 122, 135, 159`), and again in the hub
    (`session.ts:97, 213`).
  - browser — `outline.store.ts:402-420` `applyTx` merges the wire delta into
    `wireNodes` then calls `projectWire` → `buildQueryDb(wire, rev)`
    (`outline.store.ts:201`) → `d.init_db` (`ui/src/ds/db.ts:15`). DESIGN-UI.md:70
    says "client transacts deltas into DataScript"; the code re-inits the db.

## B.4 Read / query path

- **`kb query '<edn>'`** → `graph.query` action → `runDatalog` →
  `query(ctx.qdb, edn, ...inputs)` (`operations/index.ts:676`).
  `classifyQueryError` (654) maps `DatalogError` → `invalid_input` and anything
  else → `internal`, so caller-EDN faults and glue bugs stay distinguishable.
- **`kb get <id> --depth N`** → `node.get` → `pull(ctx.qdb, subtreePattern(depth), id)`
  (`operations/index.ts:559`, `pullSubtree` at 311).
- **`kb search`** → `graph.search` — note this does **not** use datalog: it is a
  plain `ctx.nodes.filter(n => n.text.toLowerCase().includes(needle))` sorted by
  id (`operations/index.ts:750-765`). Pure array scan over the in-memory nodes.
- **Saved queries** `.kb/queries/*.edn` → `graph.run` (`operations/index.ts:704-740`):
  `resolveSavedQueryFile(ctx.root, name)` (`foundation/saved-query.ts:30-42`,
  name must match `/^[\w][\w.-]*$/`, traversal-checked) → `fs.readFileString` →
  `runDatalog`. Files are read fresh per invocation, never cached.
  `foundation/saved-query.ts` also has `readSavedQuery`/`saveSavedQuery`/
  `deleteSavedQuery` using `node:fs/promises` directly.
- **Query nodes** — a `#query`-tagged node with a `sys.f.query` EDN prop renders
  live results. Saved-query *files* are additionally materialized into the graph
  as **virtual nodes**: `savedQueryNodes(saved)` (`surface/ui/saved-queries.ts:52-73`)
  builds `sys.queries` root + `sys.query.<name>` children with a frozen timestamp
  `1970-01-01T00:00:00.000Z` (45) so they never move the content hash. They exist
  in `qdb` and on the wire, **never in `nodes.jsonl`** (48-51), and `rebuildQdb`
  preserves them across reloads (`services.ts:14-47`).
- **`render.view`** (`src/render/index.ts:88-189`) reads `.kb/views/<name>.json`
  specs (`operations/docs/views.ts`), runs `query(ctx.qdb, edn)`
  (`operations/docs/index.ts:84`), and feeds rows to named TS templates
  (`operations/docs/templates.ts`, 166 LOC). `operations/docs/index.ts:21` also
  passes `ctx.qdb.nodes` (the id→node Map) straight to the renderer.
- **Subscriptions / `/ws`** — `SubscriptionHub` (`surface/ui/session.ts`, 254 LOC):
  - state: `rev`, `hash`, `nodeMap`, `clients: Map<clientId, {send, watchTx, subs}>`,
    `virtual` (81-98).
  - `contentHash(nodes)` (37-42) = `Bun.hash(JSON.stringify(sorted))` over the
    whole node set. `rowsHash(rows)` (44-46) likewise per subscription.
  - `subscribe` (169-188): run the EDN immediately, send `{op:"rows"}`, remember
    `lastHash`.
  - `applyNodes(nodes, origin)` (198-253): compute content hash → **no-op if
    unchanged** (201, the guard against the action→fs.watch double fire) → diff
    old/new maps by `JSON.stringify` equality (`diffNodes`, 55-71) → bump `rev` →
    `ctx.qdb = buildQueryDb(merged)` (213) → broadcast `{op:"tx", upserts, deletes}`
    to `watchTx` clients except `origin` → **re-run every subscription's EDN** and
    push `{op:"rows"}` when its row-hash changed (230-249).
  So invalidation is: any content change ⇒ full re-index ⇒ re-run *all* live
  queries ⇒ hash-compare rows. No dependency tracking. DESIGN-UI.md:85-88 owns
  this ("Coarse but correct; 50k nodes re-query in ~20ms, fine for tens of
  subscriptions") and lists per-query dependency tracking as an unbuilt growth path.
- **FSWatcher** — `surface/ui/server.ts:117-135`: `watch(join(root,".kb","nodes.jsonl"), onFsEvent)`,
  falling back to watching the `.kb` directory and filtering for `nodes.jsonl`
  when the file does not exist yet. `onFsEvent` (100-115) debounces **50 ms**,
  then `Effect.runFork(reloadEffect(ctx) → hub.applyNodes(ctx.nodes))` with
  `catchCause(() => Effect.void)` (failures are swallowed).
  This is the path that makes CLI/MCP/agent writes appear in the UI.
- **HTTP `/api/action`** (`surface/ui/http.ts:97-121`) does `reloadEffect(ctx)`
  **before** invoking ("Fresh load so we don't miss external writes"), then
  `hub.applyNodes(ctx.nodes, x-kb-origin)` immediately after ("do not wait for
  fs.watch"). So a single UI edit costs: reload (full parse + full index build)
  → invoke (persist: full rewrite + full index build) → applyNodes (full index
  build again). **Three full index builds per interactive edit.**

## B.5 Every call site that touches DataScript or `nodes.jsonl` directly

### Direct `datascript` imports — 3 files, total

| file | line |
|---|---|
| `tools/kb/src/foundation/query/datascript.ts` | 1 `import * as d from "datascript"` |
| `tools/kb/ui/src/ds/db.ts` | 1 |
| `tools/kb/ui/src/ds/query.ts` | 6 |

### Direct `d.*` API calls — 6 call sites, total

| file:line | call |
|---|---|
| `src/foundation/query/datascript.ts:222` | `d.init_db(datoms, schema)` |
| `src/foundation/query/datascript.ts:241` | `d.q(q, db.db, ...inputs)` |
| `src/foundation/query/datascript.ts:267` | `d.pull(db.db, pat, eidOrLookup)` |
| `ui/src/ds/db.ts:15` | `d.init_db(datoms, schema)` |
| `ui/src/ds/db.ts:75` | `d.q(q, db.db, ...inputs)` |
| `ui/src/ds/query.ts:64` | `d.q(q, qdb.db)` |

No `d.transact`, `d.create_conn`, `d.conn_from_db`, `d.entity`, `d.listen`,
`d.datoms`, `d.db_with`, `d.touch`, `d.index_range`, `d.filter` anywhere.

### Indirect DataScript consumers (via `buildQueryDb` / `query` / `pull` / `ctx.qdb`)

Backend `ctx.qdb` — 14 mentions, 8 of them real accesses:
`services.ts:35,36,135,159`; `surface/ui/session.ts:97,171,213,233`;
`operations/ontology.ts:54`; `operations/docs/index.ts:21,84`;
`operations/index.ts:559,676`.

`buildQueryDb` call sites: `services.ts:46,122`; `surface/ui/session.ts:97,213`;
`ui/src/stores/outline.store.ts:201`; and tests
(`tests/field-target.test.ts:44`, `tests/contextual-ref.test.ts:103,115,126`,
`tests/benchmark.test.ts:53`, `tests/persistence.test.ts:394`,
`ui/src/ds/query.test.ts:7`).

**EDN query strings that live outside `foundation/query/queries.ts`:** the four
canonical ones are owned there (`LIST_FIELDS_QUERY:7`, `LIST_TAGS_QUERY:14`,
`LIST_ALL_NODES_QUERY:21`, `backlinksQuery(id):31`) and the browser reads
`backlinksQuery` through `@kb/queries` (`ui/src/ds/db.ts:3,84-91`) rather than
forking it. Beyond those, EDN appears as *data*: `.kb/queries/*.edn`,
`.kb/views/*.json`, `sys.f.query` props, `sys.f.onto.query`,
`sys.f.targetQuery`, `sys.f.lens.query`, `sys.f.view.filter`.

### Filesystem access to `nodes.jsonl`

Production code — **2 files**:

| file:line | what |
|---|---|
| `src/foundation/storage/jsonl-store.ts:83` | `this.path = join(root, ".kb", "nodes.jsonl")`; `:84` `.bak` |
| `src/foundation/storage/jsonl-store.ts:91,94` | `fs.exists`, `fs.readFileString` (Effect FileSystem) |
| `src/foundation/storage/durable-replace.ts:12-22,58-111` | `node:fs` sync: `openSync/writeSync/fsyncSync/closeSync/copyFileSync/renameSync/unlinkSync/existsSync/mkdirSync` |
| `src/foundation/storage/write-lock.ts:12-20` | `node:fs` sync on `<path>.lock` |
| `src/surface/ui/server.ts:117-135` | `watch(nodesPath)` / `watch(.kb)` |

Everything else touching that filename is a test (`tests/core.test.ts:47,50,75,79`,
`tests/persistence.test.ts:200,217,286`, `tests/cli.test.ts:190,205,216`,
`tests/query-nodes.test.ts:121,156`, `tests/ontology.test.ts:637,649`,
`tests/assets.test.ts:71`, `tests/effect.test.ts:64`,
`tests/native-actions.test.ts:132`, `tests/dst/harness.ts:68-71`) or a
path-traversal assertion (`tests/assets.test.ts:26-30`,
`tests/ui-surface-boundaries.test.ts:65`, `tests/ui.test.ts:287`).

Other `.kb/*` filesystem touchers (not `nodes.jsonl`, but same data dir):
`foundation/saved-query.ts` (`node:fs/promises` on `.kb/queries`),
`surface/ui/saved-queries.ts:10-14` (Effect FileSystem on `.kb/queries`),
`operations/assets.ts` (`.kb/assets`), `operations/docs/views.ts` (`.kb/views`),
`src/extensions.ts` (dynamic `import()` of `.kb/extensions/*.ts`).

## B.6 Assets (`.kb/assets`)

`src/operations/assets.ts` (236 LOC): `ASSETS_REL = ".kb/assets"` (17),
`ASSETS_URL_PREFIX = "assets/"` (20). `asset.upload` writes opaque bytes to
`.kb/assets/<ulid>.<ext>` (id from `freshId`, so it is under the same
deterministic identity seam) and returns the `assets/…` markdown path; node text
references it as `![](assets/…)`. Extension allow-shape `SAFE_EXT = /^[a-z0-9]{1,12}$/i`
(22) plus image/video/audio sets (24-35).
`resolveAssetFile(kbRoot, pathname)` (47-…) is the hardened resolver: strips the
prefix, rejects NUL, `decodeURIComponent`s once, splits on `[/\\]+`, rejects `.`
and `..` segments, and re-checks with `relative()` against the resolved root.
Served by `surface/ui/assets.ts` `serveKbAssetEffect` at `/assets/*`
(`surface/ui/http.ts:125-131`), deliberately routed **before** the SPA fallback.

Backup/ownership: `.kb/assets` is **gitignored** (`.gitignore:29-32`, "no trailing
slash so a …") and is Mackup-owned state, not repo data. The pre-commit hook runs
`scripts/check-kb-assets-backup.sh check` (`.githooks/pre-commit:22-25`) and CI
repeats it, so a committed node can never reference an unowned asset.
Current content: one file, `01M18ESWBQ9RMEMJ6HFKPA0R43.png`, 1.3 MB — i.e. the
asset store is already ~18× the size of the entire node store.

**Implication for the refactor:** assets are already a separate, content-addressed-ish
store outside the JSONL and outside the index. They are the existing precedent
for "not everything lives in nodes.jsonl", and they are not part of the Store port.

## B.7 Current perf characteristics

**Documented targets:**
- DESIGN.md:196-199 — "Performance is a stated requirement: streaming line parse
  (no read-whole-string-then-split), single-pass datom build, durable whole-file
  replace. Milestone 1 includes a benchmark: 50k-node fixture must load+query
  well under 1s." (The streaming-parse half is not implemented — see B.1.)
- DESIGN-UI.md:87-88 — "50k nodes re-query in ~20ms, fine for tens of subscriptions."
- DESIGN-REFINE.md:128 — palette perf bar: "index built once per graph rev (not
  per keystroke), fuzzy match over prebuilt lowercase haystack, results
  virtualized (render ≤ 20 rows), open-to-first-paint < 50ms and per-keystroke
  < 10ms at 50k nodes — measured in a test against the benchmark graph."
- DESIGN-REFINE.md:172 — graph surface sized for "1–50k nodes" (sigma.js + graphology).
- DESIGN-REFINE.md:120 — markdown render cost budget: micromark ≈ 7 kb gz,
  memoized per node text hash, "stop and re-evaluate" if typing latency degrades.

**The one executable benchmark** — `tests/benchmark.test.ts` (81 LOC), 30 s timeout:
builds `N = 50_000` synthetic nodes + system seed + 1 tag (every 10th node
tagged), then measures `store.commit` (write), `store.load`, `buildQueryDb`, and
one datalog query joining on `:f/sys.f.type`. Asserts `rows.length === 5000` (75)
and **`totalMs < 1000`** where total = load + build + query (76). Write time is
logged but **not asserted** (70). Results are `console.log`'d, never recorded —
there are no committed numbers anywhere in the repo.

**Actual current scale:** `.kb/nodes.jsonl` = **231 nodes / 72 KB** (plus a 72 KB
`.bak`). `.kb/queries/todos.edn` (181 B), `.kb/views/todos.json` (222 B),
`.kb/assets` 1.3 MB. At this size every full-rebuild cost above is unmeasurable;
the 50k benchmark is the only signal, and it exercises `init_db` + one query, not
the interactive triple-rebuild path from B.4.

**Un-benchmarked hot paths** (all O(total nodes) per operation):
`persistEffect` full rewrite; `rebuildQdb` after every write; `contentHash` =
`JSON.stringify` of the whole sorted node set on every `applyNodes`;
`diffNodes` = per-node `JSON.stringify` comparison; `graph.search` full array
scan; the browser's `projectWire` → `buildQueryDb` on every `applyTx`.

## B.8 Existing kb nodes about persistence

Run from `/Users/popemkt/.dotfiles`. Combined results of
`kb search "index" --json`, `"JSONL"`, `"SQLite"`, plus `"persist"`, `"store"`,
`"backend"` for completeness.

**The directly relevant pair — this is the planned work, already recorded as a todo:**

`01M0Y1J5PHNC0KSAG4ZFKAF9P0` — tagged `#todo` (`sys.f.type` → `01KZFW1A5BT06QS7V6X6EBQMZ4`),
status prop `01KZFW1A581GP25YPYRF614BAZ` = `"todo"`, created 2026-08-26T03:24:32Z,
updated 2026-08-26T03:44:34Z, **no backlinks**:

> "Look into performant DB as "rebuildable" index syncing to source-control
> committable JSONL, and how Epic's LORE VCS solves binary versioning performantly"

Its two children:

- `01M0Y1J8JE6S62H9DHA325YGWT` — "Rebuildable index model: SQLite / embedded query
  engine acts as a fast cached index rebuilt or incrementally updated from
  .kb/nodes.jsonl; keep JSONL as human-readable, mergeable source of truth in git"
- `01M0Y1JB6E0WGF6EYMX1XG6ESD` — "Binary assets & VCS: Analyze Epic Games' LORE VCS
  (Unreal Engine binary versioning, chunk-level deduplication, lazy streaming /
  snapshot sync) for performant handling of large binary attachments alongside
  text nodes" ← the `.kb/assets` half of the same problem (B.6).

`kb search "SQLite"` returns **exactly one** row (the child above). So SQLite is
mentioned once in the entire knowledge base, and only as an aspiration.

**Adjacent / supporting nodes:**

| id | text (abridged) |
|---|---|
| `01M0Z6XCAG8FVYSDN1JEY48BQS` | "Could probably serve as inspiration for kb architecture in a lot of places (in-memory graph representation, index structures, query execution, and transactional streaming)" |
| `01KZGVK1B0DBJZYV7ETNYG4ERT` | "canvas: offload canvas doc to `.kb/canvas/<id>.json` (prop holds pointer) — keep nodes.jsonl lean" ← precedent for moving a payload out of the JSONL |
| `01KZKQ83RHP89KHTQBMAMGK1KY` | "Backend Architecture: Harman-style Action Registry, strict receipt error isolation, JSONL persistence" |
| `01KZP5J7MCTYXFQF79WKGM2W4A` | "foundation/services.ts defines KbCtx, KbStore, bunFileSystemLayer, kbRuntimeLayer, openKbEffect, reloadEffect, persistEffect, and Promise compatibility facades." |
| `01KZKQBP9GN16EDQ0BV2BYPE9G` | "Problem: ui.ts (633 LOC) combines HTTP API routing, WebSocket upgrade & client tracking, static asset serving, saved query loading, and FSWatcher on .kb/nodes.jsonl." (already resolved — `surface/ui/` is now split) |
| `01KZKQBP9RS7X3H2D67WTWWWZG` | "Backend: Move DataScript EDN Queries out of surface/map.ts" (resolved — `foundation/query/queries.ts`) |
| `01KZKQBP9E2B601WYQ159Z3R9R` | "Backend: Decouple surface/ui.ts (HTTP/WS Router vs FS Subscription Hub)" (resolved) |
| `01KZKQBPA6X2TH267MRJEY1R95` | "mutations.updateNodeContent() captures full wireNodes snapshot; server POST failure triggers resyncOrRestore() which re-hydrates the entire graph." |
| `01KZP5JXAWKCKCFDVR6C1JP4K4` | "Backend suite: bun test in tools/kb — 435 pass, 0 fail, 66 files." |
| `01M0NA2YF1ZQGBBDTQQ65T0ZX3` | "D backend abstraction hardening + ext SDK type surface" |

`INSPIRATIONS.md:35` also names **GDB-Engines** (comparative catalog of 145+ graph
engines, query languages, embedded/LPG/RDF traits) as the reference for
"evaluating storage/query backends" — i.e. the backend-selection homework is
already scoped in the repo.

## B.9 Assessment — the natural seam

### What is already right

- **The byte-store port exists and is honoured.** `EffectStore` has exactly two
  methods; `JsonlStore` is constructed in exactly two production places
  (`services.ts:82` in `jsonlStoreLayer`, `services.ts:104` in `openKbEffect`);
  `KbStore` is already an Effect `Context.Service` with a `Layer.succeed`
  constructor. Adding a second byte backend is a Layer swap plus deleting the
  `new JsonlStore(root)` at line 104 in favour of `yield* KbStore`.
- **Everything above `foundation/` sees only `KbNode`.** operations, render,
  registry, CLI, MCP, HTTP, WS never import `JsonlStore`. DESIGN.md:221-223's
  claim ("backend-agnostic by construction") is true *for the store*.
- **The index build is one pure function.** `nodesToDatoms` /`buildQueryDb` take
  `KbNode[]` and return a value; they have no I/O and no state. A different index
  slots in at the same signature.
- **Determinism seam.** Time and identity already flow through Effect `Clock` and
  `Random` with a grep guard. A backend that mints its own rowids or timestamps
  would break that — worth stating as a constraint up front.
- **`d.*` is 6 call sites in 3 files.** The DataScript *API* surface is tiny.

### The real seam is NOT `Store` — it is `QueryDb`

The plan ("JSONL stays truth, fast engine becomes a rebuildable index") maps onto
the code as: keep `EffectStore` exactly as it is, and give `QueryDb` a port it
does not currently have. Concretely:

```ts
// today: a concrete struct, DataScript-shaped
export interface QueryDb { db: unknown; ids: IdMap; nodes: Map<NodeId, KbNode>; }
```

`QueryDb` is passed by value into `query()`, `pull()`, `resolveScope`, the docs
renderer, and the ontology resolver, and reassigned onto the mutable
`ctx.qdb`. There is no interface, no Layer, no Effect service for it. That is the
one abstraction the refactor has to invent — and by Rule 1 it should be invented
*once*, replacing `ctx.qdb`, not added beside it.

### What a `Persistence` / `Index` contract would need — from actual callers

Operations genuinely required today, derived by enumerating every consumer:

**Store (already exists, keep):**
1. `loadAll(): KbNode[]` — `services.ts:105,134`
2. `commit(tx: {upserts, deletes}): void` — `services.ts:118,154`, `cli.ts:396`

**Index (does not exist yet). Every caller needs exactly one of:**
3. `runDatalog(edn: string, ...inputs): unknown[][]` — `operations/index.ts:676`
   (graph.query), `:704` (graph.run), `operations/docs/index.ts:84` (render),
   `operations/ontology.ts:54` (ontology resolver, injected as a runner),
   `surface/ui/session.ts:171,233` (subscribe + re-run)
4. `pull(pattern: string, id): unknown` — `operations/index.ts:559` (node.get)
5. `getNode(id): KbNode | undefined` and `allNodes(): Iterable<KbNode>` —
   currently served by `ctx.qdb.nodes` (`operations/docs/index.ts:21`,
   `services.ts:36`) and by `ctx.nodes` (46 call sites, incl. `nodeById`
   `operations/index.ts:194`, `graph.search` `:756`, `session.ts:212`,
   `hub` snapshot, `cli.ts`)
6. `substringSearch(text, limit)` — today an array scan
   (`operations/index.ts:750-765`); the obvious first thing a real index would own
7. `rebuild(nodes: KbNode[])` / `applyTx(tx)` — the invalidation hook. Today
   only `rebuild`, called at `services.ts:46,122,135,159` and
   `session.ts:97,213`. A rebuildable-index design needs both, plus a
   generation/rev token so callers can tell staleness.
8. `withVirtualNodes(nodes)` — saved-query nodes exist in the index and not in
   the store (`services.ts:24-47`, `surface/ui/saved-queries.ts:52-73`). Any
   index port must model "index-only rows" as a first-class concept, or that
   special case will regrow as an `if`.

Note operations 3-6 are all **read** and all currently synchronous. Making them
`Effect` (async, with a typed error) is the right shape for a SQLite/Cozo backend
but is a wide mechanical change: `query()` and `pull()` are called from inside
`Effect.try` blocks that assume sync throw (`operations/index.ts:676`,
`docs/index.ts:84`, `ontology.ts:54`, and the try/catch in `session.ts:170-187`).

### What leaks (hard constraints)

1. **The DataScript EDN dialect is the public API.** This is the binding
   constraint, and it is bigger than "CLI and MCP accept EDN strings". EDN
   appears as *stored user data* in at least seven places:
   `.kb/queries/*.edn` files; `.kb/views/*.json` specs; `sys.f.query` on `#query`
   nodes; `sys.f.onto.query` on `#ontology` nodes; `sys.f.targetQuery` on ref
   field nodes; `sys.f.lens.query` on graph perspectives; `sys.f.view.filter`
   clauses. Plus the WS `{op:"subscribe", query:"<edn>"}` protocol
   (`surface/protocol.ts`, DESIGN-UI.md:78-82), which is the documented
   third-party integration surface ("other apps can subscribe"). **A backend that
   does not speak this exact dialect must either translate it or migrate committed
   user data.** And it is not even standard DataScript EDN — `normalizeEdnQuery`
   quotes attribute keywords into strings, so queries are written against a
   locally-defined variant.
2. **The attribute vocabulary is derived, not declared.** `:f/<fieldId>` attrs
   are minted per field node, and an attr becomes a `ref` iff some node currently
   holds a ref value for it (`datascript.ts:174-215`). A relational/typed backend
   needs either a declared schema (which the model deliberately does not have —
   "fields are nodes") or an EAV table, which gives back DataScript's shape.
3. **Eids are positional.** `buildIdMap` (`datascript.ts:101-114`) assigns
   `1..n` by sorted id, so an eid is meaningless across two builds. Any
   incremental backend must own stable internal ids and keep `NodeId` as the
   external key — and `reviveValue`/`revivePull` (230-287), which map integers
   back to NodeIds on the way out, would have to be re-specified.
4. **Ordering is not in the index.** `:node/child-order` is emitted but unusable
   (B.2); real order lives in `node.children` array position and the optional
   `node.order` fractional rank, neither of which is queryable. A backend with
   real ordering would be *better*, but only if the outline code
   (`ui/src/stores/outline.store.ts`, `foundation/order.ts`) is moved onto it —
   otherwise it is a second ordering mechanism, which Rule 1 forbids.
5. **`onExcessProperty: "preserve"`** — unknown JSON keys must survive a round
   trip (`node-schema.ts:8-10, 61-62`, and `order` itself relies on it, B.1). A
   column-shaped backend needs a JSON overflow column or it silently drops data.
6. **Whole-graph values leak through the wire.** `GraphSnapshot` is every node
   (`session.ts:109-116`); `contentHash` and `diffNodes` are whole-set
   operations. A backend that can answer partial queries buys nothing until the
   snapshot protocol is paged, which is a separate DESIGN-UI change.
7. **The browser has its own DataScript.** `ui/src/ds/{datoms,db,query}.ts`
   (445 LOC) is a documented fork of the backend builder
   (`ui/src/ds/datoms.ts:1-4,10-15`: "must mirror it"). It is nothing but the
   pure parts, so it is fine — but it means a new index engine either ships to
   the browser too (bundle cost; the two `MENTION_RE` regexes already differ:
   backend `[^[\]|]+` at `datascript.ts:26` vs UI `[^\]|]+` at `ui/src/ds/datoms.ts:18`)
   or the UI's local query capability regresses to server round-trips.
8. **`ctx` is mutable shared state.** Three different owners assign `ctx.qdb` /
   `ctx.nodes` (`services.ts`, `session.ts`, `cli.ts:401`). Any Layer-shaped
   Persistence service has to take that ownership over, or the seam is decorative.

### Risks, ranked

1. **Query-language coupling** (leak 1). Highest. Committed user data — not just
   code — is written in a locally-flavoured DataScript EDN. Mitigation options in
   increasing order of honesty: keep DataScript as the *only* query engine and use
   the new backend purely as a **materialization/durability layer** (no query
   language change at all); or add an EDN→SQL/Datalog translator owned in one
   module; or version the stored EDN and migrate. The first is the only one that
   is cheap, and it is also what "rebuildable index" most naturally means.
2. **Sync→async read path.** Four `Effect.try` sites and one try/catch assume
   `query()`/`pull()` throw synchronously. Mechanical but touches
   `operations/index.ts`, `operations/docs/index.ts`, `operations/ontology.ts`,
   `surface/ui/session.ts`, and the ontology resolver's *injected runner*
   signature (`foundation/ontology.ts` is pure and isomorphic by design —
   DESIGN.md:298-306 — and is shared with the browser through `@kb/ontology`, so
   its runner type is a three-surface contract).
3. **Subscription model.** `applyNodes` re-runs *every* live query on *every*
   content change and compares row hashes. A backend with real incremental
   maintenance would want dependency tracking — explicitly an unbuilt growth path
   (DESIGN-UI.md:92-94). Doing it at the same time as the backend swap doubles
   the blast radius; doing it later means the new backend's main advantage is
   unrealized.
4. **Two sources of truth.** The moment an index is durable, it can diverge from
   the JSONL (crash between commit and index write, external `git checkout`, a
   merge). Needs: an index generation/fingerprint checked against the store's
   content hash (`contentHash` already exists, `session.ts:37-42`), a
   rebuild-from-scratch path that is always correct, and a decision about whether
   the index file is gitignored (it must be — cf. `.kb/assets`, `.gitignore:29-37`).
5. **Index-only rows** (leak/op 8). Saved-query virtual nodes already break the
   "index mirrors store" invariant, with a subtle rule about resurrection
   (`services.ts:14-26`). Model this explicitly or it will be re-discovered as a bug.
6. **Write amplification is currently the cheap part.** At 231 nodes the full
   rewrite costs nothing; the argument for a new backend is not write cost today
   but query/subscription cost at 50k. Worth measuring `applyNodes` +
   `buildQueryDb` at the benchmark scale before committing — `tests/benchmark.test.ts`
   already builds the fixture and would need ~10 lines to also time the
   interactive triple-rebuild.
7. **Determinism/DST.** `tests/dst/harness.ts` asserts byte-identical store replay
   from a seed. A backend with its own clock, rowids, or nondeterministic
   iteration order breaks that guarantee, and the grep guard
   (`dst/guard.test.ts`) will not catch it because it only scans `src/**`.
8. **Bun coupling.** `contentHash` uses `Bun.hash` (`session.ts:41`);
   `durable-replace.ts` and `write-lock.ts` use `node:fs` sync APIs directly
   rather than the Effect `FileSystem` port. A native SQLite (`bun:sqlite`) is
   fine for the production runtime but deepens the Bun dependency that
   DESIGN.md:35-41 keeps deliberately scoped.

### Concrete recommendation of the seam

Two ports, one new:

```
        surfaces (CLI / MCP / HTTP / WS)
                    │  actions + receipts  (unchanged)
              operations / render
                    │
        ┌───────────┴────────────┐
   KbStore (exists)         KbIndex (NEW — replaces ctx.qdb)
   loadAll / commit         rebuild(nodes) / applyTx(tx)
                            runDatalog(edn) / pull(pattern,id)
                            getNode(id) / allNodes() / search(text)
                            generation: number
        │                           │
   JsonlStore              DatascriptIndex (today, in-memory, rebuild-only)
   (+ future backends)     SqliteIndex / CozoIndex (durable, rebuildable,
                            gitignored, fingerprinted against store hash)
```

`KbContext` then stops being a mutable bag: `nodes` and `qdb` both move behind
`KbIndex`, `KbCtx` keeps `root` + the two services, and the three places that
currently assign `ctx.qdb` become one `KbIndex.applyTx`. That is the version that
satisfies Rule 1 — one mechanism for "the current graph", one owner. Anything
that leaves `ctx.qdb` in place *and* adds a service beside it is the parallel
path the repo's first rule forbids.

The cheapest correct first move, given leak 1: keep DataScript as the query
engine and make `KbIndex` a durable **cache of the built db** keyed by the store's
content hash — that removes the triple-rebuild-per-edit and the cold-start
`init_db`, changes no query semantics, breaks no committed user data, and leaves
the engine swap as a genuinely separable second decision.
