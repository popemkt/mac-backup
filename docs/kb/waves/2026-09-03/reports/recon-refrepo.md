# RefRepo — Engineering Stack & Enforced-Rules Recon

Repo: `<refrepo checkout>`
Read-only reconnaissance. Nothing in the target repo was modified.

Target audience: an engineer deciding what to port into a **small single-package Bun + TypeScript project (`kb`)** using Effect 4 beta, Vite+ (`vp`), oxlint, knip, tsc, Stryker, fast-check.

**One-line verdict up front:** RefRepo's lint stack is *oxlint-first, ESLint-as-remainder* — exactly the shape `kb` already has. Its most portable inventions are (a) the **lint-warn count ratchet**, (b) the **`.harness/` repo-shape test suite** (structural invariants as plain `node --test` files), (c) the **canonical-statement / rules-index discipline**, and (d) the **`TODO NGH:` drift-marker protocol**. Its Nx/tag/boundary machinery is monorepo-only.

---

## 0. Repo shape at a glance

```
apps/     refrepo-api (NestJS), refrepo-studio (React/Vite), refrepo-temporal-worker, refrepo-external-mocks
libs/     refrepo-domain, config-schema, refrepo-mock-scenarios,
          libs/shared/*   (14 libs: agent-contracts, agent-runtime, api-config, database, errors,
                           lane-proof-harness, lane-temporal, plugin-contracts, sandbox, sources,
                           telemetry, test-kit, tools, write-target)
          libs/swimlanes/* (7 libs: anchor, atlas, forge, lens, proof, signal, spark)
scripts/  dev-stack launchers + custom analysis tooling (detect-heuristics, coverage-baseline, ...)
.harness/ 17 repo-shape invariant tests (node --test, *.test.mts)
agents/   31 agent prompt YAMLs + .prompt-check/ (2-stage prompt-quality gate)
technical-specs/  ~40 spec docs; rules-index.md is the rule registry
learnings/        30 operational-knowledge notes
.azure/, azure-pipelines*.yml   CI (Azure DevOps)
```

28 workspace packages, no `project.json` anywhere — **Nx project config is inlined in each `package.json` under an `"nx"` key**.

Root docs: `AGENTS.md` (43.9K, canonical; `CLAUDE.md` is a symlink to it), `AI_README.md`, `ARCHITECTURE.md` (dated, generated, explicitly non-canonical), `README.md`, `DESIGN.md` (**a UI design system doc — Raycast-inspired visual language — not engineering philosophy; ignore for porting**), `CHANGELOG.md` (1.2 MB).

---

## 1. LINT

### 1.1 The governing meta-rule: one stack

From `AGENTS.md` § *Code-unit cohesion & clean boundaries rule*, verbatim:

> - **Oxlint is the primary quality stack; ESLint carries only what Oxlint cannot express.** Every rule Oxlint *can* express lives in the workspace-root `.oxlintrc.json` (correctness + L2 sensors) and has no second home. One stack is a best-effort preference, not a veto: **if a rule needs enforcing, the rule trumps single-stack.** So `eslint.config.mjs` (run as `pnpm lint:boundaries`) additionally carries the rules Oxlint genuinely cannot express — today `@nx/enforce-module-boundaries` (Oxlint has no graph-aware rule) and the `no-restricted-syntax` double-cast ban (absent from Oxlint 1.63). Each such rule documents in-config *why* Oxlint cannot express it and what would let it move back; when Oxlint gains the capability, the rule migrates and ESLint shrinks again.

There is exactly **one** `.oxlintrc.json` (repo root) and exactly **one** `eslint.config.mjs` (repo root). No per-package lint config. Every package's `lint` script points back at the root file:

```
"lint": "vp lint . -c ../../.oxlintrc.json --type-aware"
```

### 1.2 `/.oxlintrc.json` — the primary stack (complete)

Plugins enabled: `["oxc", "typescript", "unicorn", "react", "import", "node", "promise"]`
Env: `{ node: true, browser: true, builtin: true }`
Ignore: `dist`, `**/dist/**`, `playwright-report`, `test-results`, `.references/**`, `_playground/**`

**Categories** (blanket severity for whole rule families):

```jsonc
"categories": {
  // correctness: mechanical zero-judgment defects (2026-08-28).
  // suspicious: probable defects — second error category (2026-09-02, spec 20 §Lint tiers).
  "correctness": "error",
  "suspicious": "error"
}
```

Note what is *not* enabled as a category: `pedantic`, `style`, `restriction`, `nursery`, `perf`. Only two of oxlint's categories are on.

**Explicit rules, grouped by what they cover:**

| Category | Rule | Severity | Options |
|---|---|---|---|
| Import hygiene | `import/no-cycle` | **error** | — |
| Import hygiene | `import/no-unassigned-import` | **error** | `{allow: [reflect-metadata, @xyflow/react/dist/style.css, ./index.css, ./tracing, ./tracing.js, ./index, ./nest, ./proof-workflow, ./workflow-index, ./worker-index, ./forge-activities, ./anchor-workflow, ../src/plugins/plugins.module]}` |
| Import hygiene | `no-restricted-imports` | **error** | `["@refrepo/test-kit", "@refrepo/lane-proof-harness"]` — test-support libs may not be imported from production files |
| Type safety | `typescript/no-explicit-any` | **error** | — |
| Type safety | `typescript/consistent-type-assertions` | **error** | `{assertionStyle: "as", objectLiteralTypeAssertions: "never"}` |
| Type safety | `typescript/no-unnecessary-type-assertion` | **error** | — |
| Type safety | `typescript/no-extraneous-class` | **error** | `{allowWithDecorator: true}` (NestJS modules) |
| Type safety | `typescript/no-unsafe-type-assertion` | ⚠️ **warn** | — |
| Type safety | `typescript/no-redundant-type-constituents` | ⚠️ **warn** | — |
| Type safety | `typescript/no-non-null-assertion` | ⚠️ **warn** | — (369 existing violations) |
| Type safety | `typescript/no-base-to-string` | ⚠️ **warn** | — |
| Type safety | `typescript/no-deprecated` | ⚠️ **warn** | — |
| Promises / async | `typescript/await-thenable` | **error** | — |
| Promises / async | `typescript/no-floating-promises` | **error** | — |
| Promises / async | `promise/always-return` | ⚠️ **warn** | — |
| Promises / async | `promise/catch-or-return` | ⚠️ **warn** | — |
| Correctness | `typescript/no-implied-eval` | **error** | — |
| Correctness | `typescript/no-misused-spread` | **error** | — |
| Correctness | `typescript/require-array-sort-compare` | **error** | — |
| Correctness | `typescript/restrict-template-expressions` | **error** | — |
| Correctness | `typescript/unbound-method` | ⚠️ **warn** | — |
| Core JS | `no-unused-vars` | **error** | — |
| Core JS | `no-var` | **error** | — |
| Core JS | `prefer-const` | **error** | — |
| Core JS | `no-console` | **error** | — (off in scripts/agents/tests) |
| Core JS | `no-eq-null` | **error** | — |
| Core JS | `default-case` | **error** | — |
| Core JS | `no-shadow` | ⚠️ **warn** | — |
| **Complexity (branching tier — hard gate)** | `complexity` | **error** | `20` (cyclomatic) |
| **Complexity (branching tier)** | `max-depth` | **error** | `5` |
| **Complexity (branching tier)** | `max-nested-callbacks` | **error** | `4` |
| **Size (soft tier — never blocks)** | `max-lines-per-function` | ⚠️ **warn** | `{max: 120}` |
| **Size (soft tier)** | `max-params` | ⚠️ **warn** | `5` |
| **Size (soft tier)** | `max-lines` | ⚠️ **warn** | `{max: 900}` |
| Perf | `oxc/no-accumulating-spread` | **error** | — |
| Perf | `oxc/no-map-spread` | ⚠️ **warn** | — |
| React | `react/button-has-type` | **error** | — |
| React | `react/no-danger` | **error** | — |
| React | `react/react-in-jsx-scope` | **off** | React 19 automatic JSX runtime |
| React (`*.tsx` override) | `react/rules-of-hooks` | **error** | — |
| React (`*.tsx` override) | `react/only-export-components` | **error** | `{allowConstantExport: true}` |
| React (`*.tsx` override) | `react/exhaustive-deps` | ⚠️ **warn** | — |
| React | `react/no-array-index-key` | ⚠️ **warn** | — |
| Node | `node/no-process-env` | ⚠️ **warn** | — (265 existing violations; ties to the *Feature flag rule* — env reads should be centralized in the config schema) |
| Style | `unicorn/consistent-function-scoping` | ⚠️ **warn** | — |

**Overrides (5):**

1. `**/scripts/**`, `agents/**`, `**/test-connections.ts`, `**/test-atlas-tools.ts` → `no-console: off`
2. `**/*.tsx` → adds the three React hook rules above
3. `**/*.spec.*`, `**/*.properties.spec.*`, `**/test/**`, `.harness/**` → `no-console: off`, `no-restricted-imports: off`
4. `**/*-parity-fixture.ts` → `no-restricted-imports: ["error", "@refrepo/test-kit"]` (allows lane-proof-harness only)
5. `**/*.spec.*`, `**/test/**`, `.harness/**`, `**/*-parity-fixture.ts` → `typescript/consistent-type-assertions: off`
6. `**/*.spec.*`, `**/*.properties.spec.*`, `**/test/**`, `**/e2e/**`, `.harness/**` → `typescript/{no-floating-promises,no-unsafe-type-assertion,no-unnecessary-type-assertion,unbound-method}: off`

**Not covered at all:** security plugins (no `eslint-plugin-security`, no `oxc` security category beyond correctness), `sonarjs`, `eslint-plugin-boundaries`, `jsx-a11y`, `n/`-style Node-correctness beyond `node/no-process-env`, and any Effect-specific lint plugin (`@effect/eslint-plugin`, `eslint-plugin-effect` — **absent**).

### 1.3 `/eslint.config.mjs` — the remainder stack (2 rules only)

Header comment, verbatim (this is the discipline worth porting):

> ```
> // Oxlint (root .oxlintrc.json) is the primary quality stack. ESLint carries ONLY rules
> // Oxlint cannot express — never a duplicate of anything Oxlint already gates. Each rule
> // here states why Oxlint cannot express it and what would let it move back.
> //
> // 1. @nx/enforce-module-boundaries — graph/tag boundaries. Oxlint has no graph-aware rule.
> // 2. no-restricted-syntax (double-cast ban) — Oxlint 1.63 has no `no-restricted-syntax`
> //    (naming it fails config parse) and its type-aware substitute needs `--type-aware`.
> //    See technical-specs/16-domain-typing-conventions.md §Type-assertion gate.
> ```

Plugins: `@nx/eslint-plugin`, `typescript-eslint` (registered **rules-off**, only so pre-existing `eslint-disable @typescript-eslint/*` comments in backend code resolve — `linterOptions.reportUnusedDisableDirectives: "off"`). **No `strict`/`strictTypeChecked` preset is applied.** Parser: `tseslint.parser` (no `parserOptions.project` — not type-aware).

Ignores: `**/dist/**`, `**/node_modules/**`, `**/*.d.ts`, `apps/refrepo-studio/**` (the studio is excluded entirely, documented as a residual gap).

**Rule 1 — `@nx/enforce-module-boundaries`** (`error`) — see §2.
**Rule 2 — the double-cast ban** (`error`), verbatim:

```js
"no-restricted-syntax": [
  "error",
  {
    selector:
      "TSAsExpression > TSAsExpression.expression[typeAnnotation.type='TSUnknownKeyword']",
    message:
      "Double cast `x as unknown as T` defeats every check TypeScript would apply. Fix the type at the source: a type guard, Schema.parse, or a domain mapper. See technical-specs/16-domain-typing-conventions.md §Type-assertion gate. An unavoidable external-SDK seam needs an eslint-disable-next-line with a TODO NGH naming the seam.",
  },
],
```

Carve-out globs for that rule (`TEST_LAYER`):
```js
const TEST_LAYER = [
  "**/*.spec.*", "**/test/**", ".harness/**",
  "**/*-parity-fixture.ts", "libs/shared/test-kit/**",
];
```
The in-file comment records the census behind the carve-out: *"277 `as unknown as` hits across 72 files — a campaign, not a rule flip."*

Note `x as any as T` is deliberately **not** covered here because `typescript/no-explicit-any` already errors on it — an explicit anti-duplication decision.

### 1.4 Lint invocation topology

```jsonc
"lint":            "pnpm run lint:all",
"lint:all":        "pnpm run lint:projects && pnpm run lint:tooling && pnpm run lint:boundaries",
"lint:projects":   "nx run-many -t lint",              // each package: vp lint . -c <root>/.oxlintrc.json --type-aware
"lint:tooling":    "vp lint scripts agents .harness eslint.config.mjs -c .oxlintrc.json --type-aware",
"lint:boundaries": "eslint libs apps/refrepo-api/src apps/refrepo-temporal-worker/src apps/refrepo-external-mocks/src scripts"
```

`--type-aware` is on for every oxlint pass. `.harness/lint-scope-coverage.test.mts` mechanically proves that **every tracked source file falls into exactly one oxlint scope** (`lint:projects` XOR `lint:tooling` XOR a recorded `EXCLUDED_BY_DECISION` entry, currently only `_playground/`), that every declared scope is actually invoked by `pnpm lint`, and that `lint:boundaries` never reaches a file oxlint does not. **This is the single most portable idea in the lint section** — it closes the "we have a linter but it doesn't actually run over that directory" hole.

### 1.5 The warning ratchet (the mechanism that makes `warn` non-toothless)

`.harness/lint-warn-baseline.json` — generated by `pnpm harness:ratchet:snapshot`, checked by `pnpm harness:check`:

```jsonc
{
  "//": [
    "L2 warning ledger. GENERATED — do not hand-edit; run `pnpm harness:ratchet:snapshot`.",
    "Checked by `pnpm harness:check`: a rule whose count RISES fails the build; a drop passes.",
    "Contract: technical-specs/20-code-unit-cohesion.md §L2 -> Count ratchet.",
    "No timestamp on purpose: two snapshots of the same tree must produce the same file."
  ],
  "lanes": {
    "default": {
      "blocking": true,
      "total": 935,
      "rules": {
        "eslint(max-lines-per-function)": 138,
        "eslint(max-lines)": 26,
        "eslint(max-params)": 36,
        "eslint(no-shadow)": 16,
        "node(no-process-env)": 265,
        "oxc(no-map-spread)": 15,
        "promise(always-return)": 11,
        "promise(catch-or-return)": 4,
        "react(no-array-index-key)": 9,
        "typescript(no-non-null-assertion)": 369,
        "unicorn(consistent-function-scoping)": 46
      }
    },
    "deprecations": {
      "blocking": false,
      "total": 13,
      "rules": { "typescript(no-deprecated)": 13 }
    }
  }
}
```

So: a `warn` rule cannot be silently grown, but a legitimately large cohesive unit can keep its warning. Two lanes — one blocking, one advisory (the `--type-aware` deprecation lane is non-deterministic against built `dist/`, so it is reported and never gated).

### 1.5a What was measured and rejected (`technical-specs/20-code-unit-cohesion.md`)

Spec 20 carries a full rejection table with numbers. **This is the highest-value evidence in the repo for anyone choosing a lint stack**, because every entry is a measurement rather than an opinion — and several of the rejected candidates are on `kb`'s own shortlist.

| Candidate | Measurement | Verdict |
|---|---|---|
| `typescript-eslint` **`strict-type-checked`** | **130.3 s** whole-repo (vs ~5 s) — 26× cost for near-identical coverage | **REJECT** |
| Oxlint `--type-aware` (oxlint-tsgolint) | +6.8 s / +61% (11.2 s → 18.0 s) whole-repo | **ENABLE** |
| Oxlint **`style`** category | 37,580 findings | **REJECT** — Oxfmt owns formatting |
| Oxlint **`restriction`** category | 11,375 findings | **REJECT as a category**; six rules cherry-picked individually |
| Oxlint **`pedantic`** category | 4,099 findings | **REJECT** |
| `eqeqeq` | 47 findings, **100% false-positive in this repo** | **REJECT** |
| **`knip`** | 33.6 s, with false positives | **DEFER** |
| `dependency-cruiser` | — | **ADOPT then superseded** — folded into Oxlint `import/no-cycle` |
| `eslint-plugin-boundaries` | — | **SKIP** |
| `jscpd`, `ts-prune`, `osv-scanner`, `trivy`, CodeQL-local, SCIP | — | **REJECT** — each duplicates a surface already owned (*No duplicate concepts rule*) |
| `type-coverage` | — | **DEFER** |
| Semgrep | — | **DEFER** |
| `unicorn/no-useless-undefined` | — | **REJECT** — no bug story behind it |

The governing decision: ***"Categories stay cherry-picked, never adopted wholesale (2026-08-31)."*** And a second one worth quoting: ***"Growth blocks, existing debt does not (2026-08-31)."***

One gap no linter closes, and the reason `tsc` strictness is not redundant with lint: *"a dead NestJS injected constructor property … is invisible to Oxlint's `no-unused-vars`"* — only `tsc` reports it (TS6138). Hence `noUnusedLocals` + `noUnusedParameters` in the base tsconfig.

### 1.5b The lint-scope incident (why §1.4's coverage test exists)

Worth recording because it is the strongest argument for the scope-coverage test. Spec 20 § *Lint scope*:

- **39 source files — 100% of non-package code** (`scripts/`, `agents/`, `.harness/`, root files) were reached by **no lint target at all**.
- *"the two worst branching offenders this repo has ever carried grew **inside** the unlinted tooling scope"* — cyclomatic complexity **69** and **58**.
- The resulting rule: *"Every source file in the repository falls in exactly one bucket, decided explicitly … and it is mechanically impossible for a file to exist in a state where nothing has decided whether it is linted."*
- And the decision not to soften it for tooling code: ***"A second severity tier for the same rules in the same config is a second quality stack wearing a disguise."***

The coverage test scans **tracked *and* untracked-but-not-ignored** files, so a brand-new unlinted file fails immediately rather than after it is committed.

### 1.5c Count-ratchet semantics (exact verdicts)

Spec 20 distinguishes two ratchets; only one is live:

| | Threshold ratchet | **Count ratchet** |
|---|---|---|
| Moves | the rule's threshold | nothing |
| Freezes | nothing | the per-rule warning count |
| Blocks | never | a PR that **raises** any rule's count |
| State | **paused** | **wired** |

