# Effect ecosystem agent-guidance / lint / tooling recon

Date: 2026-09-03. Target: `/Users/popemkt/.dotfiles/tools/kb` (Bun + TS 7, `effect` 4.0.0-beta.106, `@effect/platform-bun` 4.0.0-beta.106).

---

## 0. Headline findings

1. **The single most important artifact is already on disk and unused.** `tools/kb/node_modules/effect/AGENTS.md` (and an identical `CLAUDE.md`) ships inside the `effect` package — 380 lines of official v4 idiom. `@effect/platform-bun` ships a byte-identical copy. Nothing in this repo points agents at it.
2. **Effect publishes an official skills repo**: [`Effect-TS/skills`](https://github.com/Effect-TS/skills) (MIT), containing `effect-ts` and `effect-v3-to-v4`. The `effect-ts` skill's entire job is "install effect, then add a pointer to `node_modules/effect/AGENTS.md` in your AGENTS.md/CLAUDE.md".
3. **The lint story moved off ESLint onto oxlint** — which this repo already runs. Effect's own monorepo has no eslint config; it uses `.oxlintrc.json` with a `jsPlugins: ["@effect/oxc/oxlint"]` entry. `@effect/eslint-plugin` is a 2-rule vestige.
4. **TypeScript 7 changes the plugin answer.** `@effect/language-service` is the TS 5.x tsserver plugin; for TS 7 / tsgo the supported package is **`@effect/tsgo`**. This repo is on `typescript@7.0.2`, so `@effect/language-service` alone is the wrong pick.
5. **The pinned version is stale.** `effect` dist-tags: `latest` = `3.22.1`, `beta` = `4.0.0-beta.107`, **`rc` = `4.0.0-rc.112`**. This repo sits on `4.0.0-beta.106` (2026-08-08); RC line started `rc.108` (2026-08-12), current `rc.112` (2026-08-25).

---

## 1. Official Effect agent guidance

### 1.1 `node_modules/effect/AGENTS.md` — the canonical guide (ALREADY LOCAL)

Source of truth: [`LLMS.md`](https://github.com/Effect-TS/effect/blob/main/LLMS.md) in the monorepo, published into every `effect` and `@effect/*` tarball as both `AGENTS.md` and `CLAUDE.md`.

Verified locally:
- `tools/kb/node_modules/effect/AGENTS.md` — 380 lines, 16 KB
- `tools/kb/node_modules/effect/CLAUDE.md` — byte-identical (`diff` clean)
- `tools/kb/node_modules/@effect/platform-bun/{AGENTS,CLAUDE}.md` — byte-identical to the above

Section outline (v4 idiom, matches the installed beta.106):

```
Writing `Effect` code  →  Using Effect.gen / Using Effect.fn
Defining schemas and domain models
Writing Effect services  →  Context.Service
Error handling  →  Error handling basics
Managing resources and `Scope`s
Running Effect programs
Broadcasting messages with PubSub
Working with Streams
Integrating Effect into existing applications
Batching external requests
Working with Schedules
Working with DateTime
Observability
Testing Effect programs
Runtime type guards  →  Using the Predicate module
Effect HttpClient
Building HttpApi servers
Working with child processes
Building CLI applications
Working with AI modules
Building distributed applications with cluster
```

Load-bearing v4 conventions it mandates (all differ from v3 muscle memory):

- `Effect.gen` for inline code; `Effect.fn("name")` for reusable functions that need a span; `Effect.fnUntraced` for hot paths / library internals. **"Avoid creating functions that only wrap and return an `Effect.gen`."**
- Errors are `Schema.TaggedError`, not `Data.TaggedError`:
  ```ts
  export class FileProcessingError extends Schema.TaggedError<FileProcessingError>()("FileProcessingError", {
    message: Schema.String
  }) {}
  ```
- Services are `Context.Service` classes (not `Context.Tag`, not v3 `Effect.Service`):
  ```ts
  export class Database extends Context.Service<Database, { ... }>()(...) {}
  export type DatabaseService = Database["Service"]
  ```
- `Effect.catch` (not `Effect.catchAll`) — v4 renamed the `catch*` family.
- `Schema` is imported from `"effect"` core, not `@effect/schema`.
- Always `return yield*` when raising, so TS narrows control flow.

Upstream `LLMS.md` is slightly ahead of beta.106's snapshot (it adds the `Effect.fnUntraced` guidance under a merged "Using Effect.fn and Effect.fnUntraced" heading).

### 1.2 `Effect-TS/skills` — the official skills repo

<https://github.com/Effect-TS/skills> — MIT, layout `skills/<name>/SKILL.md`.

Install: `npx skills add Effect-TS/skills` (the `skills` CLI, npm `skills@1.5.23`, "The open agent skills ecosystem").

**`skills/effect-ts/SKILL.md`** (full frontmatter + body, verbatim):

```md
---
name: effect-ts
description: Use this skill when setting up a repository that uses the Effect Typescript library.
---

# Step 1: Install effect
... pnpm add effect@rc  (or `pnpm add -D effect@rc` in a monorepo, so you can
    access the source code from `node_modules/effect/src`)

# Step 2: Update AGENTS.md / CLAUDE.md
Ensure that the agent instructions contain the following:

  # Learning more about Effect
  This repository uses the Effect Typescript library.
  Before writing any Effect code, first read `node_modules/effect/AGENTS.md`
  **completely**, and follow the links in the file when required.
  If you need to learn more about particular Effect apis and concepts that the
  guide doesn't cover, search through the source code in `node_modules/effect/src`.
```

Note it says `effect@rc`, i.e. upstream now steers new projects at the RC line, not `beta`.

**`skills/effect-v3-to-v4/SKILL.md`** — `disable-model-invocation: true` (explicit invoke only). It drives migration from two shallow clones (`.repos/effect` on `main`, `.repos/effect-v3` on `v3`), reads `MIGRATION.md`, then greps `migration/v3-to-v4.md` per symbol. Its loudest rule: **never read `migration/v3-to-v4.md` whole — it is ~16,000 lines / ~350k tokens.** Also warns that a pre-existing `.repos/effect` may be a stale clone of the archived `Effect-TS/effect-smol` and must be validated (`git remote get-url origin`, `packages/effect/package.json` version must be `4.x`). Not relevant here — kb was born on v4.

### 1.3 Effect monorepo's own agent surface

<https://github.com/Effect-TS/effect> root contains: `.agents/`, `LLMS.md`, `MIGRATION.md`, `ai-docs/`, `migration/`, `.oxlintrc.json`, `dprint.json`.

- **No `.claude/` directory** (`/contents/.claude` → 404). No `.cursor/rules`.
- `.agents/AGENTS.md` + `.agents/skills/` with 12 skills: `ai-docs`, `bundle-analysis`, `changesets`, `ci-maintenance`, `dependency-maintenance`, `effect-development`, `jsdocs`, `migration-guidance`, `package-development`, `performance-analysis`, `test-development`, `vendored-assets`. These are **contributor skills for developing Effect itself** — not consumer guidance. Do not import them.

### 1.4 `llms.txt`

- `effect.website/llms.txt`, `/llms-full.txt`, `/docs/llms.txt`, `/docs/v4/llms.txt` → **all 404**. Effect does not publish llms.txt; `LLMS.md` in the repo (= the shipped `AGENTS.md`) is the equivalent.
- `effect.solutions/llms.txt` → 200, but it is only a 382-byte access policy:
  ```
  # Effect Solutions LLM Access Policy
  Version: 2025-11-19
  Preferred-Interface: CLI=bunx effect-solutions@latest list|show
  Use-Case: Reference Effect TypeScript best-practice summaries only; do not copy full docs into public corpora.
  Source-Repository: https://github.com/kitlangton/effect-best-practices
  ```
  `effect.solutions/llms-full.txt` → 404.

### 1.5 `effect-solutions` CLI (community, Kit Langton — v4-targeted)

npm `effect-solutions@0.5.3`, "Docs + helper CLI for Effect TypeScript best practices". Repo: <https://github.com/kitlangton/effect-best-practices>. Site: <https://www.effect.solutions>. Peer-dep warning on run declares `effect@4.0.0-beta.59`, so it is **v4-oriented**, though trailing the current RC.

`bunx effect-solutions@latest list` → 10 topics:

| id | title |
|---|---|
| `quick-start` | Quick Start |
| `project-setup` | Install the Effect Language Service and strict project defaults |
| `tsconfig` | Recommended TypeScript compiler settings tuned for Effect |
| `basics` | Coding conventions for `Effect.fn` and `Effect.gen` |
| `services-and-layers` | `Context.Service` and Layer patterns for DI |
| `data-modeling` | Records, variants, brands, pattern matching, JSON serialization |
| `error-handling` | `Schema.TaggedError` modeling, pattern matching, defects |
| `config` | Effect Config usage, providers, layer patterns |
| `testing` | Testing Effect code with `@effect/vitest` |
| `cli` | Effect CLI module: commands, arguments, flags, service integration |

`show <id>` prints markdown. Its `project-setup` still recommends `@effect/language-service` + `bunx effect-language-service patch` — **stale for TS 7**; the official docs now route TS 7 users to `@effect/tsgo`. Its `tsconfig` topic recommends `module: NodeNext`, `exactOptionalPropertyTypes`, `noUnusedLocals`, `incremental`/`composite` — several of which conflict with kb's deliberate bundler-mode Bun setup. Treat as reference reading, not a config to adopt.

### 1.6 `effect-mcp` (community docs MCP)

Canonical: <https://github.com/tim-smart/effect-mcp> (Tim Smart is an Effect core maintainer, but the repo is personal, not under `Effect-TS/`). npm `effect-mcp@0.1.16`. Tools: `effect_docs_search`, `get_effect_doc`. Install for Claude Code:

```bash
claude mcp add-json effect-docs '{
  "command": "npx",
  "args": ["-y", "effect-mcp@latest"],
  "env": {}
}' -s user
```

Also `docker run --rm -i timsmart/effect-mcp`. **v4 coverage is unstated** — the README does not claim v4 docs, and effect.website's v4 docs are still being rewritten. Forks exist (`niklaserik/effect-mcp`, `ghardin1314/effect-mcp`). Low confidence for a v4 codebase; `node_modules/effect/src` grep is strictly more accurate.

---

## 2. Lint / language-service tooling

### 2.1 `@effect/language-service` — TS 5.x plugin (NOT for this repo)

<https://github.com/Effect-TS/language-service>, npm `0.87.2`. README states plainly: **"For TypeScript 7.0+, use `@effect/tsgo` instead."**

Config shape (carried over identically by tsgo — the plugin name string stays `@effect/language-service`):

```json
{
  "$schema": "./node_modules/@effect/language-service/schema.json",
  "compilerOptions": {
    "plugins": [
      {
        "name": "@effect/language-service",
        "diagnosticSeverity": {
          "floatingEffect": "warning",
          "missingEffectError": "error"
        }
      }
    ]
  }
}
```

Per-file overrides via comments: `// @effect-diagnostics effect/floatingEffect:off`, wildcard `// @effect-diagnostics *:off`.

Build-time (not editor-only) diagnostics require patching the local TypeScript install: `effect-language-service patch`, persisted via `"prepare": "effect-language-service patch"`.

**Full diagnostic list (v4-supported).** Any of these can be set to `"error"` / `"warning"` / `"off"` in `diagnosticSeverity`.

*Correctness*
`anyUnknownInErrorContext`, `classSelfMismatch`, `duplicatePackage`, `effectFnImplicitAny`, `floatingEffect`, `genericEffectServices`, `missingEffectContext`, `missingEffectError`, `missingLayerContext`, `missingReturnYieldStar`, `missingStarInYieldEffectGen`, `nonObjectEffectServiceType`, `outdatedApi`, `outdatedEffectCodegen`, `overriddenSchemaConstructor`, `unsupportedServiceAccessors`

*Anti-patterns*
`catchUnfailableEffect`, `effectFnIife`, `effectGenUsesAdapter`, `effectInFailure`, `effectInVoidSuccess`, `globalErrorInEffectCatch`, `globalErrorInEffectFailure`, `layerMergeAllWithDependencies`, `lazyPromiseInEffectSync`, `leakingRequirements`, `multipleEffectProvide`, `returnEffectInGen`, `runEffectInsideEffect`, `schemaSyncInEffect`, `scopeInLayerEffect`, `strictEffectProvide`, `tryCatchInEffectGen`, `unknownInEffectCatch`

*Effect-native preferences*
`asyncFunction`, `cryptoRandomUUID`, `cryptoRandomUUIDInEffect`, `extendsNativeError`, `globalConsole`, `globalConsoleInEffect`, `globalDate`, `globalDateInEffect`, `globalFetch`, `globalFetchInEffect`, `globalRandom`, `globalRandomInEffect`, `globalTimers`, `globalTimersInEffect`, `instanceOfSchema`, `newPromise`, `nodeBuiltinImport`, `preferSchemaOverJson`, `processEnv`, `processEnvInEffect`, `unsafeEffectTypeAssertion`

*Style & consistency*
`catchAllToMapError`, `deterministicKeys`, `effectDoNotation`, `effectFnOpportunity`, `effectMapFlatten`, `effectMapVoid`, `effectSucceedWithVoid`, `flatMapToMap`, `importFromBarrel`, `missedPipeableOpportunity`, `missingEffectServiceDependency`, `nestedEffectGenYield`, `redundantSchemaTagIdentifier`, `schemaStructWithTag`, `schemaUnionOfLiterals`, `serviceNotAsClass`, `strictBooleanExpressions`, `unnecessaryArrowBlock`, `unnecessaryEffectGen`, `unnecessaryFailYieldableError`, `unnecessaryPipe`, `unnecessaryPipeChain`

Also ships refactors (async fn → `Effect.gen`/`Effect.fn`, service accessor impl, calls → pipe, layer auto-composition, TS type → Schema) and codegens (`@effect-codegens annotate` / `accessors` / `typeToSchema`).

### 2.2 `@effect/tsgo` — the TS 7 answer (CORRECT PICK HERE)

<https://github.com/Effect-TS/tsgo>, npm `@effect/tsgo@0.40.0`: *"Effect Language Service for TypeScript-Go — Effect-specific diagnostics and hover features."* It is a **superset of typescript-go**: full tsgo behavior plus the entire diagnostic set above, quick fixes, refactors.

Official install path ([Effect v4 devtools docs](https://www.effect.website/docs/v4/getting-started/devtools)):

```bash
npx @effect/tsgo setup      # interactive wizard: picks tsconfig, adds dep, writes plugin entry
# or manually:
npm install @effect/tsgo --save-dev
```

Resulting tsconfig entry (from the quickstart — note the plugin `name` is still `@effect/language-service`):

```jsonc
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "@effect/language-service",
        "diagnosticSeverity": {},
        "includeSuggestionsInTsc": true,
        "ignoreEffectSuggestionsInTscExitCode": true
      }
    ]
  }
}
```

Editor binary sync: `npx @effect/tsgo patch`. Interactive rule tuning: `npx @effect/tsgo config`. Standalone CLI check: `npx @effect/tsgo diagnostics --project tsconfig.json`.

**Oxlint integration (this is the one that fits kb).** From the devtools page:

```bash
npm install @effect/tsgo oxlint oxlint-tsgolint --save-dev
```
```json
{ "scripts": { "prepare": "effect-tsgo patch --oxlint" } }
```

kb already has `oxlint` + `oxlint-tsgolint` (`node_modules/.bin/tsgolint` present) and `vite-plus` 0.2.8. The devtools page lists **Vite Plus** as a first-class integration path with the same `prepare` script.

Also: **VS Code / Cursor extension `effectful-tech.effect-vscode`** — runtime debugger (context inspection, span stacks, fiber management, "pause on defect"). Editor-only, not a repo artifact.

### 2.3 `@effect/eslint-plugin` — legacy, 2 rules, do not adopt

<https://github.com/Effect-TS/eslint-plugin>, npm `0.3.2`, description "A set of ESlint and TypeScript rules to work with Effect". Last commit **2025-11-26**. `src/rules/` contains exactly two files:

- `dprint.ts` — runs dprint as an ESLint formatting rule
- `no-import-from-barrel-package.ts`

There is **no `eslint-plugin-effect` on npm** (404). Effect's own monorepo has **no eslint config at all** — it lints with oxlint.

### 2.4 Effect's actual lint config — oxlint + `@effect/oxc`

Root [`.oxlintrc.json`](https://github.com/Effect-TS/effect/blob/main/.oxlintrc.json) extends `./packages/tools/oxc/oxlintrc.json` and declares:

```json
"jsPlugins": ["@effect/oxc/oxlint"]
```

`@effect/oxc` is **not published to npm** (registry 404) — it is an internal workspace package. So the four custom rules below cannot currently be consumed externally; they are listed for reference / possible reimplementation.

The shared ruleset (`packages/tools/oxc/oxlintrc.json`), enumerated:

```jsonc
{
  "plugins": ["typescript", "import", "oxc", "eslint", "unicorn", "node"],
  "categories": { "correctness": "error", "suspicious": "error", "perf": "error" },
  "rules": {
    // Effect custom rules (from @effect/oxc — unpublished)
    "effect/no-bigint-literals": "error",
    "effect/no-import-from-barrel-package": ["error", {
      "checkPatterns": [
        "^effect$",
        "^effect/(.+/)?[a-z][a-z0-9]*$",
        "^@effect/[^/]+$",
        "^@effect/[^/]+/(.+/)?[a-z][a-z0-9]*$"
      ],
      "checkRelativeIndexImports": true
    }],
    "effect/no-js-extension-imports": "error",
    "effect/no-opaque-instance-fields": "error",
    "effect/no-unused-internal": "error",

    // Imports
    "typescript/consistent-type-imports": ["error", { "fixStyle": "inline-type-imports" }],
    "typescript/no-import-type-side-effects": "error",
    "import/no-duplicates": "error",
    "import/no-self-import": "error",
    "import/no-empty-named-blocks": "error",

    // TS cleanup
    "typescript/no-unnecessary-type-assertion": "error",
    "typescript/no-unnecessary-type-constraint": "error",
    "typescript/no-useless-empty-export": "error",

    // Code quality
    "eslint/no-console": "error",
    "eslint/no-var": "error",
    "eslint/no-useless-constructor": "error",
    "unicorn/no-abusive-eslint-disable": "error",
    "eslint/no-unneeded-ternary": "error",
    "eslint/no-useless-concat": "error",
    "oxc/misrefactored-assign-op": "error",
    "unicorn/prefer-array-flat-map": "error",
    "unicorn/no-accessor-recursion": "error",

    "typescript/array-type": ["error", { "default": "generic", "readonly": "generic" }],
    "typescript/no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],

    // Deliberately off (library-authoring concessions)
    "typescript/no-explicit-any": "off",
    "typescript/ban-ts-comment": "off",
    "typescript/no-namespace": "off",
    "typescript/no-non-null-assertion": "off",
    "eslint/no-shadow": "off",
    "eslint/no-unused-vars": "off",
    "eslint/require-yield": "off"
    // ...plus ~15 more unicorn/typescript rules off
  }
}
```

Test/example/scratchpad override turns off `effect/no-bigint-literals`, `eslint/no-console`, `effect/no-import-from-barrel-package`.

Formatting: `dprint.json` at repo root — Effect formats with **dprint**, not Prettier. kb formats with `vp fmt`; adopting dprint would be a fork of an existing mechanism, not worth it.

Interesting conflict: Effect's own repo sets `typescript/no-explicit-any` and `typescript/ban-ts-comment` to `off` (they're a library author). kb's `.oxlintrc.json` sets both on. **kb's stance is correct for an application; do not copy Effect's offs.**

Note: `effect/no-import-from-barrel-package` is the same concept as the `importFromBarrel` diagnostic in the language service — meaning **tsgo already covers it**, no plugin needed.

---

## 3. Effect 4 status (2026-09-03)

### 3.1 Versions

`npm view effect dist-tags`:

```
latest:   3.22.1          ← v3 is still `latest`
beta:     4.0.0-beta.107
rc:       4.0.0-rc.112
snapshot: 0.0.0-snapshot-6ebc752…
```

`@effect/platform-bun` dist-tags: `latest: 0.91.2` (v3 line), `beta: 4.0.0-beta.107`, `rc: 4.0.0-rc.112`. `@effect/vitest`: same shape.

Release dates: `4.0.0-beta.106` = 2026-08-08 · `4.0.0-rc.108` = 2026-08-12 · `4.0.0-rc.112` = 2026-08-25.

**4.0 is NOT stable.** RC announced 2026-08-12 ([blog: "We think this is it …"](https://www.effect.website/blog/releases/effect/40-rc)), version `4.0.0-rc.108`, **target stable Q3/Q4 2026**. Upstream position: *"we have no more broad breaking changes planned"*, interfaces *"presumed final"*. Many community projects have run v4 in production since the beta.

**kb is on `4.0.0-beta.106`, one release before the RC cut.** Moving to `rc.112` is a small, low-risk hop within the presumed-final window and puts the repo on the tag the official skill recommends (`effect@rc`).

### 3.2 Structural changes 3 → 4

From [`MIGRATION.md`](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md) and [`migration/v3-to-v4.md`](https://github.com/Effect-TS/effect/blob/main/migration/v3-to-v4.md):

- **Single version across the ecosystem.** All Effect packages release together on one version number.
- **Packages merged into `effect` core**: `@effect/platform`, `@effect/rpc`, `@effect/cluster`.
- **Still separate**: `@effect/platform-*` (so **`@effect/platform-bun` remains its own package in v4** — currently `4.0.0-rc.112`, depending on `@effect/platform-node-shared@^4.0.0-rc.112`), `@effect/sql-*`, `@effect/ai-*`, `@effect/vitest`.
- **`effect/unstable/*`** — a new tier that may break in minor releases: `ai`, `cli`, `cluster`, `devtools`, `encoding`, `eventlog`, `http`, `rpc`, `schema`, `sql`, `workflow`.

Concrete import remappings (excerpt from the generated Import Map):

```text
@effect/platform/FileSystem      -> effect/FileSystem              (barrel: effect)
@effect/platform/Path            -> effect/Path                    (barrel: effect)
@effect/platform/Terminal        -> effect/Terminal                (barrel: effect)
@effect/platform/Error           -> effect/PlatformError            (barrel: effect)
effect/Either                    -> effect/Result                   (barrel: effect)
effect/JSONSchema                -> effect/JsonSchema               (barrel: effect)
effect/TRef/TMap/TSet/TQueue/... -> effect/TxRef/TxHashMap/TxHashSet/TxQueue/...
effect/TestClock                 -> effect/testing/TestClock        (barrel: effect/testing)
effect/FastCheck                 -> fast-check
@effect/cli/Args                 -> effect/unstable/cli/Argument
@effect/cli/Options              -> effect/unstable/cli/Flag
@effect/cli/Command              -> effect/unstable/cli/Command
@effect/platform/HttpClient      -> effect/unstable/http/HttpClient
@effect/platform/Headers         -> effect/unstable/http/Headers
@effect/platform/FetchHttpClient -> effect/unstable/http/FetchHttpClient
@effect/ai/*                     -> effect/unstable/ai/*
@effect/experimental/DevTools    -> effect/unstable/devtools/DevTools
```

Per-topic migration guides in `migration/`: `cause.md`, `equality.md`, `error-handling.md`, `fiber-keep-alive.md`, `fiberref.md`, `forking.md`, `generators.md`, `layer-memoization.md`, `runtime.md`, `schema.md`, `scope.md`, `services.md`, `yieldable.md`, plus `annotations/`.

### 3.3 What this changes about structuring services / layers / errors

- **Services**: `Context.Tag` → **`Context.Service`** class form. This is a structural rewrite, not a rename (the migration skill calls this out explicitly). kb already does this — `src` shows `import { Context, Effect, Layer } from "effect"`.
- **Errors**: `Schema.TaggedError` from core `effect` is the recommended error type; `Data.TaggedError` is the older form. Schema-backed errors serialize/deserialize across boundaries for free. `catch*` family renamed (`Effect.catchAll` → `Effect.catch`); see `migration/error-handling.md`.
- **Layers**: memoization semantics changed — see `migration/layer-memoization.md`. Diagnostics `layerMergeAllWithDependencies` and `missingLayerContext` catch the common regressions.
- **Either → Result**: v4 renames `Either` to `Result`.
- **Schema**: lives in core `effect` (`import { Schema } from "effect"`), `@effect/schema` is gone; `effect/unstable/schema` holds the volatile surface. See `migration/schema.md`.

---

## 4. Local state

### 4.1 `/Users/popemkt/.dotfiles`

Greps across the repo (excluding `.git`, `node_modules`) for `effect-solutions`, `language-service`, `effect-mcp`, `@effect/eslint` → **zero hits, all four**.

- `.claude/` contains only `hooks/`, `settings.json`, `settings.local.json`. **Zero occurrences of "effect"** anywhere under `.claude/`.
- No `.agents/` directory, no `.claude/skills/` directory in this repo. Skills are currently consumed from `~/.agents/skills` via `~/.claude/skills` symlinks.
- `.mcp.json` registers exactly one server:
  ```json
  { "mcpServers": { "kb": { "command": "/Users/popemkt/.dotfiles/tools/kb/bin/kb", "args": ["mcp"] } } }
  ```
  No Effect docs MCP.
- `tools/kb/tsconfig.json` has **no `plugins` array** — the Effect language service is not wired in. Config is bundler-mode: `module: Preserve`, `moduleResolution: bundler`, `allowImportingTsExtensions`, `verbatimModuleSyntax`, `types: ["bun"]`, `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`; `noUnusedLocals`/`noUnusedParameters`/`noPropertyAccessFromIndexSignature` explicitly off. `include: ["index.ts","src","tests","extensions-bundled"]`, `exclude: ["ui"]`.
- `tools/kb/package.json`: `typescript ^7.0.2` (resolved **7.0.2**), `vite-plus 0.2.8`, `vitest 4.1.10`, `knip 6.32.2`, `@stryker-mutator/core ^10`, `fast-check ^4.9.0`. `node_modules/.bin/tsgolint` present (via `oxlint-tsgolint`). No `@effect/vitest`.
- `tools/kb/vite.config.ts` deliberately disables `lint.options.typeCheck`/`typeAware`, documenting that `tsc --noEmit` is the gate for the Bun/Effect tree.
- `.githooks/pre-commit` already runs `tsc --noEmit` for `tools/kb` and `tools/kb/ui` on staged kb changes, plus `docs-check`.

**Effect surface actually used in kb** (import census over `src`, `index.ts`, `extensions-bundled`, `tests`):

```
35×  from "effect"                                  (Effect, Schema, Layer, Context, Cause, Exit,
                                                     Option, Scope, Duration, Clock, Random)
19×  from "effect/FileSystem"
 2×  from "effect/unstable/http/HttpServerResponse"
 1×  from "effect/SchemaAST"
 1×  from "@effect/platform-bun/BunFileSystem"
```

Already fully v4-shaped: `effect/FileSystem` (not `@effect/platform/FileSystem`), `effect/unstable/http/*`, core `Schema`, `Context.Service`. One `effect/unstable/*` touchpoint = one place exposed to minor-release churn.

### 4.2 `~/.claude/skills` and `~/.agents/skills`

~60 skills installed in `~/.agents/skills`, mirrored as symlinks in `~/.claude/skills`. **No Effect-TS skill.** The only name matching `*effect*` is `iii-effect-system`, which belongs to the "iii engine" agent-pipeline skill family — unrelated to Effect-TS.

### 4.3 `<refrepo checkout>` (read-only)

- Nx/pnpm monorepo, `eslint.config.mjs` at root, 43.9 KB `AGENTS.md` (`CLAUDE.md` symlinks to it).
- Effect usage: **exactly one** `package.json` mentions `"effect"` — `libs/shared/sandbox/package.json`. **No `@effect/*` package anywhere.**
- Skills at `.agents/skills/{refrepo-eval-run, refrepo-setup, targets-create-report}` + `.claude/skills/copilot-cassette-record`. **No Effect skill.**
- `agents/` holds YAML persona definitions (`atlas`, `forge`, `lens`, `proof`, `signal`, `spark`) + `PROMPT_REVIEW_RULES.md` — unrelated to Effect.

Conclusion: refrepo offers nothing to import, and is not an Effect codebase.

---

## 5. Recommendations

Ordered by value-per-unit-of-diff. Everything below is Effect-4-compatible unless flagged.

### R1 — Point agents at the shipped `AGENTS.md` (do first; zero deps)

Highest value, smallest diff, and it is the literal instruction of the official `effect-ts` skill. Add to `/Users/popemkt/.dotfiles/CLAUDE.md`, in the `kb — repo knowledge base` section:

```md
### Effect

`tools/kb` uses the Effect TypeScript library (v4). Before writing any Effect
code, read `tools/kb/node_modules/effect/AGENTS.md` **completely** and follow
the links in it. For APIs the guide does not cover, search the source in
`tools/kb/node_modules/effect/src` — never external docs or a v3 memory, both
of which are wrong for v4.

v4 non-negotiables: `Effect.gen` inline, `Effect.fn("name")` / `Effect.fnUntraced`
for reusable functions, `Schema.TaggedError` for errors, `Context.Service` classes
for services, `Effect.catch` (not `catchAll`), `Schema` from `"effect"` core.
```

Caveat worth stating in the note: the file lives in `node_modules`, so it is absent on a fresh clone until `bun install --cwd tools/kb`. The pre-commit hook already guards on `tools/kb/node_modules/effect` existing, so the repo has precedent for that dependency.

### R2 — Vendor the two official skills into the repo

`npx skills add Effect-TS/skills` installs to `~/.agents/skills` (machine-global, outside the declarative repo — off-model for this codebase). Prefer vendoring, since `.dotfiles` is the source of truth for intentional config:

```bash
mkdir -p /Users/popemkt/.dotfiles/.agents/skills
cd /tmp && git clone --depth 1 https://github.com/Effect-TS/skills effect-skills
cp -R /tmp/effect-skills/skills/effect-ts        /Users/popemkt/.dotfiles/.agents/skills/
cp -R /tmp/effect-skills/skills/effect-v3-to-v4  /Users/popemkt/.dotfiles/.agents/skills/
mkdir -p /Users/popemkt/.dotfiles/.claude/skills
ln -s ../../.agents/skills/effect-ts       /Users/popemkt/.dotfiles/.claude/skills/effect-ts
ln -s ../../.agents/skills/effect-v3-to-v4 /Users/popemkt/.dotfiles/.claude/skills/effect-v3-to-v4
```

(MIT-licensed; keep upstream `LICENSE` alongside.)

Honest assessment of value:
- `effect-ts` is a **setup** skill — its whole body is "install effect; add a pointer to AGENTS.md". Once R1 lands, it is redundant. **Do R1; skip this skill.**
- `effect-v3-to-v4` is genuinely useful **only if you ever migrate v3 code**. kb was born on v4. It is `disable-model-invocation: true` so it costs nothing but disk. **Optional; low priority.**

The layout question (`.agents/skills` vs `.claude/skills`) is a repo-abstraction decision — `.dotfiles` currently has neither, so introducing one should follow the "name the concept, one mechanism" rule rather than being bolted on for a single skill.

### R3 — `@effect/tsgo` in `tools/kb` (the highest-leverage code change)

This gives ~90 Effect-specific diagnostics — `floatingEffect`, `missingEffectError`, `missingEffectContext`, `missingLayerContext`, `outdatedApi`, `tryCatchInEffectGen`, `processEnv`, `globalDate`, `globalConsole` — enforced by the **existing** `tsc --noEmit` gate and the **existing** pre-commit hook. No new gate, no new CI step.

```bash
bun add -d --cwd /Users/popemkt/.dotfiles/tools/kb @effect/tsgo
```

`tools/kb/tsconfig.json` — add to `compilerOptions`:

```jsonc
"plugins": [
  {
    "name": "@effect/language-service",
    "includeSuggestionsInTsc": true,
    "ignoreEffectSuggestionsInTscExitCode": false,
    "diagnosticSeverity": {
      // correctness — hard errors
      "floatingEffect": "error",
      "missingEffectError": "error",
      "missingEffectContext": "error",
      "missingLayerContext": "error",
      "missingStarInYieldEffectGen": "error",
      "outdatedApi": "error",
      "classSelfMismatch": "error",
      "duplicatePackage": "error",
      "anyUnknownInErrorContext": "error",
      "unsupportedServiceAccessors": "error",
      // anti-patterns — hard errors
      "tryCatchInEffectGen": "error",
      "runEffectInsideEffect": "error",
      "leakingRequirements": "error",
      "unknownInEffectCatch": "error",
      "globalErrorInEffectFailure": "error",
      "scopeInLayerEffect": "error",
      // Effect-native preferences — warn first, promote after cleanup
      "processEnv": "warning",
      "globalDate": "warning",
      "globalConsole": "warning",
      "globalRandom": "warning",
      "globalTimers": "warning",
      "asyncFunction": "warning",
      // style — off; they fight `vp fmt` / kb house style
      "missedPipeableOpportunity": "off",
      "effectFnOpportunity": "off",
      "importFromBarrel": "off"
    }
  }
]
```

Notes:
- The plugin `name` string is `@effect/language-service` even when the installed package is `@effect/tsgo` — that is the documented shape, not a typo.
- Start every "Effect-native preference" at `warning`, run once, then promote. Setting `globalConsole`/`processEnv` to `error` on day one will light up CLI and extension-loader code.
- `ignoreEffectSuggestionsInTscExitCode: false` is what makes diagnostics actually fail `tsc --noEmit`. The wizard defaults it to `true` (advisory only) — flip it deliberately, and only after the first clean pass.
- Build-time enforcement needs the patch step, persisted:
  ```json
  { "scripts": { "prepare": "effect-tsgo patch --oxlint" } }
  ```
  The `--oxlint` variant is the documented form for repos already running `oxlint` + `oxlint-tsgolint` — which kb is. Confirm the exact flag with `npx @effect/tsgo patch --help` before committing, since the devtools page and the tsgo quickstart word it slightly differently (`effect-tsgo patch --oxlint` vs `npx @effect/tsgo patch`).
- Because `prepare` runs on install, and kb's pre-commit already skips gracefully when deps are missing, this stays consistent with the repo's "converge best effort" executor rule.
- One-shot check without touching the build: `npx @effect/tsgo diagnostics --project tools/kb/tsconfig.json`. **Run this first** to size the cleanup before wiring anything.
- Editor: `npx @effect/tsgo patch` syncs the editor's TS server; VS Code needs `"typescript.tsdk": "./node_modules/typescript/lib"` in `.vscode/settings.json`.
- Optional editor-only: install `effectful-tech.effect-vscode` for fiber/span debugging. No repo artifact.

### R4 — Lint plugin: **do not install anything**

- ❌ `@effect/eslint-plugin` — 2 rules (`dprint`, `no-import-from-barrel-package`), last touched 2025-11-26, and kb has no ESLint. **Effect-3-era; skip.**
- ❌ `eslint-plugin-effect` — does not exist on npm.
- ❌ `@effect/oxc/oxlint` — this is what Effect actually uses, but it is **unpublished** (npm 404, internal workspace package). Cannot be consumed. Revisit if it ships.
- ✅ The one rule worth borrowing, `effect/no-import-from-barrel-package`, is already covered by the tsgo `importFromBarrel` diagnostic from R3.
- ❌ Do **not** copy Effect's `.oxlintrc.json` offs (`typescript/no-explicit-any: off`, `ban-ts-comment: off`, `no-namespace: off`). Those are library-authoring concessions; kb is an application and its stricter stance is correct. Copying them would regress the existing `tools/kb/.oxlintrc.json`.
- ❌ dprint — Effect formats with dprint; kb formats with `vp fmt`. Two formatters for one concept violates Rule 1.

### R5 — Docs MCP: skip

`effect-mcp` (tim-smart) is personally maintained, at `0.1.16`, and makes no v4 coverage claim while effect.website's v4 docs are still being rewritten. For a v4-beta/RC codebase, `node_modules/effect/AGENTS.md` + grepping `node_modules/effect/src` is strictly more accurate than an MCP indexing possibly-v3 docs. Adding a second `.mcp.json` server for worse information is a net loss. Revisit once Effect ships an official docs MCP (the RC blog promises "language tooling improvements to enhance developer and agent experiences" post-RC).

### R6 — Bump `effect` and `@effect/platform-bun` to the RC line

```bash
bun add --cwd /Users/popemkt/.dotfiles/tools/kb effect@4.0.0-rc.112 @effect/platform-bun@4.0.0-rc.112
```

Rationale: the official `effect-ts` skill now says `effect@rc`; `beta.106` predates the RC cut by four days; upstream declares interfaces "presumed final" with no further broad breaking changes. Keep both packages on the **same** version — v4 ships the whole ecosystem in lockstep, and the `duplicatePackage` diagnostic (R3) will police it thereafter. Do this **before** R3's first diagnostics run so `outdatedApi` reports against the version you intend to keep.

Watch item: `src/surface/*` imports `effect/unstable/http/HttpServerResponse` — `unstable/*` may break in minor releases by design. That is the one import to re-verify on each bump.

### R7 — Reference reading only

`bunx effect-solutions@latest show <topic>` — good v4 prose on services/layers, error handling, data modeling, testing. But its `project-setup` recommends the TS 5-era `@effect/language-service` + `effect-language-service patch`, and its `tsconfig` recommends `module: NodeNext` / `exactOptionalPropertyTypes` / `noUnusedLocals` which conflict with kb's deliberate bundler-mode Bun config. **Read it; do not adopt its configs.** No install, no repo artifact.

### Not applicable

- Effect monorepo `.agents/skills/*` (12 skills) — contributor tooling for developing Effect itself (changesets, jsdocs, bundle-analysis, package-development). Irrelevant to consumers.
- `effect.website/llms.txt` — does not exist (404).
- refrepo repo — one stray `"effect"` string in `libs/shared/sandbox/package.json`, no `@effect/*`, no Effect skills. Nothing to import.

---

## Sources

- <https://github.com/Effect-TS/skills> · [`effect-ts/SKILL.md`](https://raw.githubusercontent.com/Effect-TS/skills/main/skills/effect-ts/SKILL.md) · [`effect-v3-to-v4/SKILL.md`](https://raw.githubusercontent.com/Effect-TS/skills/main/skills/effect-v3-to-v4/SKILL.md)
- <https://github.com/Effect-TS/effect/blob/main/LLMS.md> (= shipped `node_modules/effect/AGENTS.md`)
- <https://github.com/Effect-TS/effect/blob/main/MIGRATION.md> · <https://github.com/Effect-TS/effect/blob/main/migration/v3-to-v4.md>
- <https://github.com/Effect-TS/effect/blob/main/.oxlintrc.json> · <https://raw.githubusercontent.com/Effect-TS/effect/main/packages/tools/oxc/oxlintrc.json>
- <https://github.com/Effect-TS/language-service> · <https://github.com/Effect-TS/tsgo> · <https://mintlify.wiki/Effect-TS/tsgo/quickstart>
- <https://www.effect.website/docs/v4/getting-started/devtools>
- <https://www.effect.website/blog/releases/effect/40-rc> · <https://www.effect.website/blog/releases/effect/40-beta>
- <https://www.infoq.com/news/2026/04/effect-v4-beta/>
- <https://github.com/Effect-TS/eslint-plugin>
- <https://github.com/tim-smart/effect-mcp>
- <https://www.effect.solutions> · <https://github.com/kitlangton/effect-best-practices> · <https://www.effect.solutions/llms.txt>
- npm registry: `effect`, `@effect/platform-bun`, `@effect/tsgo`, `@effect/language-service`, `@effect/eslint-plugin`, `@effect/vitest`, `effect-solutions`, `effect-mcp`, `skills` (queried 2026-09-03)