Verdicts, verbatim: *"rise → exit 1 (only failure); drop → exit 0, prompts re-snapshot (doesn't self-update); equal → silent; rule absent from baseline but firing → treated as rise from 0 ('a newly-enabled rule cannot arrive pre-forgiven')."*

Granularity is **per-rule, whole-repo** — deliberately not per-package or per-file: *"Per-file granularity turns every legitimate refactor into a baseline conflict."*

There is also a documented **narrating-orchestrator exemption**: swimlane `run` methods legitimately exceed `max-lines-per-function` because they transcribe the spec procedure as named at-level steps. The exemption is a pinpoint `oxlint-disable-next-line` with a `TODO NGH:`, disabling **only** the line-count rule — `complexity` and `max-depth` stay live on the same body.

### 1.6 Formatter

**Oxfmt via `vp fmt`.** No prettier, no biome, no dprint, no `.editorconfig`.

```jsonc
"fmt":       "vp fmt apps libs scripts .harness/module-public-surface.test.mts --write",
"fmt:check": "vp fmt apps libs scripts .harness/module-public-surface.test.mts --check"
```

Enforced only at commit time by `.githooks/pre-commit` (auto-format-and-restage, non-blocking). **`fmt:check` is not a CI step.**

---

## 2. NX / MODULE COHESION

### 2.1 `nx.json` (complete)

```jsonc
{
  "defaultBase": "main",
  "parallel": 3,
  "namedInputs": {
    "default": ["{projectRoot}/**/*", "sharedGlobals"],
    "sharedGlobals": ["{workspaceRoot}/nx.json", "{workspaceRoot}/pnpm-lock.yaml", "{workspaceRoot}/agents/**/*"],
    "production": ["default", "!{projectRoot}/**/*.spec.ts", "!{projectRoot}/**/*.spec.tsx",
                   "!{projectRoot}/**/*.test.ts", "!{projectRoot}/**/*.test.tsx",
                   "!{projectRoot}/vitest.config.*", "!{projectRoot}/playwright.config.*"]
  },
  "targetDefaults": {
    "build":         { "dependsOn": ["^build"], "inputs": ["default", "^production"], "outputs": ["{projectRoot}/dist"], "cache": true },
    "test":          { "dependsOn": ["build", "^build"], "inputs": ["default", "^production", { "env": "NODE_OPTIONS" }], "cache": true },
    "test:replay":   { "dependsOn": ["build", "^build"], "inputs": ["default", "^production"], "cache": false },
    "test:coverage": { "dependsOn": ["build", "^build"], "inputs": ["default", "^production"], "cache": false },
    "lint":          { "inputs": ["default", "{workspaceRoot}/.oxlintrc.json"], "cache": true },
    "typecheck":     { "dependsOn": ["^build"], "inputs": ["default", "^production"], "cache": true },
    "dev" /* + dev:mocks, dev:real-llm, dev:online, dev:online:headless,
             temporal:mocks, temporal:real-llm, temporal:online, temporal:online-headless */:
                     { "cache": false, "dependsOn": ["^build"], "continuous": true }
  },
  "analytics": false
}
```

- **No `nx-cloud`**, no `nxCloudAccessToken`, no `plugins`, **no generators**. `analytics: false`.
- `defaultBase: "main"` but the root `affected` script uses `--base=master` — a live inconsistency.
- `nx affected` exists only as a root convenience script (`"affected": "nx affected -t build,test,lint --base=master"`). **CI uses `run-many`, not `affected`** — the pipeline builds/lints everything.
- Note the `lint` target explicitly declares `{workspaceRoot}/.oxlintrc.json` as an input, and `.harness/nx-inputs-cover-root-config.test.mts` mechanically enforces that any root config a target's command reads is declared as an input. That test exists because of a real incident (PR 20292: a rule edit served 28/28 stale cache hits).

### 2.2 Tagging taxonomy

Tags live in each package's `package.json` under `"nx": { "tags": [...] }`. **Two orthogonal axes.**

**Scope axis** (physical location / dependency direction):

| Tag | Members |
|---|---|
| `scope:app` | refrepo-api, refrepo-studio, refrepo-temporal-worker, refrepo-external-mocks |
| `scope:swimlane` | the 7 `libs/swimlanes/*` |
| `scope:shared` | `libs/shared/*` (minus the 2 test-support) + the leaf libs at `libs/*` |
| `scope:test-support` | `@refrepo/test-kit`, `@refrepo/lane-proof-harness` |

**Layer axis** (architectural role):

| Tag | Members |
|---|---|
| `layer:domain` | `refrepo-domain` |
| `layer:contract` | `refrepo-config`, `@refrepo/agent-contracts`, `@refrepo/errors`, `@refrepo/plugin-contracts`, `@refrepo/telemetry` |
| `layer:application` | all 7 swimlanes, `@refrepo/agent-runtime`, `@refrepo/database`, `@refrepo/lane-temporal` |
| `layer:infrastructure` | `@refrepo/api-config`, `@refrepo/sandbox`, `@refrepo/sources`, `@refrepo/tools`, `@refrepo/write-target` |
| `layer:test-support` | `@refrepo/test-kit`, `@refrepo/lane-proof-harness`, `refrepo-mock-scenarios` |
| `layer:app` | refrepo-api, refrepo-studio, refrepo-external-mocks (note: `refrepo-temporal-worker` has only `scope:app` — **missing a layer tag**, a real gap) |

Full per-project mapping:

```
refrepo-api                    scope:app        layer:app
refrepo-external-mocks         scope:app        layer:app
refrepo-studio                 scope:app        layer:app
refrepo-temporal-worker        scope:app        (no layer tag)
refrepo-config                 scope:shared     layer:contract
refrepo-domain                 scope:shared     layer:domain
refrepo-mock-scenarios         scope:shared     layer:test-support
@refrepo/agent-contracts       scope:shared     layer:contract
@refrepo/agent-runtime         scope:shared     layer:application
@refrepo/api-config            scope:shared     layer:infrastructure
@refrepo/database              scope:shared     layer:application
@refrepo/errors                scope:shared     layer:contract
@refrepo/lane-proof-harness    scope:test-support  layer:test-support
@refrepo/lane-temporal         scope:shared     layer:application
@refrepo/plugin-contracts      scope:shared     layer:contract
@refrepo/sandbox               scope:shared     layer:infrastructure
@refrepo/sources               scope:shared     layer:infrastructure
@refrepo/telemetry             scope:shared     layer:contract
@refrepo/test-kit              scope:test-support  layer:test-support
@refrepo/tools                 scope:shared     layer:infrastructure
@refrepo/write-target          scope:shared     layer:infrastructure
@refrepo/swimlane-{anchor,atlas,forge,lens,proof,signal,spark}
                               scope:swimlane   layer:application
```

### 2.3 `@nx/enforce-module-boundaries` config (verbatim)

```js
"@nx/enforce-module-boundaries": ["error", {
  enforceBuildableLibDependency: true,
  allow: [],
  depConstraints: [
    { sourceTag: "scope:app",          onlyDependOnLibsWithTags: ["scope:app","scope:swimlane","scope:shared","scope:test-support"] },
    { sourceTag: "scope:swimlane",     onlyDependOnLibsWithTags: ["scope:shared","scope:test-support"] },
    { sourceTag: "scope:shared",       onlyDependOnLibsWithTags: ["scope:shared","scope:test-support"] },
    { sourceTag: "scope:test-support", onlyDependOnLibsWithTags: ["scope:shared","scope:test-support"] },
    { sourceTag: "layer:app",          onlyDependOnLibsWithTags: ["layer:app","layer:application","layer:infrastructure","layer:contract","layer:domain","layer:test-support"] },
    { sourceTag: "layer:domain",       onlyDependOnLibsWithTags: ["layer:domain"] },
    { sourceTag: "layer:contract",     onlyDependOnLibsWithTags: ["layer:domain","layer:contract"] },
    { sourceTag: "layer:application",  onlyDependOnLibsWithTags: ["layer:domain","layer:contract","layer:application","layer:infrastructure","layer:test-support"] },
    { sourceTag: "layer:infrastructure", onlyDependOnLibsWithTags: ["layer:domain","layer:contract","layer:application","layer:infrastructure","layer:test-support"] },
    { sourceTag: "layer:test-support", onlyDependOnLibsWithTags: ["layer:domain","layer:contract","layer:application","layer:infrastructure","layer:test-support"] }
  ]
}]
```

The config's own header documents the honest state, verbatim:

> ```
> // This makes lane independence and the pure domain/contract floor enforced while the
> // current application/infra split remains descriptive until the mixed runtime libs are split.
> ```

**What is actually enforced:** (a) swimlanes cannot import sibling swimlanes (lane independence); (b) `layer:domain` may depend on nothing but domain (a genuinely pure functional core); (c) `layer:contract` sits just above it. **What is not:** `layer:application` and `layer:infrastructure` are mutually permissive, so the classic dependency-inversion rule (application must not depend on infrastructure) is **not** enforced — deliberately, and documented as such.

Also documented verbatim, an honest limitation worth reusing:

> ```
> //   scope:test-support (fc arbitraries + fixture builders, e.g. @refrepo/test-kit,
> //                        @refrepo/lane-proof-harness) → shared, test-support ONLY. This axis
> //                        cannot express "devDependency only" — Nx boundaries see import edges,
> //                        not package.json dependency TYPE — so every scope may resolve it here;
> //                        the actual "spec files / test/ dirs only" restriction is the oxlint
> //                        `no-restricted-imports` fence (root .oxlintrc.json), which is
> //                        file-level.
> ```

I.e. **two mechanisms compose to express one rule**: the graph rule can't say "dev-only", so a file-level oxlint fence carries that half.

### 2.3a Architecture stance — modular-first, not hexagonal-first

`technical-specs/12-monorepo-setup.md` states the position explicitly, and it is directly relevant to how much ceremony `kb` should adopt:

> RefRepo's module rule is TypeScript-native: cohesive packages expose curated public surfaces and hide internals. The repo deliberately does **not** require a Clean/Hexagonal port for every service.

A port is required only *"when a consumer must depend on a capability while the implementation is volatile, externally effectful, or selected outside that consumer's ownership."* That is the same test `@refrepo/sandbox` passes (Docker-backed, swappable provider) and an ordinary schema module fails.

The **ideal module shape** is described as three concentric layers:

1. **Identity** — `package.json`, one concept per lib, a single `.` export.
2. **Public interface** — `src/index.ts`, hand-picked *named* re-exports. ***"Never `export *`."***
3. **Internals** — every other file. These are `export`ed so siblings can relative-import them, but are not barrel-re-exported, which makes them *"effectively `internal` … the file + the `exports` map are the only encapsulation units."*

The membership test for the barrel: ***"would a second client need to import this symbol to use the module?"***

Spec 12 also names the **barrel curation / symbol axis** as a distinct enforced axis: *"A barrel that `export *`s every file is a file-mirror in disguise."* The harness fails any barrel containing `export * from`; `export * as ns from` (a single named namespace) is fine, and a `BARREL_WILDCARD_ALLOWED` opt-out exists for genuinely public-by-design libs.

### 2.4 Path aliases / module resolution

`tsconfig.base.json` carries **no `paths` map**, by explicit decision. Its `"//"` doc comment, verbatim:

> This file carries no paths and must not grow them: module resolution is pnpm workspace + package.json exports, and a paths map here would be a second, competing resolution map — don't. It sets no target/module/moduleResolution either: packages own their module system.

Only `apps/refrepo-studio/tsconfig.app.json` has `paths` (`@/*`, `refrepo-api/contracts`, `refrepo-config`) mirrored by Vite `resolve.alias`.

The same doc comment records a real Nx footgun worth knowing:

> It ALSO exists for @nx/enforce-module-boundaries: Nx resolves imports through the root tsconfig it locates via getRootTsConfigFileName(), which looks for tsconfig.base.json then tsconfig.json and returns null when neither exists — a null there reaches path.join(workspaceRoot, null) and crashes the whole boundary lint when any file both statically and dynamically imports the same package.

### 2.5 The lib public-surface rule (`.harness/module-public-surface.test.mts`)

Structural enforcement, not prose:
- Every lib under `libs/` must publish a `.` barrel (`src/index.ts` + `exports["."]`).
- Only libs in a hand-maintained `CURATED_SUBPATHS_ALLOWED` set (`refrepo-domain`, `@refrepo/lane-temporal`, `@refrepo/lane-proof-harness`, `@refrepo/sources`, `@refrepo/write-target`) may publish extra named subpaths; `libs/swimlanes/*` structurally get `./engine` + `./nestjs`.
- Every lib's `.` barrel must use **named exports, not `export * from`** (only `refrepo-domain` is allowlisted as intentionally broad).
- A `DEFERRED_FILE_MIRROR` exemption set (currently empty) is stale-checked — the test fails once a listed lib becomes curated, forcing exemption removal.

The `.harness/README.md` is explicit about the limit of this, verbatim:

> **Shape, not curation.** The module public-surface check guards the *shape* of each lib's `exports` (a single `.` barrel, no file-mirror subpaths). It does **not** verify the barrel is a *curated interface* — an `index.ts` that `export *`s every file passes. Barrel curation (the symbol axis: the barrel re-exports only the intended public API, internals omitted) is prose discipline.

### 2.6 Other cohesion/architecture scripts

| Path | What it does |
|---|---|
| `scripts/detect-heuristics.mjs` (36.8K) | Custom static detector for *"ad-hoc logic that isn't necessarily correct"* — v1 heuristics that pass tests, carry no marker, and are silently wrong. Six shapes: **A** prose-scraping external tool output (regex/`.includes` on stdout/stderr), **B** magic numeric thresholds governing control flow, **C** string/shape heuristics standing in for validation, **D** empty-means-permissive defaults (`length === 0` early-outs, `?? []`, `?? false` on gates), **E** hardcoded lookup tables keyed on external names, **F** bare `exitCode === 0` treated as success. `--annotate` inserts `// @heuristic … — TODO NGH: …` comments AST-verified to be behavior-preserving. **Highly portable idea; not wired into CI.** |
| `scripts/coverage-baseline.mts` | Coverage *reporter*, deliberately not a gate (see §4). |
| `scripts/build-targets-report.mts` | KPI report harness for eval journeys — product-specific, not portable. |
| `agents/.prompt-check/{check,lint,judge}.mjs` | Two-stage agent-prompt quality gate (see §6). |

**Absent:** dependency-cruiser, ts-arch, madge, knip, ts-prune, publint, api-extractor, changesets.

---

## 3. TYPESCRIPT

### 3.1 `tsconfig.base.json` — the whole file

```jsonc
{
  "//": "The repo's compiler strictness contract — the one home for strictness flags (spec 11, 'Compiler strictness contract'). Every apps/libs tsconfig with compilerOptions extends this file and declares only its own delta (module system, target, lib, jsx, decorators, emit, include); none may redeclare a key set here. ...",
  "compilerOptions": {
    "strict": true,
    "noImplicitOverride": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

**That is all seven flags.** Notably **absent** repo-wide:

| Flag | Present? |
|---|---|
| `noUncheckedIndexedAccess` | ❌ nowhere |
| `exactOptionalPropertyTypes` | ❌ nowhere |
| `isolatedDeclarations` | ❌ nowhere |
| `noImplicitReturns` | ❌ nowhere |
| `noPropertyAccessFromIndexSignature` | ❌ nowhere |
| `useUnknownInCatchVariables` | implied by `strict` |
| `verbatimModuleSyntax` | ✅ **studio only** (`tsconfig.app.json`, `tsconfig.node.json`) |
| `erasableSyntaxOnly` | ✅ **studio only** |

### 3.2 The contract mechanism (the portable part)

Two rules, both mechanically enforced by `.harness/tsconfig-strictness.test.mts`:

1. Every package `tsconfig.json` with a `compilerOptions` block must `extends` the root `tsconfig.base.json`, and **may not redeclare any key the base owns**.
2. The base must set every flag listed in the `### Compiler strictness contract` **markdown table inside `technical-specs/11-toolchain.md`** — the test parses that table live, so **spec prose and the config file cannot drift apart**.
3. The base itself must carry none of `target`/`module`/`moduleResolution`/`paths`/`lib`/`jsx`.

This "the spec table *is* the test fixture" trick is the highest-leverage idea in the TS section.

The rule as stated in `technical-specs/11-toolchain.md` § *Compiler strictness contract* (decision 2026-09-02): *"one base file owns compiler strictness; every package extends it and declares only its delta."*

**The two missing flags are measured, not forgotten.** Spec 11 carries a `TODO NGH:` with censuses:

| Flag | Errors if enabled today | Plan |
|---|---|---|
| `noUncheckedIndexedAccess` | **123** | per-package drain, then flip the base flag |
| `exactOptionalPropertyTypes` | **156** | same |

with the ordering rule stated explicitly: *"the drain must complete before the flip, never after."* `isolatedDeclarations` and `verbatimModuleSyntax` appear **nowhere** in the spec tree at all.

### 3.3 Versions & module systems

- **TypeScript:** catalog pins `"typescript": "~7.0.2"` for every workspace package. The **root** `package.json` deliberately deviates: `"typescript": "npm:@typescript/typescript6@~6.0.2"` (recorded as an intentional off-catalog exception in `.harness/catalog-coverage.test.mts`). So packages typecheck on **TS 7 (the Go compiler)** while root tooling keeps a TS 6 alias **solely because `typescript-eslint` does not support TS 7**. Spec 11 records the migration evidence: ~2.7–2.9× faster build/typecheck, and verified emit parity (`.js`, `.d.ts`, and `design:paramtypes` decorator metadata byte-identical after whitespace normalization).
- **Node:** one number, **four declaration sites** that must agree — `package.json` `engines.node`, `.nvmrc`, the four `azure-pipelines*.yml` files, and the Dockerfile. Spec 11: *"Raising the floor is one coordinated edit across all four sites, never a partial one."* Currently `24`. `.harness/*.test.mts` files rely on Node's native type-stripping (≥22.18) and are executed with plain `node --test` — **no `tsc` covers `.harness/`**, so their safety is runtime `assert`s only (documented explicitly).
- **Module systems, per package (base sets none):** backend libs/apps are `"type": "commonjs"` with `module: Node16`/`NodeNext`; `refrepo-api` is `NodeNext`; studio is `"type": "module"` with `module: esnext`, `moduleResolution: bundler`, `allowImportingTsExtensions`, `moduleDetection: force`, `noEmit`.
- **Project references / composite:** effectively unused. Only `apps/refrepo-studio/tsconfig.json` is a solution-style `{files: [], references: [...]}` file. No `composite: true` anywhere; libs emit via plain `tsc -p tsconfig.json` with `declaration` + `declarationMap`, and **Nx** owns build ordering (`build.dependsOn: ["^build"]`), not TS project references.
- Decorators: `experimentalDecorators` + `emitDecoratorMetadata` on the NestJS-facing packages.

### 3.4 Domain typing conventions (`technical-specs/16-domain-typing-conventions.md`)

Not a compiler flag, but the repo's substantive type-design contract, and highly portable to a schema-driven outliner.

**Rule of thumb**, verbatim:

> once a domain value is parsed, narrowing on its discriminator should hand back the right field shape with no further checks. No `!.`, no `as`, no optional fields that "exist for one variant but not another."

**Five principles:**

1. **Typed Spine + Flexible Flesh** — spine (`id`, `version`, `status`, timestamps, FKs, discriminator) tightly typed, no `unknown`; flesh (`metadata: Record<string, unknown>`, `blocks: ContentBlock[]`) free-form.
2. **Tight discriminated unions** — whenever two or more fields are correlated, express them as `z.discriminatedUnion`, never as independent fields with optional pairings.
3. **No optional-where-discriminated** — *"If a field is sometimes present and the rule for when it appears is encodable, do not write `field?: T`. Lift the rule into a discriminator."*
4. **Discriminators are literals, not strings** — always `z.literal(...)` / `z.enum([...])`, never `z.string()`.
5. **Two cross-cutting discriminators → intersection** (`z.intersection`), not a combinatorial union.

**Named anti-patterns** (each with a worked example in the spec): `Partial<DiscriminatedUnion>` as a patch type; `as` / `!.` on domain values (*"If you find yourself writing `gate.decisionId!` … the schema is too loose. Tighten the schema; do not bypass the type."* — parsing `unknown` at a boundary is validation, not a cast); `extends Record<string, unknown>` on discriminated payloads; **inline re-declaration of a shared shape** (*"Reference the canonical schema"* — recorded incident: an inline copy of a `.strict()` schema dropped a field and broke production); status enum + optional timestamp (*"the most common offender"*).

**Construction patterns:** parse at the boundary (`Schema.parse(input)` with the parameter typed `unknown` — *"When a service's first act is `Schema.parse(input)`, the parameter is `unknown` — not the tight domain type"*); dispatch helper with one branch per variant; exhaustive `switch` with a `exhaustive: never` default.

**When to relax:** internal computation results, DTOs from external systems (tight rules apply *after* the boundary parse), UI-only ephemeral state.

**Branded ids** (`refrepo-domain/ids.ts`): a per-entity branded uuid for every spine aggregate — *"Each brand is a distinct nominal type (not a shared `Uuid`), so TypeScript catches cross-entity id mix-ups at compile time."* Ids are minted only by the matching `newXxxId()` (or generic `newId()`), all uuid **v7** (time-ordered), through one shared internal `mintBranded()`. Two factories, **no boolean flag**: `brandedUuid<Brand>()` (`z.string().uuidv7()`, the default for owned-table PKs) vs `brandedUuidAnyVersion<Brand>()` (`z.string().uuid()`, for ids not enumerable/migratable). *"Slug-valued ids stay plain strings — the brand marks 'this is one of OUR minted uuids', not 'any string id'."*

**The type-assertion gate** — five rules across two stacks:

| Rule | Stack | Type-aware | Level | Notes |
|---|---|---|---|---|
| `typescript/no-explicit-any` | Oxlint | no | `error` everywhere | includes tests |
| `typescript/consistent-type-assertions` (`assertionStyle:"as"`, `objectLiteralTypeAssertions:"never"`) | Oxlint | no | `error` prod, `off` tests | |
| `typescript/no-unnecessary-type-assertion` | Oxlint | **yes** | `error` prod (promoted 2026-09-02), `off` tests | |
| `typescript/no-unsafe-type-assertion` | Oxlint | **yes** | ⚠️ `warn` prod, `off` tests | 427-site backlog — ratchet, not gate |
| `no-restricted-syntax` double-cast selector | **ESLint** | no | `error` prod, off tests | bans `x as unknown as T` |

Governing line: ***"Gate on unsoundness, not on syntax."*** `assertionStyle: "never"` was measured and **rejected** — 138 false positives on `as const`, and 17 *misses* (double-casts routed through intermediate bindings and the `!` family). The spec's own verdict: *"The obvious-looking tightening… is the wrong gate on both axes."*

Enforcement is described as four concentric layers: (1) schema design — Zod throws at parse time; (2) `tsc --noEmit`; (3) story-driven tests; (4) the lint gate above.

---

## 4. TESTING & QUALITY GATES

### 4.0 The six test tiers (`technical-specs/09-test-strategy.md`)

Governing principle, verbatim: *"Tests should read like executable RefRepo documentation."* And on what not to write: avoid tests that *"only prove a mock returns a fixed value, a class can be instantiated, or a field happens to equal an implementation detail."*

| Tier | What it is | Blocks a merge? |
|---|---|---|
| 1 | Unit / behavior-story specs | ✅ |
| 2 | Property-based invariants (fast-check) | ✅ |
| 3 | Cassette replay (recorded LLM inference) | ❌ warn-only — three named failures `AGENT_CASSETTE_MISS` / `_STALE` / `_DRIFT` |
| 4 | `pnpm smoke:mocks` — deterministic full-stack, weekly | ❌ |
| 5 | `pnpm smoke:luna` — live model, weekly, spends real credits | ❌ |
| 6 | Lab eval runs — quality signal | ❌ |

**"The PR pipeline stops after cassette replay — nothing below it blocks a merge."** That single sentence is the whole gating philosophy: anything non-deterministic or costly is a sensor, never a gate.

Two more structural rules from spec 09:

- **Compiled-suites contract:** *"`build` compiles, `test` runs"* — never the reverse. The `test` script contains no compile step; Nx's `test.dependsOn` supplies it. Three properties follow: suites can run in parallel, the `dist/` wipe is ordered, compilation is cached once.
- **Cache-key rule:** *"A cached target's key must name everything that changes its result."* Hence `build` is keyed on `default` (not `production` — spec files must invalidate it), `test` adds `{ "env": "NODE_OPTIONS" }` for sharding, and `sharedGlobals` names every workspace-root file a target reads.
- **Isolation is structural, not conventional:** `--test-isolation=process` plus a per-spec preload that derives `.pglite/test/<spec>` and clears it *before anything imports* — rather than trusting each spec to remember to reset.
- **Placement:** component/class specs sit next to the impl; cross-service orchestration in `test/*.spec.ts`; full e2e in `test/*.e2e-spec.ts`; contract/schema next to the schema. And: ***"A spec only counts if a runner reaches it."*** A package with no `test` script contributes nothing no matter how many spec files it has — which is exactly what `.harness/test-script-shape.test.mts` mechanizes.
- **Naming convention:** `<component> <does meaningful factory behavior> <under relevant boundary/condition>`. Test-name *quality* is deliberately **not** a mechanical gate (recorded owner decision, 2026-08-27) — it is judged only by the L3 advisory reviewer.

### 4.1 Test runners

| Surface | Runner |
|---|---|
| Backend libs & apps | **`node --test` over compiled `dist/`** — e.g. `node --test "dist/**/*.spec.js"`. Specs are compiled by the package `build` first (`test.dependsOn: ["build","^build"]`). |
| `refrepo-api` | `node --test` with `--test-concurrency=2 --test-timeout=120000`, a PGlite per-spec store loaded via `--import`, sharded in CI with `NODE_OPTIONS=--test-shard=N/2`. |
| `refrepo-studio` unit | **Vitest via `vp test run`** (`test.include: ["src/**/*.spec.ts"]`, `environment: "node"`) — runs TS sources through Vite, reads no `dist/`. |
| `refrepo-studio` e2e | **Playwright**, sharded 1/2 and 2/2 in CI. |
| `scripts/` | `node --test "scripts/**/*.spec.mts"` |
| `.harness/` | `node --test ".harness/**/*.test.mts"` |

277 `*.spec.ts` files. 7 `*.properties.spec.ts` files (fast-check property suites) — one per swimlane deterministic core, plus `libs/shared/lane-proof-harness/src/canonicalize.properties.spec.ts`.

`.harness/test-script-shape.test.mts` mechanically enforces five test-script conventions:
1. any package with spec files exposes a `test` script;
2. every script a `test*` script chains to actually exists (born from an incident where 4 packages chained to an undefined `clean:dist` and **silently skipped 224 tests**);
3. any `node --test` against `dist/` requires a `build` script that includes `clean:dist` (prevents stale compiled orphan specs still running after a rename);
4. **no `prepare`/`postinstall`/`preinstall`/`install` hook may compile anything** — Nx is the sole compile scheduler;
5. every `node --test` spec glob is a single shell-quoted string.

`.harness/test-skip-pairing.test.mts`: **every `it.skip`/`test.skip`/`describe.skip`/`skip:` option must carry a `TODO NGH:` comment within 3 lines.** A `BASELINED_SKIPS` grandfather map exists and is currently **empty** ("every baselined skip has been paired with visible debt"), and is stale-checked in both directions.

### 4.2 Coverage — a reporter, never a gate

`scripts/coverage-baseline.mts` header, verbatim:

> Why a reporter rather than a gate: coverage is a signal, never a PR threshold (technical-specs/09-test-strategy.md 'Coverage policy'). This script only renders; nothing here fails a build.

It reads each package's `coverage/lcov.info` and prints a markdown table (per-package line/branch/func %, "least-covered pure modules", "largest pure modules no suite loads"). **No coverage threshold exists anywhere in the repo.** `test:coverage` targets are `cache: false` and are not in the PR pipeline.

Spec 09's *Coverage policy*, verbatim — the reasoning is the portable part:

> Coverage is a **signal, never a PR-gate threshold**. […] There is no "fail the PR below N%" check and there will not be one: chasing a percentage manufactures exactly the noise the *Testing principle* above forbids.

### 4.3 Mutation testing — Stryker, configured, advisory, not in CI

8 configs: `libs/config-schema/`, `libs/refrepo-domain/`, and all 7 `libs/swimlanes/*`. Canonical shape:

```json
{
  "testRunner": "command",
  "commandRunner": { "command": "pnpm run test:compiled:pure" },
  "coverageAnalysis": "off",
  "timeoutMS": 30000,
  "mutate": ["src/atlas-deterministic.ts"],
  "ignorePatterns": ["dist", "coverage"],
  "incremental": true,
  "reporters": ["html", "clear-text", "progress"]
}
```

- **No `thresholds` block in any config** — no `high`/`low`/`break` score gate.
- `"test:mutation": "stryker run"` appears in 9 package.jsons and in **zero** pipeline files.
- `mutate` globs are deliberately narrow — a handful of named pure modules (`*-deterministic.ts`, `lifecycle.ts`, `input-delta.ts`, `techstack-profile.ts`), never plugins/services/repositories/modules/executors/`docker.ts`, never `refrepo-api` or `@refrepo/database`, never Temporal- or docker-backed suites.
- `testRunner: "command"` + `coverageAnalysis: "off"` is the pragmatic config for a `node --test`-over-`dist/` project (Stryker has no native node:test runner).
- Policy from spec 09, verbatim: *"advisory, not a gate. The kill score is a sensor a human reads to decide where a test is missing — it never blocks a merge… a non-deterministic merge-blocker… erodes trust."*
- `.stryker-tmp/` and `reports/` are gitignored; whether the incremental cache should be persisted for CI reuse is an open question recorded in `_playground/wip/test-campaign/wp5-mutation-pilot.md`.

Spec 09's mutation contract adds five operational constraints, all learned the hard way and all portable:

> Mutation testing is **StrykerJS, command-runner only, advisory only**.

- **Bypass the task-runner cache** — the per-mutant command must be a package script Stryker invokes directly, never `nx run` (a cached "test" returns instantly and kills nothing).
- **The per-mutant command compiles; `test` does not** — hence `test:compiled` / `test:compiled:pure` as separate scripts.
- **Configs live per-package**, never one root config fanning out across the workspace.
- **Do not point Stryker at DB/Nest/Temporal suites** — CPU saturation risks a PGlite close-race wedge.
- **Prefer DI-free pure files** — with decorator metadata, a mutant can die on a DI failure instead of a real assertion, which scores a false kill.
- `vitest-runner` was ruled out specifically because of a peer-version conflict with the `vite-plus` alias.

### 4.3a Property-based testing — the anti-pattern taxonomy

This is the most reusable thing in spec 09 and applies verbatim to any fast-check project.

> **Property selection is human-owned.** A property is a design artifact, not test volume.

A property spec must **state its invariant as a falsifiable domain claim**. Three named anti-patterns, which reviewers are expected to cite by name:

| Anti-pattern | Shape | Why it has no power |
|---|---|---|
| **TAUTOLOGY** | the oracle re-implements the function under test | passes for every implementation, including a wrong one |
| **STRUCTURAL** | asserts what TypeScript/Zod already guarantee | the negation is unrepresentable |
| **Quantifier theatre** | `fc.constantFrom` over 2–3 values, or a filtered generator wearing a `forall` wrapper | claims coverage it does not have |

Keeper classes: **metamorphic relations** (idempotence, injectivity, antisymmetry, invariance, erasure), **fail-closed backstops**, **precedence**, **conservation/projection**, **cross-function agreement**.

And the sharpest note: *"Falsifiability also runs from the **rejecting side**"* — an accept-everything schema-roundtrip test is STRUCTURAL; mutate one field and assert the rejection *names the violated path*.

Conventions: titles are behavior stories stating the invariant (not `prop: isLegalReturn`); **determinism is mandatory** (no wall clock, no real network, no unseeded randomness; CI runs a fixed seed; failure prints seed + counterexample); properties are co-located as `*.properties.spec.ts`. And the restraint: *"a pure function is not by itself a reason to write a property."*

### 4.4 Git hooks — thinner than you'd expect

`core.hooksPath` is set by the root `"prepare": "git config core.hooksPath .githooks || true"`.

**`.githooks/pre-commit` (verbatim, entire file):**

```sh
#!/bin/sh
set -e

# Agent-prompt quality is checked at edit time by the Claude Code PostToolUse hook
# (fires on agent YAML change). The commit-time prompt gate was removed intentionally.

# Auto-format staged code with Oxfmt (`vp fmt`) before commit. Dependency-free:
# wired by the root `prepare` script setting `core.hooksPath=.githooks`.
# See technical-specs/14-dev-entrypoints.md. `.references/` (vendored submodule)
# is excluded — its vite.config crashes Oxfmt's config loader.
staged=$(git diff --cached --name-only --diff-filter=ACM \
  | grep -E '\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|json)$' \
  | grep -vE '^\.references/|/dist/|/node_modules/' || true)
if [ -n "$staged" ]; then
  printf '%s\n' "$staged" | xargs pnpm exec vp fmt --write 2>/dev/null && printf '%s\n' "$staged" | xargs git add || true
fi
```

**It blocks nothing.** No lint, no typecheck, no test, no harness check at commit time.

**`.githooks/pre-push` (verbatim, entire file):**

```sh
#!/bin/sh
# Entire CLI hooks
# Pre-push hook: push session logs alongside user's push
# $1 is the remote name (e.g., "origin")
if command -v entire >/dev/null 2>&1; then entire hooks git pre-push "$1" || true; else :; fi
# Chain: run pre-existing hook
_entire_hook_dir="$(dirname "$0")"
if [ -x "$_entire_hook_dir/pre-push.pre-entire" ]; then
    "$_entire_hook_dir/pre-push.pre-entire" "$@"
fi
```

Also blocks nothing (session-log side effect only).

`.githooks/.gitignore` tracks only these two files; everything else generated per-machine is untracked.

**No husky, no lefthook, no lint-staged, no commitlint.** Commit-message format (`yymmdd-hhmm: message`) is prose-only in `AGENTS.md`; the only mechanical check on it is `.harness/changelog-structure.test.mts`, which validates `## yymmdd-hhmm:` headers in `CHANGELOG.md` (each has a non-empty body, no duplicate timestamps).

Human pre-push discipline is a checklist doc, `technical-specs/pre-push-checklist.md` (verbatim, entire file):

```
================================================================================
                           PRE-PUSH REVIEW CHECKLIST
================================================================================
[ ] 1. Review Agent:
       Ask the user: "Do you want to run the Review Agent to review this change?"
       (The Review Agent reviews code, upkeep, spec alignment, and rules in
       technical-specs/rules-index.md).

       1.1 Scope Clarification (if needed):
           If you do not already know the scope or intent of this change, ask
           the user for clarification before running the review.
================================================================================
```

### 4.5 The local green gate

```jsonc
"test":     "pnpm run test:all",
"test:all": "nx run-many -t typecheck && pnpm run test:unit && pnpm run lint && pnpm run harness:check",
"test:unit": "nx run-many -t test && pnpm run test:scripts",
"harness:check": "nx run-many -t build && pnpm run harness:check:all",
"harness:check:all": "node --test \".harness/**/*.test.mts\""
```

So `pnpm test` = typecheck → unit → lint (all three passes) → harness. A developer running `pnpm test` exercises the harness without knowing it exists (explicitly the design intent, per `.harness/README.md`).

### 4.6 CI — Azure DevOps

**Duplicated-on-purpose pipeline files.** Five root `azure-pipelines*.yml` entrypoints are byte-identical copies of five `.azure/pipelines/*.yml` files, and `.harness/pipeline-copies-identical.test.mts` asserts the byte-identity until the ADO definitions are flipped:

| Root | `.azure/pipelines/` |
|---|---|
| `azure-pipelines.yml` | `pr-validation.yml` |
| `azure-pipelines.deploy.yml` | `deploy.yml` |
| `azure-pipelines.smoke.yml` | `smoke.yml` |
| `azure-pipelines.sigrid.yml` | `sigrid.yml` |
| `azure-pipelines.cassette-record.yml` | `cassette-record.yml` |

Shared step templates: `.azure/templates/steps-pr-setup.yml`, `steps-smoke-setup.yml`, `steps-smoke-publish.yml`.

**`azure-pipelines.yml` — PR validation.** `trigger: none`, `pr: branches.include: ["*"]`, `ubuntu-latest`. **Four independent jobs, zero `dependsOn` between them** ("one parallelism knob per job"; with 55 purchased parallel hosted jobs a `dist/` artifact hand-off costs more than the build it would skip). Every job begins with `steps-pr-setup.yml`: checkout `fetchDepth: 1` → assert disk headroom (**hard-fail below 6 GB free**, warn below 15 GB) → Node `24.x` → corepack pnpm `10.22.0` → `Cache@2` pnpm store keyed on `pnpm-lock.yaml` → `pnpm install --frozen-lockfile`.

| Job | Steps (all blocking unless noted) |
|---|---|
| `build_and_static` | 1. `npx nx run-many -t lint,build --parallel=2 --nxBail`<br>2. `pnpm run lint:tooling`<br>3. `pnpm run lint:boundaries`<br>4. `pnpm run harness:check`<br>5. `df -h /` (informational, `always()`) |
| `unit_libs` | 1. `pnpm run test:unit:libs`<br>2. disk headroom (informational) |
| `unit_api` (matrix `shard_1`/`shard_2`) | 1. `pnpm run test:unit:api` with `NODE_OPTIONS: --test-shard=$(SHARD_INDEX)/2`, tee'd to a log<br>2. **warn-only** "shard executed something" check (`exit 0` + `##vso[task.logissue type=warning]` if a shard ran 0 tests)<br>3. **warn-only** cassette replay (`pnpm run test:replay`, shard 2 only)<br>4. disk headroom |
| `studio_e2e` (matrix `shard_1`/`shard_2`) | 1. Cache Playwright browsers<br>2. `timeout 35m … playwright install chromium` (`timeoutInMinutes: 38`)<br>3. apt-get system deps (`timeoutInMinutes: 20`)<br>4. `pnpm nx run refrepo-studio:test:e2e -- --shard=$(SHARD_INDEX)/2 --reporter=line,junit,html`<br>5. `PublishTestResults@2` with `failTaskOnFailedTests: true` (blocking)<br>6. `PublishPipelineArtifact@1` HTML report — `continueOnError: true` (non-blocking) |

**The warn-only shape is a deliberate, documented technique worth stealing.** From the cassette-replay step:

```bash
set -uo pipefail
if ! pnpm run test:replay; then
  echo "##vso[task.logissue type=warning]Cassette replay drift — run: pnpm cassette:author (deterministic, no LLM creds). See technical-specs/09 §Replay / cassette contract."
fi
exit 0
```

with the in-file rationale: `continueOnError: true` yields `partiallySucceeded`, which a build-validation policy **could still refuse**, silently re-arming the block — so `exit 0` + `task.logissue` is the only reliable warn-only shape.

**Known gap, documented in the pipelines themselves:** Azure Repos ignores the YAML `pr:` trigger block (it only works on GitHub/Bitbucket). Auto-run on PRs against `master` needs an `EditPolicies`-holder to add a Build Validation Branch Policy on `master` for pipeline 786. **Until that policy exists, none of the above actually gates a merge** — runs are queued manually (`az pipelines run --id 786 --branch <pr-branch>`). This is the single largest gap between the repo's stated and actual enforcement.

**Other pipelines:**

- `azure-pipelines.sigrid.yml` — `trigger: master`, `pr: none`, manual-queue only. Container `softwareimprovementgroup/sigridci:azure`. One command: `sigridci.py --customer <customer> --system refrepo-application --source . --publishonly`. **No `sigrid.yaml` / `.sigrid` / `sigrid-ci` config file exists anywhere in the repo** — Sigrid is entirely CLI-flag driven. Token is currently a secret pipeline variable; a commented-out `AzureKeyVault@2` block records the target state (blocked on SPN authorization).
- `azure-pipelines.smoke.yml` — `trigger: none`, `pr: none`, weekly cron `37 2 * * 6`. Job `mocks` (deterministic, 45 min) then job `luna` (real `gpt-5.6-luna`, 90 min, skips non-blockingly via `##vso[task.complete result=SucceededWithIssues;]` when the token is unset). **Never a merge blocker by design** — real inference spend + non-deterministic live model.
- `azure-pipelines.deploy.yml` — deploy/rollback via cross-repo templates from `RefRepo.Dashboard`. Not a quality gate.
- `azure-pipelines.cassette-record.yml` — manual live Copilot cassette capture. Its first step is a **blocking parameter validator** rejecting anything outside `^[A-Za-z0-9._-]+$`, plus `.`/`..` traversal and leading `-` (option injection); it mirrors an app-side `assertSafeCassetteSegment` byte-for-byte. Positional args after `--` as argv-injection defense. Publishes artifacts with `condition: always()`.

### 4.7 `.harness/` — the repo-shape test suite (the crown jewel)

Purpose, verbatim from `.harness/README.md`:

> A normal test under `apps/*/test` proves *the system does what the spec says*. A harness check proves *the repo is shaped the way the harness rules require* — module boundaries, public surfaces, entrypoint hygiene, spec/index integrity. Different failure class, different home.

Design constraints, verbatim:

> - **No app dependency.** These read `package.json` / repo files; they must not need the app to compile, a DB, or a sandbox. They run as plain `node --test` ESM (`*.test.mts`) — no `tsc`, no framework, no build step.
> - **TS, but stripped not checked.** … Stripping **erases** types — it does **not** typecheck them. No `tsc` pass covers `.harness/`, so a check's real safety is its runtime `assert`s, not its annotations; the types are for authoring/editor support only.
> - **Outlives any one app.** A boundary check is about `libs/` and the workspace, not `refrepo-api`. Burying it in `apps/refrepo-api/test` coupled a workspace-wide invariant to one deployable.
> - **DRY.** The *rule* lives once in the spec; the *boundary* lives once in each lib's `exports` map; this is the **regression guard** on that boundary — not a second statement of the rule.

And the anti-duplication clause, verbatim:

> Checks **link** to their rule's canonical home; they never restate the rule (canonical-statement rule, `rules-index.md`).

**All 17 checks:**

| File | Invariant |
|---|---|
| `actor-attribution.test.mts` | No exported `*RequestSchema` in `refrepo-api/src` declares an `actorId:` field; every mutating controller route (`@Post/@Put/@Patch/@Delete`) carries `@CurrentActor` unless `@Public` or `debug.controller.ts`. Born from a real incident (6 routes read `updatedByActorId` from the request body with no session check). |
| `agent-policy-defaults.test.mts` | Every YAML `tool` grant across `agents/` resolves against a 42-entry runtime tool registry mirroring `ToolsModule`; `AgentPolicySchema.parse({})` is deny-by-default (`unrestricted:false`, empty path/command allowlists, `timeoutMs:60000`, `maxToolCalls:8`, `maxOutputBytes:50000`). |
| `agents-sync.test.mts` | `.claude`/`.codex` agent definitions are in sync with the canonical `.agents/agents` source (runs `sync-agents-definition-to-tools.mjs --check`). |
| `catalog-coverage.test.mts` | Every manifest dependency reads `catalog:` unless in a hand-maintained `OFF_CATALOG_BY_DECISION` list (4 entries); every recorded exception is still real; no catalog entry is unreferenced; every `overrides:` entry carries a comment naming the transitive path it exists to reach. |
| `catalog-lockfile-consistency.test.mts` | Every `catalog:` specifier in `pnpm-workspace.yaml` matches `catalogs.default.<name>.specifier` in `pnpm-lock.yaml`. Incident: `--frozen-lockfile` installed clean against a lockfile whose `typescript` resolution didn't match the catalog. |
| `changelog-structure.test.mts` | Every `## yymmdd-hhmm:` header in `CHANGELOG.md` has a non-empty body; no two headers share a timestamp. |
| `duplicate-dependency-copies.test.mts` | `pnpm dedupe --check` exits 0. Incident: a `dompurify` bump left two copies, mermaid's self-test threw, and a diagram-validity gate silently disarmed (masked by an Nx cache hit). |
| `lint-scope-coverage.test.mts` | Every source file is in exactly one oxlint scope; every declared scope is invoked by `pnpm lint`; every package the `projects` scope claims exposes a `lint` script; ESLint's `lint:boundaries` never reaches a file oxlint doesn't. |
| `lint-warn-ratchet.test.mts` | Per-rule warning counts may fall or stay flat, never rise, vs `lint-warn-baseline.json`. `default` lane blocks; `deprecations` lane reports only. The measured tooling scope is **derived by parsing the `lint:tooling` script string**, not restated, so the ledger can't silently narrow. |
| `module-public-surface.test.mts` | Curated `.` barrel per lib; named exports not `export *`; subpath allowlist; stale-checked exemption set. |
| `no-conflict-markers.test.mts` | No tracked file contains `<<<<<<<`, `>>>>>>>`, `\|\|\|\|\|\|\|`, or a corroborated `=======`. Incident: `git stash pop >/dev/null 2>&1` swallowed a conflict; `git add -A` staged markers into an org-seed JSON read at boot. |
| `nx-inputs-cover-root-config.test.mts` | Any root config an nx target's command reads is in that target's `inputs`. Incident: `.oxlintrc.json` wasn't a `lint` input → 28/28 stale cache hits after a rule edit. |
| `pipeline-copies-identical.test.mts` | The five root/`.azure` pipeline pairs are byte-identical. |
| `submodule-reachability.test.mts` | Every submodule gitlink points at a commit the remote still has — verified with a shallow `git fetch --depth=1 <url> <sha>` into a scratch repo (**not** `git ls-remote`, which exits 0 with empty output for arbitrary SHAs). Distinguishes "unreachable" (fail) from "inconclusive" (`t.skip` naming the reason). |
| `test-script-shape.test.mts` | The five test-script conventions listed in §4.1. |
| `test-skip-pairing.test.mts` | Every static skip carries a `TODO NGH:` within 3 lines; the grandfather map is empty and stale-checked. |
| `tsconfig-strictness.test.mts` | The compiler strictness contract of §3.2, with the flag list parsed live from the spec's markdown table. |

The README's own table has drifted (11 rows for 17 files) and says so, verbatim: `TODO NGH: the table has drifted behind the directory (17 check files, 11 rows) — close by giving every check a row or by deriving the table, rather than hand-maintaining it.`

---

## 5. EFFECT USAGE

**RefRepo uses Effect, but in exactly one file, as a deliberately-contained pilot.**

- Dependency: `effect: "catalog:"` → **`effect@^3.22.1`** (Effect 3, not 4). Declared by **one** package: `libs/shared/sandbox/package.json`.
- No `@effect/*` package anywhere (`@effect/schema`, `@effect/platform`, `@effect/cli`, `@effect/vitest` — all absent).
- Only importer: `libs/shared/sandbox/src/aio-provider.ts` — `import { Effect, Schedule, Duration, Exit, Cause } from "effect";`
- **No Effect-aware lint rules, no Effect ESLint plugin, no Effect conventions doc, no Effect agent skill.**

The convention is the interesting part. From `libs/shared/sandbox/src/aio-provider.ts`, verbatim:

```ts
// AioSandboxProvider — the AIO sandbox (agent-infra container) impl of SandboxProvider.
//
// This is the Effect pilot (technical-specs/22-sandbox-resource-module.md, D5). Effect is
// used ONLY inside this file for the provisioning/retry/transport composition; every public
// method runs the effect at the boundary (`runOrThrow`) and returns a plain Promise, mapping
// failures to RefRepoError. Consumers never import "effect".
```

And from `libs/shared/sandbox/src/types.ts`, verbatim:

```ts
// The shape follows what E2B / OpenHands / Daytona / Modal converged on: one value
// object (`SandboxSession`) + a provider interface (`SandboxProvider`) + a transport,
// not a class hierarchy. The public surface is Promise-based — the Effect pilot lives
// strictly inside the provider impl and is run at this boundary, so consumers never
// import "effect".
```

The boundary runner:

```ts
/** Run an effect at the boundary, throwing the underlying RefRepoError on failure. */
async function runOrThrow<A>(effect: Effect.Effect<A, RefRepoError>): Promise<A> {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
  return exit.value;
}
```

Effect is used for `Schedule`-based retry and `Duration`-typed timeouts, with a `toRefRepo(code)` mapper folding every foreign failure into the repo's own `RefRepoError` taxonomy (`@refrepo/errors`, `DRAIVER_ERROR_CODES`).

### 5.1 The containment rules, as specified

`technical-specs/22-sandbox-resource-module.md` § *Effect pilot (effect-ts)* states the rules explicitly, verbatim:

> `@refrepo/sandbox` is the **controlled trial** for Effect in this codebase. Containment rules so it does not leak:
> - **Boundary returns Promises.** Public methods end in `Effect.runPromiseExit`; consumers […] never `import "effect"`. The NestJS-injected facade is plain `Promise<T>`.
> - **Errors map out.** Effect's typed failure channel […] is matched at the boundary into `RefRepoError` with a cause-chain.
> - **NestJS owns DI, not Effect `Layer`.** …no `Layer`-based DI, no two-DI-systems clash.
> - **Zod stays** the validation/schema standard; the pilot does **not** introduce Effect Schema.
> - **Where Effect earns its place:** `acquireRelease` = owned-session auto-teardown, `Schedule` = provision/poll retry, `Scope` = the lease, the typed channel = lost/unavailable errors.

Decision record: **"Effect as a contained pilot, not a codebase-wide adoption."**

### 5.2 Effect was explicitly *rejected* for the error-taxonomy problem

Relevant to `kb` because it is the strongest argument in the repo against Effect-by-default. `technical-specs/16-domain-typing-conventions.md`, in the open error-taxonomy plan, rejects Effect verbatim:

> a whole-program paradigm… Adopting it to fix ~26 catch sites is the accidental complexity the harness principles forbid. Effect is adoptable only as a deliberate platform decision spec'd here first — never as an err-cast fix.

(`Result`/`neverthrow` is rejected alongside it: *"coexists awkwardly with NestJS and Temporal APIs that throw."*)

What RefRepo chose instead — one boundary parser, not per-site helpers (owner decision 2026-09-02, superseding an earlier "three shared units" plan):

```ts
type KnownError =
  | { kind: "exec"; code: number | string; stderr: string }
  | { kind: "http"; status: number; body: unknown }
  | { kind: "jira"; code: string /* … */ }
  | { kind: "unknown"; cause: unknown };
function toKnownError(err: unknown): KnownError;
```

Call sites `switch (e.kind)` — exhaustive, no casts. Note this is structurally the same move Effect's typed error channel makes; the objection is to the *paradigm cost*, not to typed errors. For `kb`, which has already committed to Effect 4, the objection does not apply — but the "one boundary parser folding every foreign failure into a domain union" shape is exactly what an Effect error channel should be fed from.

**Takeaway for `kb`:** there is nothing here to port for Effect 4 idiom — RefRepo's Effect content is one file. What *is* portable is the **containment pattern**: Effect confined to one adapter, `Effect.Effect<A, DomainError>` as the internal type, a single `runOrThrow` seam, and a project-wide error taxonomy the effect channel maps into. That is roughly the opposite of the "Effect all the way up" posture `kb` may want, so treat it as a data point rather than a template.

---

## 6. AGENT RULES & PHILOSOPHY DOCS

`AGENTS.md` (43.9 K, 432 lines) is canonical; `CLAUDE.md` is a symlink to it. `AI_README.md` is an orientation doc; `ARCHITECTURE.md` is explicitly a dated generated snapshot, not maintained; `DESIGN.md` is a **UI design system** (Raycast-inspired) with no engineering content.

### 6.1 Spec-as-source hierarchy (verbatim)

> RefRepo is developed **spec-as-source**: the human-readable specs are the artifact of record, the codebase is one materialization of them. The two specs together must be complete enough that a competent agent could discard the code and reimplement RefRepo from the specs alone.

```text
RefRepo.Instructions = functional spec    (what RefRepo does, who it serves, factory + swimlane behavior)
technical-specs/     = technical spec     (how the current implementation realizes the functional spec —
                                           decisions, contracts, runtime, theming, toolchain, tests)
codebase             = executable materialization of the two specs
tests                = executable proof that the materialization matches the specs
```

> - **Reimplementability.** `RefRepo.Instructions` + `technical-specs/` together are sufficient to rebuild RefRepo from scratch. If a decision lives only in code, the spec is incomplete.
> - **No second functional spec.** `technical-specs/` never re-states functional behavior owned by `RefRepo.Instructions`. It records the technical decisions, contracts, and implementation shape that bridge functional behavior to a working system.
> - **Functional changes start in `RefRepo.Instructions`.** Implementation-only changes start in `technical-specs/`.
> - **Drift is visible.** When implementation intentionally lags or diverges from `RefRepo.Instructions`, record it as a `TODO NGH:` note in the relevant technical spec — never hide drift in comments or test names.

### 6.2 Harness principles (verbatim)

> Spec-as-source needs a harness. Without one, agents re-derive conventions from code each session, drift on long tasks, and bypass the spec silently.
>
> Each principle is followed by *e.g.* — an illustrative example, not the full definition.
>
> - **Separation of concerns** — *e.g.* development affordances do not leak into production request paths.
> - **Single source of truth** — *e.g.* feature behavior is controlled from one predictable place, preferably environment/configuration.
> - **Determinism** — *e.g.* system behaves consistently based on boot-time configuration.
> - **Traceability** — *e.g.* every taken code path is explainable; no hidden toggles, no implicit fallbacks.
> - **Fail-fast** — *e.g.* invalid or conflicting settings are rejected early, not discovered at runtime. Pipeline catches issues before artifact build.
> - **Minimizing accidental complexity** — *e.g.* mock/dev paths do not make production harder to reason about.

And on the two ordering rules, verbatim:

> **Change workflow** — two rules below, in order, and both load-bearing. The *Spec-first change workflow rule* settles the **what**: functional changes start in `RefRepo.Instructions`, technical changes in `technical-specs/`, code follows, spec edits precede code edits. The *Ground-up implementation rule* then settles the **how**: the change is built in the shape it would have had if the requirement had always existed, not bolted onto the current one. Skipping the first yields code nobody specified; skipping the second yields code only its edit history explains. A change is not done until both hold.

Honest self-assessment, verbatim:

> ### Current state
>
> Only the instruction surface is wired. Agent discipline carries the rest.
>
> - `TODO NGH:` **Rules indexed but unenforced.** Every rule is listed in `technical-specs/rules-index.md` with its home, scope, principle, enforcement state, and linked gate. Index built; canonical-statement rule documented; enforcement is still `prose` for nearly every row. Close: promote rows to `lint` / `CI` / `hook` as gates are wired; add lint that fails when a `## .* rule` heading is missing from the index or restated outside its home.
> - `TODO NGH:` **Code graph not wired.** …
> - `TODO NGH:` **No story-test gate.** Test naming rule is prose only. …
> - `TODO NGH:` **Formatting hook exists; rule-enforcing hooks do not.** `.githooks/pre-commit` auto-formats staged code with Oxfmt and `prepare` wires it through `core.hooksPath`. No hook yet enforces the rules in this file. …
>
> Until closed, the loop is: agent reads `AGENTS.md`, follows references, records drift as `TODO NGH:`. No automation catches misses.

### 6.2a `technical-specs/rules-index.md` — the rule registry

The single most transferable governance artifact. One table, columns:

`| Rule | Home | Scope | Principle | Enforcement | Linked gate |`

**The `Enforcement` column is the whole point** — it takes values `prose` / `lint` / `CI` / `harness` / `hook`, so "we say we do this but nothing checks it" is a visible cell rather than a comfortable assumption.

Current distribution:

- **`prose` only (no gate):** Technical specs, Exploratory docs, Learnings, Heuristic annotation provenance, Feature request intake, Spec-first change workflow, Ground-up implementation, Task breakdown, Minimal valid entrypoints, Dev affordance isolation, Backend-authoritative logic, No duplicate concepts, Documentation architecture, Behavior test, Placement, Drift, Agent instruction, Update, Modeling, Property selection, Regression, Subordinate ownership, DI registration & narrow config, Domain typing — discriminator over optional.
- **`lint`:** Feature flag (`node/no-process-env`, still `warn`), Module boundaries (scope/lane axis), File-level cycle gate (`import/no-cycle`), Lint correctness gate, Lint suspicious gate, Lint type-aware gate, Lint restriction cherry-picks, Domain typing — type-assertion gate, Code-unit cohesion L1+L2.
- **`CI` / `harness`:** Fixture sync, Testing, Lint scope coverage, Lint warning ledger, Type-checking strictness, Dependency version authorship, Module public-surface, CHANGELOG header-body pairing, Duplicate dependency copies, Catalog↔lockfile consistency, Nx inputs cover root config, Submodule pin reachability.

Two conventions attach to the index:

> **Canonical-statement rule.** Every rule and every principle has exactly one home. Other files may link to it by anchor, never restate the body. Restatement is drift.

and a mechanical naming convention: *"every rule heading ends in ` rule` (lowercase)"* — which makes the planned "lint that fails when a `## .* rule` heading is missing from the index" trivially implementable.

The `README.md` **Update rule**, verbatim:

> Every behavior, contract, architecture, theming, or toolchain change must update at least one of:
> - story-driven tests, when observable RefRepo behavior changes;
> - technical specs, when implementation mapping or operational behavior changes;
> - decision notes, when a meaningful technical choice is introduced or reversed;
> - drift notes marked `TODO NGH:`, when implementation intentionally differs from `RefRepo.Instructions`.
>
> If none of these are updated, the spec has drifted from the code and the next reimplementation will be wrong.

And from `maintenance.md`, the goal statement for drift: ***"The goal is not zero drift at all times. The goal is visible, intentional drift."***

### 6.3 `TODO NGH:` — the drift-marker protocol (verbatim)

> Each `TODO NGH:` note must name the canonical expectation, the current implementation, the impact/risk, and what would close the gap.

Used pervasively: in specs, in configs, in test files paired with every `skip`, and mechanically enforced for skips by `.harness/test-skip-pairing.test.mts`.

### 6.4 Ground-up implementation rule (verbatim, in full — this is *the* rule to port)

> ## Ground-up implementation rule
>
> A change is implemented the way it would have been designed if the requirement had existed from the start — never as a patch bolted onto the current shape. When the existing structure does not accommodate the new behavior cleanly, the structure is reworked first; the feature then lands as if it had always belonged.
>
> This rule is placed directly after the *Spec-first change workflow rule* because it is that rule's other half, and the half more often skipped: a change can be perfectly spec-first and still land as a patch. It is the implementation-time form of *Minimizing accidental complexity*: spec-first guarantees the **what** is designed before coding; this rule guarantees the **how** is designed rather than accreted. Patch-on-patch code is how a clean materialization of the spec degrades into one only its history can explain.
>
> - **Design from the requirement, not from the diff.** Start from "what shape would this code have if the feature were always here?" — not from "what is the smallest edit that makes the test pass?" If the two answers differ, the difference is the refactor that belongs in the same change (or an explicitly sequenced preparatory change).
> - **Restructure-then-add, as separate steps.** When the current shape resists the feature, first refactor the structure so the feature becomes a natural addition (behavior-preserving, proven by existing tests), then add the feature. Two clean commits beat one entangled one.
> - **A workaround is a decision, and decisions are recorded.** Sometimes a patch is the right call (hotfix, upstream bug, deadline). Then it is labelled: a `TODO NGH:` naming the clean shape, why it was deferred, and what closes it. An unlabelled workaround is drift.
> - **Symptoms that this rule is being broken:** a new boolean parameter that forks an existing function's behavior; a second slightly-different copy of an existing path; a guard clause that exempts one caller; a wrapper that exists only to avoid touching the thing it wraps; special-case handling that grows at call sites instead of moving into the owning unit.
> - **The reviewer test:** could a reader reconstruct why the code has this shape from the current requirement alone, without knowing the edit history? If the shape is only explainable by "it used to do X and then Y was added", it is a patch, not an implementation.
> - **Scope discipline still applies.** Ground-up does not mean rewrite-the-world: the redesign radius is the unit(s) whose contract the change touches (per the *Code-unit cohesion & clean boundaries rule*), not the subsystem around them.
>
> This rule does not apply to trivial requests (same scope cutoff as the *Feature request intake rule*).
>
> Drift mode: when you find load-bearing patch-on-patch structure, record it as a `TODO NGH:` in the relevant technical spec naming the clean shape; do not extend the patch chain to add the next feature.

### 6.5 Spec-first change workflow rule (verbatim)

> Spec edits precede code edits within the same change. …
>
> ```text
> 1. Intake interview      → decisions settled (see Feature request intake rule)
> 2. Spec edit             → contract written in the right home
>                             • functional behavior → RefRepo.Instructions
>                             • technical decisions, contracts, runtime → technical-specs/
> 3. Implementation        → spec is the brief; deviations bounce back to step 2
> 4. Tests / validation    → behavior-named, prove the spec (see Testing rule)
> 5. Reconcile             → spec adjusted only if implementation exposed genuine
>                             ambiguity in step 2 — never to match accidental code
> ```
>
> - **Spec edits sit before code edits in commit and PR order.** Reviewers see *what and why* before *how*.
> - **If you cannot write the spec section, you cannot write the code.** Vagueness in prose is the cheapest place to discover an under-specified decision; vagueness in code is the most expensive.
> - **Implementation that diverges from the spec is a signal, not a license.** When code wants to do something the spec doesn't authorize, stop and revise the spec — do not silently expand intent in the implementation.
> - **Drift inherits the same shape.** If the spec must temporarily lag the code, the spec edit that captures the lag is still ordered first: write the `TODO NGH:` note before merging the diverging code.

### 6.6 Feature request intake rule (verbatim, condensed to its bullets)

> - **Restate the functional intent first.** …
> - **Interview relentlessly until alignment is reached.** Use the `AskUserQuestion` tool. Do not start designing or implementing while material ambiguity remains. The cost of one more question is always lower than the cost of building the wrong thing.
> - **Walk the design tree branch-by-branch.** Identify the root decision, resolve it, then descend into the decisions it unblocks. Do not jump between unrelated branches; do not collapse a branch by guessing its parent.
> - **Recommend an answer for every question.** Each question must include the agent's recommended option and the reason. Asking without a recommendation pushes synthesis onto the user; recommending without asking removes their veto. Both are wrong.
> - **Batch related questions; serialize dependent ones.** …
> - **Stop when shared understanding is reached, not when patience runs out.** Exit the interview when (a) the functional intent is unambiguous, (b) the design-tree branches that affect this change are resolved, and (c) the user has signed off on the recommended path. Only then produce the task breakdown …
>
> This rule does not apply to trivial requests (typo fix, mechanical rename, single-file edit where intent is self-evident). It applies to anything that changes functional behavior, contracts, swimlane shape, or cross-cutting concerns.

### 6.7 Task breakdown rule (verbatim, in full)

> For implementation work, break the change into explicit tasks before executing. The task list must include validation tasks, and the **spec edits required by the *Spec-first change workflow rule* are the first tasks in the breakdown** — not follow-ups after code lands. When validation/test tasks pass, include a reconciliation task that re-reads the spec against the shipped code and adjusts only genuine ambiguities (per step 5 of the workflow shape).

### 6.8 No duplicate concepts rule (verbatim, bullets)

> A concept has exactly one representation in the codebase. The same real-world thing … is modeled once, in one home, with one schema. Other parts of the system reference that home; they do not re-encode it.
>
> - **One identity, many capabilities — not many identities.** … The test is whether it is genuinely the same thing …
> - **A capability belongs to one concept.** …
> - **Before adding a model, search for the concept.** A new schema/registry/service is only justified when the concept genuinely does not exist yet. If it exists under a different name or in a different layer, extend or bridge it — do not mirror it.
> - **Bridges over mirrors.** When two existing concepts turn out to be the same thing, write a bridge (one derives from or resolves to the other) rather than keeping both in sync by hand. Hand-synced duplicates are drift waiting to happen.
> - **A dead seam is still a duplicate.** A representation that exists but is unreachable … is the worst case: it looks authoritative, costs maintenance, and does nothing. Either wire it or delete it.
>
> Drift mode: when you find the same concept encoded twice, record it as a `TODO NGH:` … then bridge or collapse. Do not add a third encoding to paper over the first two.

### 6.9 Code-unit cohesion & clean boundaries rule (verbatim, in full — the L1/L2/L3 model)

> Code units are kept small by making them **cohesive and cleanly bounded**, not by capping their size. This is one principle seen at four radii:
>
> - **inside** — *cohesion*: the unit does one thing;
> - **shape** — *composed method / single level of abstraction (SLAP)*: a method body narrates its one thing as a sequence of well-named steps at a single abstraction level — it reads like the spec procedure (a swimlane `run` is the exemplar). Shared sub-logic lives in named units one level down, so composition is a **DAG of abstraction levels, not a forced linear chain** — reuse is *surfaced* as a named callable, never buried inline. Branching belongs only at the body's own level (guard clauses, route-by-status); inline computation/parsing/field-walking is a step wanting a name;
> - **boundary** — *clean, non-leaky abstraction*: a stable public surface with internals hidden; consumers depend on the interface, not the implementation;
> - **between** — *modular design*: loose coupling across units, high cohesion within.
>
> The target is a unit that does one thing, hides its internals behind a stable surface, and whose boundary the toolchain enforces — so a whole class of cross-unit coupling becomes *unrepresentable*, the way Rust's borrow checker makes aliasing-plus-mutation unrepresentable. **A leaky abstraction is precisely a unit reaching past another's public surface into its internals; the gate makes that a lint error.** …
>
> This is the operational form of *Minimizing accidental complexity*. A raw line/length cap is a lagging proxy: it fires after the complexity already arrived, and as a hard gate it forces bad splits that fragment a cohesive thing into helper-sprawl — raising cognitive load, not lowering it. So size is a *signal*, boundaries and branching are the *gate*, and semantic cohesion (which no linter can measure) is judged by an advisory reviewer.
>
> The **shape** radius reframes that size signal. A *long but flat* composed body — many well-named calls, low complexity, no nesting — is **good**; `max-lines-per-function` would wrongly flag it, so `complexity` / `max-depth` are the real *shape* sensors, not line count. This is the strongest spec-as-source lever: when a `run` body is a procedure of named steps, the code *is* the spec, transcribed … The counterweight to over-decomposition is the reviewer's **MERGE** verdict: a fragment that exists only to satisfy a split is folded back. SLAP says *extract a level*; MERGE says *don't fragment a thing* … A step-comment (`// Step 3: …`) is a step wanting a name.
>
> Three layers, one per radius …
>
> - **L1 — structural gates (hard, `error`).** Catch *cross-unit* coupling — one unit reaching into another's internals. …
> - **L2 — smell sensors (two tiers).** Catch *within-unit* responsibility creep. **Branching sensors** (cyclomatic complexity, nesting depth, async nesting) are hard (`error`): they measure the shape radius directly … so they gate. **Size sensors** (params, function/file length) stay soft (`warn`, never block): they prompt a human to split-or-keep and never force a split, because a legitimately large cohesive unit is real and a length cap would force the bad split **MERGE** exists to reverse. Both tiers are tuned to the codebase's measured distribution, with thresholds ratcheted down one notch per quarter (currently paused).
> - **L3 — cohesion reviewer (advisory).** Judge *semantic* cohesion the linters provably cannot — "is this one responsibility?" An LLM, grounded in the real dependency graph, recommends KEEP / PROMOTE / SPLIT / MERGE on changed units. **Never a hard gate**: LLM output is non-deterministic, and per *Determinism* + *Fail-fast* a flaky merge-blocker erodes trust. It comments; mechanical lint gates.
>
> The layers feed each other: L3 flags "this is a complete unit (PROMOTE)" → a human promotes it to a tagged lib with a public barrel → L1 locks the boundary forever. Soft semantic judgment graduates into a hard mechanical gate.
>
> - **Size never forces a change; boundaries and branching do.** A legitimately large but single-purpose unit (e.g. a canonical schema file) draws an L2 size warning the human keeps. What blocks is L1 boundary violations and the L2 branching tier — a unit may be long, it may not be tangled.
> - **Oxlint is the primary quality stack; ESLint carries only what Oxlint cannot express.** …
> - **A "complete unit" earns a lib.** Many small tagged libs is the Nx-preferred grain, not a smell. Extraction follows the dependency graph: leaf libs → lanes → agent runtime.

### 6.10 Other rules in `AGENTS.md` (summarized; each is a `## … rule` heading)

| Rule | Core statement |
|---|---|
| Technical specs rule | `technical-specs/` is a contract, not a notes folder — keep it reimplementation-complete; record the *why*, the alternatives, and the constraints. |
| Exploratory docs rule | Technical writing without a paired implementation goes to `_playground/wip/`, kebab-case, dated, one-line verdict; `_playground/` is not normative. |
| Learnings rule | `learnings/` = operational substrate knowledge; *"Spec records the **contract**; learnings record what we learned about the **substrate the contract runs on**. Both are necessary; mixing them rots both."* Prefer **annotation over deletion** — append `RESOLVED YYYY-MM-DD`; the history is the value. |
| Heuristic annotation provenance rule | *"Heuristic annotations ride rewrites: whoever rewrites or deletes annotated code must re-triage the annotation or consciously drop it. Census counts are point-in-time snapshots, not a maintained layer."* |
| Fixture sync rule | Mocks + high-impact behavior tests re-sync in the **same change** that alters their inputs. *"Drift in the fixture layer is not 'test maintenance' — it is a half-done change."* Includes: *"**`it.skip` is a `TODO NGH:`, not a punt.** … Skipped tests are debts, not solved problems."* |
| Minimal valid entrypoints rule | Every way to start the system is a `dev:*` script in `package.json`; minimal **and** complete (a fresh shell with no prior env can run it); shared config factored into **one committed env file** loaded with `--env-file`; **no work below the entrypoint layer** (no raw `tsx`/`node` with hand-crafted env); config validated by Zod at boot; *"Removal is a deletion, not a deprecation."* |
| Dev affordance isolation rule | Dev-only affordances must be physically absent from the prod bundle, not gated by a runtime `if`; never let client input switch real↔mock; default behavior is production behavior. |
| Feature flag rule | Flags start as env vars read once at boot and validated by the config schema; richer mechanisms need a recorded justification; *"It is convenient for developers" is not sufficient justification.* |
| Backend-authoritative logic rule | State/decisions/validation are server-owned. The test: *"would a second client (CLI, agent integration) need to re-derive the same answer to behave correctly? If yes, push it to the server."* |
| Testing rule | *"Tests should read like executable RefRepo documentation."* Behavior-story names (`SPARK captures a mortgage evidence signal, enriches it into an IdeaBrief, screens it, and recommends G0 pass`), never `creates object` / `returns array` / `works` / `should instantiate service`. Deterministic mock providers by default; LLM-backed tests opt-in. |
| Architectural decisions | Record significant choices (data structure, dependency, API contract, auth strategy, module boundary, DB schema, caching, error handling) before writing code. Do not record trivial ones. |
| Repository workflow | **All meaningful changes must update `CHANGELOG.md` in the same commit.** Commit message format is `yymmdd-hhmm: Your commit message` (local machine time). |

### 6.11 Agent-facing tooling inventory

**Agent config directories:** `.agents/` (canonical source), `.claude/`, `.codex/`, `.archon/`, `.entire/`, `.serena/` (empty), `.harness/intake/`. **No `.cursor/`, no `.github/`, no `.windsurf/`, no `CONTRIBUTING.md`.**

`.agents/agents/*.md` is the single source; `scripts/sync-agents-definition-to-tools.mjs` generates `.claude/agents/*.md` (Claude shape) and `.codex/agents/*.toml` (Codex shape), and `.harness/agents-sync.test.mts` fails the build if they drift.

**Subagents (2):**

| Name | Summary |
|---|---|
| `entire-search` (`tools: Bash`, `model: haiku`, `sandbox_mode: read-only`) | History-search specialist restricted to `entire search --json` only — never `rg`/`grep`/`git log`. Stops if the CLI is absent rather than falling back to ad hoc search. |
| `review-agent` (`tools: Bash, Read, Glob, Grep, Task`, `model: sonnet`) | Holistic pre-push reviewer. Fans rule checks out to fast-model subagents, attests every changed file against `technical-specs/rules-index.md` + `AGENTS.md`, checks spec-first alignment, emits a fixed-format `REVIEW AGENT REPORT` with VERDICT ∈ {CLEAN, ADVISORY, WARNING, BLOCKER}. |

**Slash command (1):** `/cohesion-review` (`model: sonnet`, `argument-hint: "[base ref, default: master] (or a path/glob to scope)"`, description: *"L3 advisory cohesion review of the current diff — grounded in the dep + DI graph. KEEP/PROMOTE/SPLIT/MERGE per unit. Never blocks."*). Its hard constraints, verbatim:

> - **Never edits code.** Output is a report — but a *loud* one (banner + `COHESION_STATUS`), not a silent FYI. It does not gate by itself; CI/the human decides what a non-CLEAN status means.
> - **Ground every coupling claim** in the nx-graph fan-in/out. No ungrounded "this feels coupled."
> - **PROMOTE feeds L1.** When you recommend PROMOTE, note that the follow-through is the lib-extraction (`technical-specs/20-code-unit-cohesion.md` extraction order) → tag → `@nx/enforce-module-boundaries` lock. You are finding the boundary, not drawing it.

Five steps: scope the diff → ground coupling in three layers (Nx project graph, static import fan-in/out, NestJS DI token resolution) → judge each unit → cross-check the L2 signal → emit report.

**Skills (4):**

| Skill | One-line summary |
|---|---|
| `copilot-cassette-record` (`.claude/skills/`) | Runbook for recording/refreshing live GitHub Copilot inference cassettes via the manual Azure pipeline or `pnpm cassette:record`; documents the progress-event sequence, failure taxonomy, and a completion checklist forbidding secret-shaped values in reports/diffs. |
| `refrepo-eval-run` (`.agents/skills/`, symlinked) | Drive and verify a lab eval run (Calcasa/Evidence benchmarks): clone a target repo at a feature-absent base, let RefRepo build the feature SPARK→PROOF, grade at raw G4. Hammers *verify against ground truth, never assume*. |
| `refrepo-setup` (`.agents/skills/`) | Pre-FORGE/PROOF setup checklist — ADO credentials from Azure variable libraries, lab-VM ground truth, registered dev entrypoints and env-file precedence, write-target preflight — so a journey doesn't die at development having burned LLM spend. |
| `targets-create-report` (`.agents/skills/`) | Build the 12-KPI, schema-validated RefRepo.Targets report for one journey via `scripts/build-targets-report.mts`; LLM judgment used only for four fidelity percentages; report committed through the Targets submodule. |

**Note:** `AGENTS.md` references a `machine-setup` skill at `.claude/skills/machine-setup/SKILL.md` — **that file does not exist**. Live doc drift.

**Archon workflows (`.archon/workflows/`):**

| Workflow | Stages / gates |
|---|---|
| `feature-intake.yaml` (265 lines) | The primary intake workflow (v3). States: `setup+doctor+pkg_check` (preflight) → `interview` (planning; self-skips when an intake package pre-exists) → `plan_gate` (**human approval** via `plannotator annotate --gate`, `on_reject` loop max 3) → `implement` → `validate` (`pnpm harness:check`) → `review` (**deliberately cross-provider** — Codex/gpt-5.5 reviewing Claude's work, for independence) → `snapshot` → `ship_gate` (**human approval** via `plannotator review --git`, injects the reviewer verdict, `on_reject` loop max 3) → `push` (`git push --dry-run` until manually flipped live). |
| `feature-intake-v2.yaml` (101 lines) | `check_deps` (fail-fast preflight) → `plan` (Opus, drafts `_playground/wip/v2-plan.md`, blocks on human annotation) → `deliver` (spec-first implementation + behavior-named tests, no commit) → `validate` (`pnpm harness:check`). |
| `cohesion-review.yaml` (145 lines) | Archon orchestration of the same L3 rubric: `read_rubric` (fresh-context spec read) → `scope_diff` → `ground_graph` → `review` (emits `COHESION_STATUS: CLEAN\|ISSUES(n)`). Isolation `git-worktree`. Advisory only. |
| `probe-approval.yaml`, `probe-artifacts.yaml`, `probe-when-loop.yaml` | Small probe workflows that verify Archon primitives themselves (approval-gate round-trip under non-TTY, `$ARTIFACTS_DIR` substitution across providers, `when:`-gated loop nodes + `trigger_rule: none_failed_min_one_success` joins). These encode hard-won engine lessons, e.g. *a gate must never be the first node*. |

`.archon/commands/refrepo-implement.md` — *"Execute an intake package's work packages, spec-first, one commit per package."* Rules: read `plan.md`'s "Context by role" pointers in order; **idempotent re-dispatch** (must fast-forward with zero duplicate commits); one git commit per work package, subject prefixed with a timestamp; **never edit specs** (spec drift becomes a `blocking` finding); behavior-named tests land with their work package.

**`agents/PROMPT_REVIEW_RULES.md`** — a 20-rule pass/fail checklist for every agent-prompt change, mechanically + LLM-enforced by `agents/.prompt-check/`. Reproduced in full because it is directly portable to any agent-prompt-authoring project:

> # Agent Prompt Review Rules
>
> Pass/fail checklist for every change to a prompt under `agents/`. A change passes only if every applicable rule does.
>
> ## 1. Single source of truth
> - **R1.** Every instruction appears exactly once — not restated across banner, schema comment, Rules, and Self-check.
> - **R2.** The output schema is expressed once: the JSON skeleton plus only the semantics a schema can't encode.
> - **R3.** No Self-check / "before returning" section that re-asserts rules already stated.
>
> ## 2. Don't compensate for missing implementation
> - **R4.** No constraint the tool grant or schema already enforces (a read-only agent needs no "do not write files").
> - **R5.** No pleading against model failure modes ("you MUST call the tool or it's a hallucination") — enforce in code.
> - **R6.** No orchestration/runtime harness — polling loops, timeout workarounds, install scripts belong to the runtime/tool layer.
> - **R7.** No hardcoded environment mechanics (ports, env vars, file paths, readiness curls) that break when infra changes.
> - **R8.** A field that is a deterministic function of other fields (`blocksG4 = severity ∈ {blocker,critical}`) is computed in code; the prompt asks only for the judgmental inputs.
>
> ## 3. Economy
> - **R9.** Every sentence changes model behavior. Cut restated obvious, pipeline trivia, and other agents' jobs.
> - **R9a — Concise.** Fewest words that convey the instruction. No filler, hedging, or restating the request back. Prefer a clause to a sentence.
> - **R9b — Hierarchy fit.** Only facts at this prompt's responsibility and altitude. If a fact isn't acted on here, it doesn't belong.
> - **R10.** No prescriptive command lists the model can derive (20 hardcoded `cat`s). Specify the goal; prescribe mechanics only where they can't be inferred.
> - **R11.** "Must not" rules are for things the model can do but shouldn't — not ungranted capabilities or duplicated positive rules.
>
> ## 4. Emphasis discipline
> - **R12.** Emphasis is scarce: caps/bold/"CRITICAL"/"MANDATORY" for at most one point per prompt, ideally zero. No emoji.
> - **R13.** No instruction repeated for emphasis.
>
> ## 5. Structure consistency
> - **R14.** Canonical section order and exact names: `Role → Mission → Inputs → Required output → Rules → Tools` (plus `Sequence` where relevant). No synonyms.
> - **R15.** Tool names match between prose and the **effective** grant. … A rendered prompt never names a tool the run does not grant.
> - **R15a.** Generic tool descriptions live in the tools folder. A prompt mentions a tool only for agent-specific guidance (when/why this agent uses it).
>
> ## 6. Scope
> - **R16.** Instruct only this agent's decisions; include cross-agent context only to the minimum needed.
> - **R16a — Reference by artifact, not name.** Refer to other agents by the their responsibility or artefact they produce, never by lane/agent name … Self-identifying this agent's own lane in `Role` is fine.
> - **R16b — Generalize; don't special-case.** Don't privilege one member of a general class without stated criteria — state the criteria or generalize to the category. Ad-hoc special-casing adds variance.
> - **R17.** Output semantics specify the judgment the schema can't …, not what the schema already constrains.
>
> ## 7. Artifact hygiene
> - **R18.** No experiment logs, cost notes, or A/B narratives in the file — those go in commit messages.
> - **R19.** `Model`, `TimeoutMs`, `Tools` are set for the agent's actual workload, not copy-pasted.
>
> ## 8. Determinism
> - **R20.** Make outputs deterministic where possible (fixed enums, derived flags, mechanical mappings), pushed to code or tightly constrained. Reserve model latitude for true judgment.
>
> ## Acting on a finding
> - A finding that says behavior belongs in code (R4–R8, R20) is resolved only when implemented there — deleting the text alone drops the behavior. Do both.
> - Don't delete text carrying real instruction unless genuinely redundant or handled elsewhere. A passing check isn't worth a regression.
> - When unsure whether a bit is safe to delete or needs a code home, ask the human.

**`agents/.prompt-check/`** — a two-stage gate over the 31 agent prompt YAMLs:
- **Stage 1** (`lint.mjs`, deterministic, always runs): section structure/order, naming, emphasis discipline, self-check sections, experiment notes, required config fields.
- **Stage 2** (`judge.mjs`, semantic, only when a CLI is present): conciseness, overexplanation, duplication, scope, compensating-for-implementation — via an auto-detected LLM judge (Claude Sonnet if `claude` is on PATH, else Codex's default, else skipped). Findings tagged `material`/`marginal`; **only reproducible `material` findings block** (consensus voting, `PROMPT_CHECK_VOTES`, default 2).
- `check.mjs` exits 2 on any Stage-1 finding or confirmed blocking Stage-2 finding.
- Its README claims wiring via a Claude Code `PostToolUse` hook on `Edit|Write|MultiEdit` **and** `.githooks/pre-commit` — **but the pre-commit hook explicitly says the commit-time prompt gate was removed, and no such PostToolUse matcher exists in `.claude/settings.json`.** Live drift; today it is effectively manual (`node agents/.prompt-check/check.mjs --file …`).

**`agents/AGENTS_TEMPLATE.yaml`** — the boilerplate every agent prompt is authored against: `Prompt:` literal block with exactly `## Role`, `## Mission`, `## Inputs`, `## Required output`, `## Rules` (optional `## Sequence`/`## Tools`); `Model:`/`Reasoning:`/`TimeoutMs:` blank (set per workload, R19); `Unrestricted: false` (**new agents are fail-closed** for filesystem/shell; `true` requires review + a mandatory `TODO NGH`); `Tools: []` explicit allowlist.

**`.claude/settings.json`** — hooks are all `entire` CLI session-logging (`PreToolUse`/`PostToolUse` on `Task`/`TodoWrite`, `SessionStart`/`SessionEnd`/`Stop`/`UserPromptSubmit`), each `sh -c` guarded on `command -v entire` so they no-op when absent. `permissions: { deny: ["Read(./.entire/metadata/**)"] }`. Enables the `sigrid@sigrid-ai-toolkit` plugin from a GitHub marketplace. **No rule-enforcing hooks.** `.codex/hooks.json` mirrors the same for Codex.

`learnings/README.md` defines the learnings-capture protocol — belongs: *"'I tried X, got Y, root cause was Z, fix was W.' Concrete cause → effect → fix chains"*, infra defaults that bit us, prompt tweaks that flipped agent behavior, empirical performance numbers, API/SDK surface discovered by reading source; does not belong: functional behavior, contracts/schemas/runtime, one-off PR notes, plans. Conventions: kebab-case subsystem-prefixed filename, `Date:` + one-line takeaway at top, one fact per short section. Maintenance: *"Stale learnings: prefer **annotation** over deletion — append a 'RESOLVED YYYY-MM-DD' note explaining what changed … The history is the value."*

---

## 7. PNPM WORKSPACE LAYOUT

The owner is considering adopting this layout, so this section is exhaustive and ends with a pnpm-vs-Bun equivalence table.

### 7.1 `pnpm-workspace.yaml` — structure

The file has five top-level keys, in this order: `packages`, `overrides`, `onlyBuiltDependencies`, `minimumReleaseAge`, `catalog`. There is **no `catalogs:` (named/multi-catalog) block** — only the single default `catalog:`.

**`packages` (verbatim):**

```yaml
packages:
  - "apps/*"
  - "libs/*"
  - "libs/shared/*"
  - "libs/swimlanes/*"
```

Note the deliberate shape: `libs/*` **and** two explicit second-level globs. `libs/shared` and `libs/swimlanes` are themselves matched by `libs/*` but contain no `package.json`, so pnpm ignores them as packages and picks up their children instead. This gives a two-tier layout — flat leaf libs at `libs/<name>` plus grouped families at `libs/<group>/<name>` — without a recursive `**` glob.

**`overrides` (verbatim, including the entire policy comment):**

```yaml
# `overrides` is for versions we do NOT declare. Anything a workspace manifest names belongs
# in `catalog:` below instead: it is authored next to its consumers and keeps its provenance
# in the lockfile's `catalogs:` section, which an override erases. Every entry here must name
# the transitive path it exists to reach. Five entries were deleted on 2026-09-01 after each
# was measured, individually, to change nothing.
overrides:
  # Reaches: nx -> axios. `nx` pins axios exactly (22.7.1 -> 1.15.0, 22.7.5 -> 1.16.0) and no
  # workspace manifest declares axios, so `catalog:` cannot reach it. Dropping this forks
  # axios into two copies below the floor and adds 31 advisories to `pnpm audit`.
  # (`catalog:` IS a valid override value in pnpm 10 — verified — but axios is not a workspace
  # dependency, so putting it in the catalog would misfile it for no dedup gain.)
  axios: "^1.19.0"
```

**Exactly one override survives**, and it names its transitive path. `.harness/catalog-coverage.test.mts` fails the build on any override entry lacking such a comment.

**`onlyBuiltDependencies` (verbatim):**

```yaml
onlyBuiltDependencies:
  - esbuild
  - "@nestjs/core"
  - nx
```

pnpm 10 denies postinstall/build scripts by default; this is the explicit allowlist. Three entries for a 28-package workspace.

**`minimumReleaseAge` (verbatim, with comment):**

```yaml
# Supply-chain back-off: no resolution may pick a version published less than 3 days ago
# (4320 minutes), so a compromised release has to survive a public window before it can reach
# a lockfile here. No `minimumReleaseAgeExclude` — nothing in this repo wants a same-day
# release. See technical-specs/11-toolchain.md § Dependency version policy.
minimumReleaseAge: 4320
```

Spec 11 adds: *"an unexplained exemption is a hole in the floor"* — hence zero `minimumReleaseAgeExclude` entries.

**`catalog` (verbatim header):**

```yaml
# One version, authored once. `catalog:` in any workspace manifest resolves here.
# Deliberate exceptions (version literals left in a manifest) are enumerated with their
# reasons in .harness/catalog-coverage.test.mts, which fails on any unrecorded literal.
# NOTE: `vite` and `vite-plus` must move together — `vite` is an alias for the same product
# (@voidzero-dev/vite-plus-core), and pnpm's alias syntax cannot reference a catalog entry,
# so the version is spelled twice. They are kept adjacent for exactly that reason.
catalog:
  "@azure/identity": "^4.13.2"
  ...
  "vite": "npm:@voidzero-dev/vite-plus-core@0.1.24"
  "vite-plus": "0.1.24"
  ...
  "zustand": "^5.0.15"
```

~90 entries, alphabetically sorted, one flat map. Note the documented limitation: **a catalog entry cannot be an alias target** — `npm:<pkg>@<version>` must spell the version literally, so aliased packages are pinned twice and kept adjacent with a comment saying so.

### 7.2 The version-authorship policy (spec 11 § *Dependency version policy*)

Four rules, in order, verbatim:

1. **"Manifests declare ranges, and the range lives in `catalog:`"** — one home per version.
2. **"The committed `pnpm-lock.yaml` decides what actually installs."** CI uses `--frozen-lockfile`.
3. **"Bumps are deliberate and reviewable."** No auto-bump bots on `master`; no floating specifiers resolved at install.
4. **"`minimumReleaseAge: 4320` (3 days) is a floor under all of the above."**

And the governing statement of *The catalog owns every version we declare* (decided 2026-09-01):

> A third-party version is authored **once**, in `catalog:`. `overrides` is only for versions no workspace manifest declares. A literal in a manifest is a recorded exception or a bug.

Rationale for preferring `catalog:` over `overrides`: it is authored next to consuming packages, it keeps provenance in the lockfile's `catalogs:` section (which an override erases), and it cannot silently reach packages you did not intend.

Two further rules:

- **No floating specifiers:** *"No catalog entry may use `latest`, `*` or `next`."* Such an entry resolves at install time and violates *Determinism*.
- **No duplicate dependency copies:** *"`pnpm dedupe --check` exits 0 on every PR; if it fails, the fix is `pnpm dedupe`, not an override, because an override erases provenance."* (Recorded incident: a `dompurify` double-resolution silently disabled a validator via a fail-open code path.)

**Pinning style is mixed and meaningful**, not accidental:

| Style | Used for | Examples |
|---|---|---|
| Caret `^x.y.z` | the default for ordinary deps | `zod ^4.5.4`, `react ^19.2.8`, `express ^5.2.1` |
| Tilde `~x.y.z` | the compiler, where a minor is a breaking event | `typescript ~7.0.2` |
| Exact | security pins, alias twins, and things whose minor churns | `@stryker-mutator/core 10.0.0`, `vite-plus 0.1.24`, `@vitest/coverage-v8 4.1.6`, `uuid 10.0.0`, `@types/uuid 10.0.0`, `@github/copilot-sdk 1.0.8`, `@azure/postgresql-auth 1.0.0-beta.1` |

Spec 11 documents the exact-pin practice for `vite-plus`: ***"`0.1.24` is the minimum patched version and stays inside the `0.1.x` line"*** — moved deliberately as a security decision, with a measured lint-diagnostic diff taken before and after the bump.

**Which deps go in the catalog** (spec 12, adopted 2026-08-27 *"after an audit found four already-drifted duplicates"*): *"shared by ≥2 packages → catalog. Single-consumer deps stay inline (a catalog entry nobody shares is indirection without dedup)."*

Four recorded off-catalog exceptions live in `.harness/catalog-coverage.test.mts` as `OFF_CATALOG_BY_DECISION`: `fast-check` in `refrepo-domain` (pinned `^4.9.0` while the catalog is on `^3.23.2`), plus the root-package `nx`, `@nx/js`, `@nx/eslint-plugin`, and `typescript` (the TS-6 alias).

### 7.3 Root `package.json`

```jsonc
{
  "name": "refrepo",
  "version": "0.0.0",
  "private": true,
  "scripts": { /* see below */ },
  "devDependencies": {
    "@nx/eslint-plugin": "^22.7.8",
    "@nx/js": "^22.7.8",
    "cross-env": "catalog:",
    "refrepo-domain": "workspace:*",
    "drizzle-orm": "catalog:",
    "eslint": "catalog:",
    "jsonc-eslint-parser": "catalog:",
    "nx": "^22.7.8",
    "pg": "catalog:",
    "typescript": "npm:@typescript/typescript6@~6.0.2",
    "typescript-eslint": "catalog:",
    "vite-plus": "catalog:"
  },
  "engines": { "node": ">=24" },
  "packageManager": "pnpm@10.22.0"
}
```

Points worth noting:

- **The root is a package too** (`private: true`, `version: 0.0.0`), and it has real devDependencies — but only **workspace-level tooling**: the two linters, the task runner, the TS-6 alias for `typescript-eslint`, and `vite-plus` for the root `lint:tooling`/`fmt` passes. Application libraries are never hoisted here.
- **The root itself uses `catalog:` and `workspace:*`.** `refrepo-domain: "workspace:*"` is a root devDependency purely so root-level `scripts/*.mts` can `import { SYSTEM_ACTOR_ID } from "refrepo-domain/schemas"`.
- `"packageManager": "pnpm@10.22.0"` is the corepack pin; CI activates it from this field rather than installing pnpm separately.
- `engines.node: ">=24"` is one of the four Node declaration sites (see §3.3).
- **`"prepare": "git config core.hooksPath .githooks || true"`** — the only lifecycle hook in the entire workspace, and it installs the hook path rather than building anything. Compare `.harness/test-script-shape.test.mts` rule 4, which **forbids** any `prepare`/`postinstall`/`preinstall`/`install` hook from compiling: spec 11 states *"Exactly one thing in this repository decides when `tsc` runs, and it is the nx task graph. No install hook, no `&&` inside a `test` script, no per-job shell step."*
- `.npmrc` is only three lines: `shamefully-hoist=false` (strict, isolated `node_modules` — the default and deliberately not relaxed), `strict-peer-dependencies=false`, `auto-install-peers=true`.

### 7.4 How root scripts fan out

Three distinct fan-out mechanisms, used for different reasons:

| Mechanism | Where used | Why |
|---|---|---|
| **`nx run-many -t <target>`** | `build:all`, `typecheck:all`, `lint:projects`, `test:unit` | the default — gives the task graph, `dependsOn` ordering, and caching |
| **`pnpm --filter … -r run`** | `test:coverage` only: `pnpm --workspace-concurrency=1 --filter './libs/**' --filter './apps/**' -r run --if-present test:coverage` | coverage must be serialized (`--workspace-concurrency=1`) and tolerate missing scripts (`--if-present`) — neither is an Nx idiom |
| **`pnpm --filter <pkg> run`** | `cassette:author`, `cassette:record`, `db:generate`, `test:unit:api` | single-package targeting |

The full root script surface:

```jsonc
"dev": "pnpm run dev:all",
"dev:all": "node scripts/run-dev-stack.mjs mocks",
"build": "pnpm run build:all",
"build:all": "nx run-many -t build",
"test": "pnpm run test:all",
"test:all": "nx run-many -t typecheck && pnpm run test:unit && pnpm run lint && pnpm run harness:check",
"test:unit": "nx run-many -t test && pnpm run test:scripts",
"test:unit:libs": "nx run-many -t test --exclude=refrepo-api --parallel=2 && pnpm run test:scripts",
"test:unit:api": "nx run refrepo-api:test",
"test:scripts": "node --test \"scripts/**/*.spec.mts\"",
"typecheck": "pnpm run typecheck:all",
"typecheck:all": "nx run-many -t typecheck",
"lint": "pnpm run lint:all",
"lint:all": "pnpm run lint:projects && pnpm run lint:tooling && pnpm run lint:boundaries",
"harness:check": "nx run-many -t build && pnpm run harness:check:all",
"harness:check:all": "node --test \".harness/**/*.test.mts\"",
"affected": "nx affected -t build,test,lint --base=master",
"fmt": "vp fmt apps libs scripts .harness/module-public-surface.test.mts --write",
"prepare": "git config core.hooksPath .githooks || true"
```

The convention (spec 11): root scripts are **thin wrappers over nx targets, so every entrypoint inherits the ordering guarantees**. The `<verb>` / `<verb>:all` pairing means a bare verb always means "everything".

### 7.5 How a per-package `package.json` declares deps

Two protocols, and essentially nothing else:

```jsonc
"dependencies": {
  "@refrepo/errors": "workspace:*",     // internal — always workspace:*, never a version
  "refrepo-domain": "workspace:*",
  "zod": "catalog:",                     // external — always catalog:, never a literal
  "@nestjs/common": "catalog:"
},
"devDependencies": {
  "@refrepo/test-kit": "workspace:*",    // test-support libs are devDeps by rule
  "@types/node": "catalog:",
  "typescript": "catalog:"
}
```

- **`workspace:*` for every internal dep**, always the `*` form — never `workspace:^` or a version. All packages are `private: true` and `version: "0.0.0"`, so there is no publish step for the protocol to resolve against.
- **`catalog:` for every external dep**, in both `dependencies` and `devDependencies`. A literal version is a bug unless recorded in `OFF_CATALOG_BY_DECISION`.
- **Test-support libs (`@refrepo/test-kit`, `@refrepo/lane-proof-harness`) are `devDependencies` only**, by rule. Nx's tag boundaries cannot express "dev-only" (they see import edges, not dependency *type*), so the actual fence is a file-level oxlint `no-restricted-imports` rule with a test-glob override.

**Canonical minimal lib** — `libs/shared/errors/package.json`, complete:

```jsonc
{
  "name": "@refrepo/errors",
  "version": "0.0.0",
  "private": true,
  "files": ["dist"],
  "type": "commonjs",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "clean:dist": "node -e \"require('node:fs').rmSync('dist',{recursive:true,force:true})\"",
    "build": "pnpm run clean:dist && tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "lint": "vp lint . -c ../../../.oxlintrc.json --type-aware"
  },
  "devDependencies": { "@types/node": "catalog:", "typescript": "catalog:" },
  "nx": { "tags": ["scope:shared", "layer:contract"] }
}
```

That is the entire file. Two source-of-truth fields carry all the architecture: `exports` (the public surface, harness-checked) and `nx.tags` (the boundary position, lint-checked).

**Per-package Nx overrides** go in the same `"nx"` key as `targets`, and the repo has a convention of attaching a `comment` field explaining *why* (see `apps/refrepo-studio/package.json`, which carries two multi-sentence `comment` fields justifying its `dependsOn` deviations). **No `project.json` file exists anywhere in the workspace.**

### 7.6 Lockfile

- `lockfileVersion: '9.0'`, single root `pnpm-lock.yaml` (613 KB), committed.
- Recorded settings block: `autoInstallPeers: true`, `excludeLinksFromLockfile: false` — mirroring `.npmrc`, so a change to `.npmrc` shows up as a lockfile diff.
- **`catalogs:` provenance section** — the reason the catalog is preferred over overrides. Every catalog entry appears as:

  ```yaml
  catalogs:
    default:
      effect:
        specifier: ^3.22.1
        version: 3.22.1
  ```

  i.e. the declared **range** and the resolved **version**, side by side. `.harness/catalog-lockfile-consistency.test.mts` asserts every `catalog:` specifier in `pnpm-workspace.yaml` matches `catalogs.default.<name>.specifier` here. (Incident that produced this test: `pnpm install --frozen-lockfile` installed cleanly against a lockfile whose `typescript` resolution did not match the catalog.)
- CI always installs with `--frozen-lockfile`, and caches the pnpm store with `Cache@2` keyed on `pnpm | "$(Agent.OS)" | pnpm-lock.yaml`.

### 7.7 How shared config is inherited

**Deliberately, none of it flows through pnpm.** Three different inheritance mechanisms, one per config type:

| Config | Mechanism | Notes |
|---|---|---|
| **tsconfig** | `"extends": "../../tsconfig.base.json"` (relative path, depth-dependent: `../../` for `libs/<name>`, `../../../` for `libs/<group>/<name>`) | Package declares only its delta: `target`, `module`, `moduleResolution`, `lib`, `jsx`, decorators, emit (`outDir`, `rootDir`, `declaration`), `types`, `include`. **May not redeclare any base-owned key** — harness-enforced. |
| **oxlint** | explicit `-c` flag in every package `lint` script: `vp lint . -c ../../../.oxlintrc.json --type-aware` | Not discovered by upward walking (except the studio's `vite.config.ts`, which relies on `vp lint` walking up). One root config, zero per-package configs. |
| **ESLint** | not inherited at all — one root `eslint.config.mjs`, invoked once from the root over an explicit path list | |
| **Nx targets** | `nx.json` `targetDefaults` merged with per-package `package.json` `"nx".targets` | |
| **Formatter** | no config — Oxfmt defaults via `vp fmt` | |

The rule that keeps tsconfig inheritance honest (spec 11): *"one base file owns compiler strictness; every package extends it and declares only its delta"*, mechanically enforced by `.harness/tsconfig-strictness.test.mts` against a table parsed live out of the spec markdown.

There is **no root `tsconfig.json`**, no `paths` map anywhere except the studio, and **no TypeScript project references / `composite`** — spec 12 lists "TypeScript Solution mode (`composite` + `references`)" as an explicitly **deferred, not adopted** candidate, alongside the `@nx/js:tsc` executor and Nx Cloud.

### 7.8 Scaffolding a new lib

**There is no generator.** `nx.json` has no `plugins` and no `generators` key; no `@nx/js:lib` invocation appears anywhere; no `plop`/`hygen`/custom scaffold script exists. A new lib is created by hand — but the shape is fully pinned by the harness tests, so the recipe is mechanical:

1. `mkdir -p libs/shared/<name>/src`
2. Write `package.json`: `name` (`@refrepo/<name>` for `libs/shared/*`, bare for the `libs/*` leaves), `version: "0.0.0"`, `private: true`, `files: ["dist"]`, `type`, `main`/`types`, and an `exports` map with a **single `.` entry** — additional subpaths require adding the package to `CURATED_SUBPATHS_ALLOWED` in `.harness/module-public-surface.test.mts` (*shape check*).
3. Add the four standard scripts: `clean:dist`, `build` (`pnpm run clean:dist && tsc -p tsconfig.json`), `typecheck`, `lint` (with the correct relative `-c` depth). Add `test` **iff** the package will have specs — and if it has specs and no `test` script, `.harness/test-script-shape.test.mts` fails.
4. Add `"nx": { "tags": ["scope:…", "layer:…"] }` — both axes. An untagged package silently escapes all boundary enforcement (see `refrepo-temporal-worker`, which is missing its layer tag).
5. Write `tsconfig.json` extending `tsconfig.base.json` at the right relative depth, declaring only the delta.
6. Write `src/index.ts` as a **curated barrel with named re-exports** — `export * from` fails the harness check unless the package is added to `BARREL_WILDCARD_ALLOWED`.
7. Declare deps as `workspace:*` / `catalog:`. Any new external version must be added to `catalog:` first, or `.harness/catalog-coverage.test.mts` fails.
8. `pnpm install` to link the workspace package, then `pnpm harness:check`.

The absence of a generator is arguably a gap — eight hand-steps guarded by six failing tests is a worse developer experience than one generator plus the same tests. But it does mean the *invariants*, not a template, are the source of truth.

### 7.9 pnpm ↔ Bun equivalence

| RefRepo pattern | Bun equivalent | Verdict for a single-package `kb` |
|---|---|---|
| `pnpm-workspace.yaml` `packages:` globs | `"workspaces": ["apps/*", "libs/*"]` in root `package.json` | ✅ supported; **N/A for a single package** |
| `catalog:` protocol | ✅ **Bun ≥1.2**: `"workspaces": { "packages": [...], "catalog": { "zod": "^4.5.4" } }`, consumed as `"zod": "catalog:"` | ✅ direct equivalent |
| Named `catalogs:` (multi-catalog) | ✅ Bun supports `"catalogs": { "testing": { … } }`, consumed as `"catalog:testing"` | ✅ — RefRepo doesn't use it anyway |
| `workspace:*` protocol | ✅ Bun supports `workspace:*`, `workspace:^`, `workspace:~` | ✅ |
| `packageManager: "pnpm@x"` + corepack | Bun ignores it; pin Bun via `.bun-version` / `"engines": {"bun": ">=1.2"}` / CI setup action | ⚠️ different mechanism |
| `minimumReleaseAge: 4320` | ✅ **`bunfig.toml` `[install] minimumReleaseAge = 4320`** (with `minimumReleaseAgeExcludes`) | ✅ **port this** |
| `onlyBuiltDependencies` allowlist | ✅ `bunfig.toml` `[install] trustedDependencies` (or `"trustedDependencies"` in `package.json`) — Bun also default-denies lifecycle scripts | ✅ direct equivalent |
| `overrides:` | ✅ `"overrides"` / `"resolutions"` in root `package.json` | ✅ |
| `.npmrc` (`shamefully-hoist`, `auto-install-peers`, `strict-peer-dependencies`) | ⚠️ partial — `bunfig.toml` has `[install] peer`, `linker = "isolated" \| "hoisted"`. `linker = "isolated"` is the `shamefully-hoist=false` analogue | ⚠️ different knobs, similar intent |
| `pnpm-lock.yaml` with a `catalogs:` provenance block | `bun.lock` (text, since 1.2) records catalog entries — but the **specifier/version provenance pair** is not laid out identically | ⚠️ the *consistency test* would need rewriting against `bun.lock`'s shape |
| `pnpm install --frozen-lockfile` | ✅ `bun install --frozen-lockfile` | ✅ |
| `pnpm dedupe --check` | ❌ **no Bun equivalent** — Bun's isolated installs dedupe differently and there is no `--check` mode | ❌ **pnpm-only**; drop `duplicate-dependency-copies.test.mts` |
| `pnpm --filter <glob> -r run --if-present <script>` | ⚠️ `bun run --filter '<glob>' <script>` exists; `--if-present` and `--workspace-concurrency` have no direct equivalent | ⚠️ partial |
| `nx run-many` / `targetDefaults` / task caching | ❌ nothing in Bun; `bun run --filter` has no task graph, no caching, no `dependsOn` | ❌ **N/A for a single package** — this whole layer disappears |
| `tsconfig` `extends` inheritance | ✅ plain TypeScript, package-manager-independent | ✅ (moot in one package) |
| Root `prepare` hook wiring `core.hooksPath` | ✅ Bun runs `prepare` on `bun install` | ✅ |

**Bottom line for `kb`:** four things port cleanly and are worth taking even without a workspace — `minimumReleaseAge`, `trustedDependencies`, `--frozen-lockfile` in CI, and the *policy* that a version is authored once with recorded exceptions (enforceable by a small harness test even in a single package). The catalog/`workspace:` protocols only start paying once there is more than one package; the Nx layer has no Bun counterpart at all. And `pnpm dedupe --check` — one of the more valuable harness tests — has no Bun equivalent.

### 7.10 Other runtime facts

- **No Docker for the app** — `docker/` holds only `sandbox.Dockerfile` + `build-sandbox.sh` (the agent sandbox image).
- **`portless.json`** = `{"name": "refrepo"}` — the `portless` dev proxy naming a local `*.refrepo.localhost` HTTPS origin for the `dev:online` entrypoints.
- **Three git submodules** under `.references/` (`RefRepo.Instructions`, `RefRepo.Diagrams`, `RefRepo.Targets`) on Azure DevOps, guarded by `.harness/submodule-reachability.test.mts`.
- **No syncpack** — the catalog plus three harness tests do syncpack's job natively.

### 7.11 Notable catalog pins

`typescript ~7.0.2` · `effect ^3.22.1` · `zod ^4.5.4` · `fast-check ^3.23.2` · `@stryker-mutator/core 10.0.0` · `vite-plus 0.1.24` + `vite: npm:@voidzero-dev/vite-plus-core@0.1.24` · `eslint ^9.39.5` · `typescript-eslint ^8.59.2` · `@vitest/coverage-v8 4.1.6` · `react ^19.2.8` · `@playwright/test ^1.62.1` · `nx ^22.7.8` (root literal, off-catalog by recorded exception).

---

## 8. OTHER TOOLING-ENFORCED RULES

| Mechanism | Present? | Notes |
|---|---|---|
| knip | ❌ | absent |
| ts-prune | ❌ | absent |
| dependency-cruiser / madge / ts-arch | ❌ | absent — the Nx graph rule + `import/no-cycle` cover the ground |
| publint / api-extractor | ❌ | absent (`.harness/module-public-surface.test.mts` covers the exports-shape half) |
| changesets | ❌ | absent — all packages are `private: true`, `version: 0.0.0` |
| commitlint / husky / lefthook / lint-staged | ❌ | absent |
| markdownlint / cspell / yamllint | ❌ | absent |
| Secret scanning | ❌ | no config; secret hygiene is prose + the cassette pipeline's completion checklist |
| License checks | ❌ | absent |
| Prettier / biome / dprint / .editorconfig | ❌ | absent — **Oxfmt via `vp fmt`** is the formatter |
| **Sigrid** (SIG code-quality/security/OSH platform) | ✅ | `sigridci.py --customer <customer> --system refrepo-application --source . --publishonly`, `master`-only, manual queue, publish-only (**not a gate**). No project-local config file. Also surfaced to agents as an MCP plugin (`sigrid@sigrid-ai-toolkit`). |
| **Stryker** | ✅ advisory | 8 configs, no thresholds, not in CI (§4.3) |
| **fast-check** | ✅ | 7 property suites; arbitraries centralized in `@refrepo/test-kit` (a `scope:test-support` lib fenced off from production by oxlint `no-restricted-imports`) |
| **Custom: heuristic detector** | ✅ | `scripts/detect-heuristics.mjs` — six shapes of silently-wrong ad-hoc logic, with AST-verified `--annotate` (§2.6). Not in CI. |
| **Custom: `.harness/` suite** | ✅ blocking | 17 repo-shape invariants, blocking in the `build_and_static` CI job and in `pnpm test` (§4.7) |
| **Custom: agent-prompt gate** | ⚠️ | `agents/.prompt-check/` two-stage gate — designed to be hook-wired, currently effectively manual (§6.11) |
| Disk-headroom assertion | ✅ | every CI job hard-fails below 6 GB free, warns below 15 GB — a real class of flaky-CI defense |

---

## 9. LOOSE SPOTS

Every rule that is `warn`/`off`/absent that a strict production config would set to `error`.

### 9.1 Oxlint rules at `warn` that should be `error`

| Rule | Current | Existing violations | Comment |
|---|---|---|---|
| `typescript/no-non-null-assertion` | warn | **369** | The single biggest debt. `!` defeats strict-null-checking exactly where it matters. For a greenfield `kb`, set to **error** on day one. |
| `node/no-process-env` | warn | **265** | RefRepo's own *Feature flag rule* says env is read once at boot and validated by a config schema — this rule is that rule's enforcement, and it is not enforcing. Set **error** with an override allowing only the config module. |
| `typescript/no-unsafe-type-assertion` | warn | (in ratchet) | With `--type-aware` on, this is the real teeth behind the type-assertion gate; the ESLint `no-restricted-syntax` double-cast ban exists only because this is `warn`. Promote to **error** and the ESLint config can shrink to one rule. |
| `typescript/no-base-to-string` | warn | — | Silent `[object Object]` in logs/messages. **error**. |
| `typescript/unbound-method` | warn | — | Real `this`-loss bug class. **error**. |
| `typescript/no-redundant-type-constituents` | warn | — | Cheap. **error**. |
| `typescript/no-deprecated` | warn (advisory lane, never gated) | 13 | Deliberately non-deterministic under `--type-aware`; keep advisory, but it *is* off the gate. |
| `promise/always-return`, `promise/catch-or-return` | warn | 11 / 4 | With `no-floating-promises` already `error`, promoting these is nearly free. |
| `no-shadow` | warn | 16 | **error**. |
| `oxc/no-map-spread` | warn | 15 | Perf. **error** or drop. |
| `react/exhaustive-deps` | warn | — | The classic stale-closure bug source. `kb`'s UI should run this at **error**. |
| `react/no-array-index-key` | warn | 9 | **error** in a list-heavy outliner UI. |
| `unicorn/consistent-function-scoping` | warn | 46 | Style; fine as warn. |
| `max-lines-per-function` (120), `max-params` (5), `max-lines` (900) | warn | 138 / 36 / 26 | **Deliberately soft** and well-argued (see §6.9). Keep soft — but keep the ratchet. |

### 9.2 Oxlint categories not enabled

Only `correctness` and `suspicious` are `error`. `pedantic`, `style`, `perf`, `restriction`, `nursery` are all off. A greenfield project should at least evaluate `pedantic` and `perf`.

### 9.3 TypeScript flags absent

`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `isolatedDeclarations`, `noImplicitReturns`, `noPropertyAccessFromIndexSignature` — **none set anywhere**. `verbatimModuleSyntax` and `erasableSyntaxOnly` exist only in the studio. For a greenfield Bun project with Effect, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are the two that materially change how types are written and are cheapest to adopt at line 1.

### 9.4 Boundary rules that are descriptive, not enforcing

- `layer:application` ↔ `layer:infrastructure` are mutually permissive — **dependency inversion is not enforced**, and the config says so verbatim (*"the current application/infra split remains descriptive until the mixed runtime libs are split"*).
- `refrepo-temporal-worker` carries `scope:app` but **no layer tag** — it is silently exempt from the entire layer axis.
- `apps/refrepo-studio/**` is ignored by ESLint entirely, so the double-cast ban does not reach the frontend (recorded as a residual).
- `enforceBuildableLibDependency: true` and `allow: []` are good; there are no per-file `allow` escapes.

### 9.5 Gates that exist but do not gate

| Thing | Status |
|---|---|
| The whole PR pipeline | **Does not auto-run on PRs.** Azure Repos ignores the YAML `pr:` trigger; the Build Validation Branch Policy on `master` was never created (needs `EditPolicies`). Runs are queued manually. |
| Cassette replay | Intentionally warn-only (`exit 0` + `task.logissue`) |
| Coverage | Reporter only; **no threshold anywhere** |
| Stryker mutation score | **No `thresholds` block in any of the 8 configs; `test:mutation` appears in zero pipeline files** |
| Sigrid | `--publishonly`, `master`-only, manual queue — publishes, never blocks |
| L3 cohesion review | Advisory by design; the CI advisory comment is still un-wired (needs headless LLM auth) |
| `agents/.prompt-check` | README claims a PostToolUse hook + pre-commit wiring; **neither exists** — pre-commit explicitly says the commit-time prompt gate was removed |
| Commit message format (`yymmdd-hhmm:`) | Prose only; no commitlint |
| `CHANGELOG.md` update per change | Prose only; only *structure* is checked, not presence-per-commit |
| Story-named tests | Prose only — `AGENTS.md` records this as an open `TODO NGH:` (*"No story-test gate."*) |
| Nearly every rule in `AGENTS.md` | `technical-specs/rules-index.md` records enforcement state per rule, and it is `prose` for nearly every row — stated verbatim in `AGENTS.md`'s "Current state" |
| `fmt:check` | Exists as a script, is **not** a CI step |
| pre-commit / pre-push hooks | Neither blocks anything |

### 9.6 Documentation drift found live

- `nx.json` `defaultBase: "main"` vs the `affected` script's `--base=master`.
- `AGENTS.md` references `.claude/skills/machine-setup/SKILL.md` — **does not exist**.
- `AGENTS.md` §L1 claims *"Intra-app lane fences are wired today via Oxlint `no-restricted-imports` (per-lane `overrides`)"* — the root `.oxlintrc.json` has only the flat two-package form, **no per-lane overrides**.
- `.harness/README.md` table lists 11 of 17 checks (self-flagged `TODO NGH:`).
- `agents/.prompt-check/README.md` documents two wiring points, neither of which exists.
- **The ratchet is documented under the wrong name.** `rules-index.md` / spec 20 describe it as `scripts/lint-warn-baseline.mts` run via `pnpm lint:ratchet`; the repo actually implements it as `.harness/lint-warn-ratchet.test.mts` + `pnpm harness:ratchet:snapshot`, run under `pnpm harness:check`. Same mechanism, stale names.
- **Warning counts in the specs are stale.** Spec 20 cites `node/no-process-env` at **208** findings; `lint-warn-baseline.json` records **265**. Similarly `no-unsafe-type-assertion` is cited as a "427-site backlog" in spec 16 but does not appear in the committed baseline at all.
- `AGENTS.md` § L2 says thresholds are *"ratcheted down one notch per quarter (currently paused)"* — the threshold ratchet is paused; only the count ratchet is live. Easy to misread as "the ratchet is off".
- **No lib generator exists** despite the eight-step manual scaffold (see §7.8) — every step is guarded by a failing test, but none is automated.

The repo is unusually honest about this — most of these are recorded as `TODO NGH:` in-place. That habit is itself the thing to port.

---

## 10. PORTABLE VS NOT

### 10.1 Port directly — high value, low cost, single-package-friendly

| Item | Why it transfers |
|---|---|
| **Lint-warn count ratchet** (`.harness/lint-warn-baseline.json` + `lint-warn-ratchet.test.mts`) | The single best idea here. It makes `warn` mean "may not grow" instead of "ignored". `kb` already has `warn`-tier rules; a ~60-line ratchet test converts them into a real gate without a mass-fix campaign. Note the refinement: **derive the measured scope by parsing the lint script string**, never restate it, so the ledger can't silently narrow. Also: two lanes (blocking + advisory) for rules that are non-deterministic. |
| **Lint-scope coverage test** | Proves every tracked source file is reached by exactly one linter invocation, that every declared scope is actually invoked, and that exclusions are stale-checked. Directly applicable to `kb`'s `npm run lint:all` / `vp check` split, which already has the "oxlint doesn't read `.oxlintrc.json`, so `vp check` misses rules" hazard. |
| **`.harness/` as a concept** | A directory of dependency-free `node --test` (for `kb`: `bun test`) files asserting *repo shape* rather than app behavior, run as part of the ordinary test command so nobody has to remember it. `kb` should have `tools/kb/harness/` or equivalent. |
| **`tsconfig-strictness.test.mts` pattern** | Parse the strictness-flag table **out of the spec markdown** and assert the tsconfig matches. Spec and config provably cannot drift. `kb`'s `DESIGN.md` could own that table. |
| **`test-skip-pairing.test.mts`** | Every `skip` must carry a paired debt marker within 3 lines, with an empty, stale-checked grandfather list. Trivially portable to `bun test` (`test.skip`, `describe.skip`, `it.skip`). |
| **`test-script-shape.test.mts` rules 2 & 4** | "every script a test script chains to exists" (caught 224 silently-skipped tests) and "no install/prepare hook compiles anything". Both are one-package-relevant. |
| **`no-conflict-markers.test.mts`** | 20 lines, catches a real class of disaster. |
| **`TODO NGH:` protocol** | A distinctive, greppable drift marker with a mandatory four-part body (canonical expectation / current implementation / impact / what closes it). `kb` should adopt a marker of its own with the same required shape. |
| **The canonical-statement rule** | A rule is stated in exactly one home; every other mention **links**, never restates. `.harness/README.md` says it verbatim: *"Checks **link** to their rule's canonical home; they never restate the rule."* This is the doc-level analogue of `kb`'s own "everything is a node" — highly compatible. |
| **`rules-index.md` with an explicit enforcement column** | Each rule row records home / scope / principle / **enforcement state (`prose` / `lint` / `CI` / `hook`)** / linked gate. Makes "we say we do this but nothing checks it" visible instead of comfortable. |
| **Ground-up implementation rule** (§6.4) | Verbatim-portable. Its **symptom list** and **reviewer test** are the operational parts, and they map almost exactly onto `kb`'s existing "Abstraction before addition" rule — porting the symptom list would sharpen it. |
| **No duplicate concepts rule** (§6.8) | Same — especially *"A dead seam is still a duplicate"* and *"Bridges over mirrors"*, which are precisely the failure modes an everything-is-a-node model invites. |
| **L1/L2/L3 cohesion model** (§6.9) | The *reasoning* is fully portable even where the tooling isn't: **branching sensors gate (`complexity`, `max-depth`, `max-nested-callbacks` at `error`), size sensors only warn**, and semantic cohesion is advisory-only because *"a flaky merge-blocker erodes trust"*. `kb` can adopt the exact thresholds (20 / 5 / 4 / 120 / 5 / 900) as a starting point. |
| **`/cohesion-review` command** | An advisory KEEP/PROMOTE/SPLIT/MERGE reviewer. `kb` can ground it in its own graph (it literally has a datalog store over its own structure — better grounding than an Nx graph). |
| **`PROMPT_REVIEW_RULES.md` (R1–R20)** | Directly reusable for any repo authoring agent prompts / skill files. R4–R8 ("don't compensate for missing implementation") and R20 ("push determinism into code") are the load-bearing ones. |
| **`learnings/` vs spec split** | *"Spec records the contract; learnings record what we learned about the substrate the contract runs on. Both are necessary; mixing them rots both."* Plus "annotate, don't delete — append `RESOLVED YYYY-MM-DD`". |
| **`scripts/detect-heuristics.mjs` idea** | The six shapes of silently-wrong ad-hoc logic (prose-scraping, magic thresholds, string-shape-as-validation, empty-means-permissive, hardcoded lookup tables, bare `exitCode === 0`) are a genuinely novel lint category. Shapes C and D in particular are common in an outliner's parsing/query paths. |
| **Stryker config shape** | `testRunner: "command"` + `coverageAnalysis: "off"` + narrow named `mutate` globs + `incremental: true` + **no thresholds** is the right pragmatic config, and the "advisory, never a gate" rationale is sound. `kb`'s mutate list should be its pure core (parser, query compiler, ref extraction), never I/O. |
| **Property-test placement convention** | `*.properties.spec.ts` as a distinct filename tier, arbitraries centralized in one test-support module, that module fenced off from production code by a lint rule. |
| **Catalog-style single-version authoring** | Even in a single package: keep the "a version is authored once, exceptions are enumerated in a test that fails on unrecorded literals" discipline. Bun ≥1.2 supports `catalog`/`catalogs` natively if `kb` ever splits into workspaces (§7.9). |
| **`minimumReleaseAge` + `trustedDependencies`** | Both have direct `bunfig.toml` equivalents (§7.9). Cheap supply-chain hardening; take them on day one. |
| **Property-test anti-pattern taxonomy** (§4.3a) | TAUTOLOGY / STRUCTURAL / quantifier theatre, plus the keeper classes and the "falsifiability runs from the rejecting side" note. Tool-agnostic, immediately usable in code review of any fast-check suite. |
| **Domain typing conventions** (§3.4) | No-optional-where-discriminated, literal discriminators, branded per-entity ids from one `mintBranded()`, "reference the canonical schema, never re-declare inline". An outliner whose nodes/fields/tags are all one polymorphic type is *exactly* the shape these rules were written for. Translate Zod → Effect `Schema`. |
| **The measured-rejection table** (§1.5a) | Not a rule but evidence: `strict-type-checked` at 26× cost for the same coverage, `knip` deferred at 33.6 s with false positives, `pedantic`/`style`/`restriction` rejected wholesale with counts. `kb` has knip and oxlint on its list — this is the closest thing to a controlled comparison available. |
| **"Categories cherry-picked, never adopted wholesale"** and **"Growth blocks, existing debt does not"** | Two one-line policies that between them determine whether a lint config is livable. |
| **Warn-only CI step shape** | `exit 0` + a machine-readable warning annotation, *never* `continueOnError` — because a "partially succeeded" result can still be refused by a branch policy, silently re-arming the block. |
| **Disk-headroom preflight in CI** | Hard-fail below a floor, warn below a ceiling. Kills a whole class of mystery flake. |

### 10.2 Adapt, don't copy

| Item | Adaptation |
|---|---|
| **Module boundaries** | `@nx/enforce-module-boundaries` is monorepo-only. In a single Bun package the equivalent is **oxlint `no-restricted-imports` with per-directory `overrides`** — `kb` already does exactly this (`src/foundation` is a leaf; `ui/` may reach the backend only through `@kb/*`). RefRepo's contribution is the **two-axis idea** (scope × layer as independent tags) and the honest documentation of where the axis stops being enforceable. `kb` could express `layer:domain → domain only` as a fence on `src/foundation`. |
| **Public-surface / barrel rule** | The *rule* ("one curated `.` barrel, named exports, no `export *`, no file-mirror subpaths") applies to `kb`'s `@kb/*` seam; the *test* would check the single package.json `exports` map + the seam module instead of 21 libs. |
| **Two-linter split with in-config justification** | `kb` already runs oxlint + `vp check`. Port the **discipline**: every rule in the secondary stack carries an in-file comment saying why the primary can't express it and what would let it move back. That comment is what keeps the secondary stack from quietly growing. |
| **Effect containment** | RefRepo's pattern (Effect inside one adapter, `runOrThrow` at the boundary, consumers never import `effect`) is the *opposite* of Effect-4-all-the-way. Port only the **error-taxonomy mapping** idea: a single `DomainError` type with a code enum that every foreign failure folds into at the seam. |
| **Zod contract discipline** | *"always parse with Zod at boundaries"* — for `kb` on Effect 4, that is `Schema` at every boundary (MCP tool input, WS message, file read, extension module load). The rule transfers verbatim; the library changes. |
| **`node --test` over compiled `dist/`** | RefRepo compiles then tests `dist/**/*.spec.js` and needs three harness rules to keep that safe (`clean:dist` in build, quoted globs, chained-script existence). **Bun runs TS directly — skip the whole problem class.** Keep only "every test script a test script chains to must exist". |
| **`test.dependsOn: ["build","^build"]`** | Nx-specific; irrelevant for Bun. |
| **Minimal valid entrypoints rule** | Very applicable in spirit — `kb` already has `kb ui`, `kb add`, `kb query`, `npm run verify`. Port: *every* way to run the thing is a named script, minimal-and-complete, no "you also need to set X first", and **removal is a deletion, not a deprecation**. |
| **Spec-first change workflow** | `kb` has `tools/kb/DESIGN.md`, `DESIGN-UI.md`, `DESIGN-REFINE.md` — the same two-layer split (functional spec / technical spec). Port the *ordering* rule ("spec edits sit before code edits in commit order"; "if you cannot write the spec section, you cannot write the code") and the reconcile step. |

### 10.3 Do not port — monorepo-only or RefRepo-specific

- Nx entirely: `nx.json`, `targetDefaults`, `namedInputs`, task caching, `run-many`/`affected`, `parallel`, `nx-inputs-cover-root-config.test.mts`.
- The tag taxonomy as *tags*, `@nx/eslint-plugin`, `enforceBuildableLibDependency`.
- pnpm workspace machinery as such (§7.9 has the full Bun equivalence table). Specifically **not** portable: `pnpm dedupe --check` and therefore `duplicate-dependency-copies.test.mts` (no Bun equivalent); `catalog-lockfile-consistency.test.mts` as written (Bun's `bun.lock` does not expose the same specifier/version provenance pair); `pnpm --filter … --workspace-concurrency`; `packageManager` + corepack. **Do** port `minimumReleaseAge`, `trustedDependencies`, `--frozen-lockfile`, and the version-authorship *policy*.
- The whole Azure DevOps pipeline set, `.azure/templates/`, `pipeline-copies-identical.test.mts`, the shard matrices, `PublishTestResults@2`.
- Sigrid (a commercial SIG platform requiring a customer contract).
- Submodules and `submodule-reachability.test.mts`.
- `portless.json`, `docker/sandbox.Dockerfile`, Temporal, PGlite, NestJS DI conventions (`@Inject(TOKEN)` against an interface), the multi-app dev-stack launchers.
- Everything RefRepo-domain: swimlanes, gates, `ProductJourney`, `ContentBlock[]`, cassettes, `factory-map.yaml`, `actor-attribution.test.mts`, `agent-policy-defaults.test.mts`, the eval/KPI skills, the Archon intake workflows.
- `agents-sync.test.mts` (only if `kb` ends up maintaining parallel `.claude`/`.codex` agent definitions — then it becomes portable).
- `DESIGN.md` (a UI design system, unrelated to engineering rules).
- `ARCHITECTURE.md` (stale generated artifact; its own header disclaims it).

### 10.4 Suggested minimum port for `kb`, in priority order

1. **Lint-warn ratchet** + a two-lane baseline file.
2. **Lint-scope coverage test** (closes the known `vp check` / oxlint gap).
3. A **`harness/`** directory of `bun test` repo-shape checks; wire it into `npm run verify`.
4. **`tsconfig` strictness contract** parsed from `DESIGN.md`, and while you're there set `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`.
5. **Skip-pairing** + a `TODO NGH:`-style marker protocol with a mandatory four-part body.
6. **Rules index with an enforcement column**, and the canonical-statement rule.
7. The **Ground-up implementation rule** and **No duplicate concepts rule**, verbatim, into `CLAUDE.md`/`DESIGN.md`.
8. **L2 tier split**: branching sensors at `error`, size sensors at `warn`-with-ratchet.
9. Promote the §9.1 rules to `error` (greenfield — no campaign needed).
10. **Stryker** on the pure core only, no thresholds, advisory; **fast-check** arbitraries in one fenced module.
