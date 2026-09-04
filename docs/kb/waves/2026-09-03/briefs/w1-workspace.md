# w1-workspace — kb as a workspace of small, tagged packages

Wave `w1` of `docs/kb/waves/2026-09-03/plan.md` (decisions D1, D2, D6, D7, D11).
Harness: claude (opus), isolated worktree. **Structural wave: moves, manifests,
wiring. No behaviour change.** Every commit keeps `bun test`, both `tsc
--noEmit`, ui `vp test`, and `nix build .#kb` green. `git mv` everything so
history survives.

Read first: `plan.md` (D1/D2/D11/D12, standing constraints), `reports/recon-kb.md`
Part A (current tooling) and B.1–B.5 (who imports what),
`reports/recon-refrepo.md` §2.3a, §2.5, §7 (module shape, public surface,
catalog policy, pnpm↔Bun table), `reports/measurements.md` §4 (tsgolint gap),
`tools/kb/DESIGN.md`, `tools/kb/ui/ARCHITECTURE.md`.

## 0. Outcome in one paragraph

`tools/kb` is a Bun workspace root. Every concept is a package under
`tools/kb/packages/<name>` named `@kb/<name>`, `private`, `version 0.0.0`, one
curated `exports["."]` barrel of named exports pointing at source (no build
step), two tags (`layer:*`, `scope:*`) in an `nx` key, and only `workspace:*` /
`catalog:` dependency specifiers. Nx provides the project graph; a harness test
enforces the tag constraint matrix over that graph. The four hand-synced
`@kb/*` alias maps are gone because `@kb/*` are real packages. One `bun.lock`.
`pkgs/kb` builds from the new layout. Effect is on `rc.112`, DataScript on 1.8.1,
`oxlint --type-aware` runs, and the Effect skills are installed at repo scope.

## 1. Package layout (target)

| Package | layer | scope | Moves in from | Notes |
|---|---|---|---|---|
| `@kb/model` | domain | shared | `foundation/{model,order,field-type,errors,schema-seam,tx-validation,resolve}.ts`, `storage/{node-schema,canonical}.ts`, `seed.ts`, `example.ts` | pure; no `bun:`/`node:` imports. `KbNode`, `PropValue`, `SYSTEM_IDS`, ranks, schema of a node, canonical JSON, forest validation, system seed |
| `@kb/canvas` | domain | shared | `canvas/doc.ts` | already an alias; pure |
| `@kb/query` | domain | shared | `foundation/query/{datascript,queries,index}.ts`, `foundation/ontology.ts`, `types/datascript.d.ts` | the in-memory engine adapter + canonical EDN + ontology resolver; isomorphic (ui imports it). Owns the `datascript` dependency |
| `@kb/contracts` | contract | shared | `shared/contracts.ts`, `surface/protocol.ts`, `storage/store.ts` (the `Store`/`EffectStore` port), the service **tags** from `foundation/services.ts` (`KbStore`, `KbCtx`, `KbContext` type) | wire + action + port contracts. No implementations |
| `@kb/ext-sdk` | contract | shared | `ext-sdk/**` | generated `.d.ts` text stays where the generator writes it |
| `@kb/store-jsonl` | infrastructure | backend | `storage/{jsonl-store,durable-replace,write-lock,index}.ts`, `foundation/platform.ts`, `foundation/saved-query.ts` | implements the Store port; the only package that touches `nodes.jsonl` bytes |
| `@kb/operations` | application | backend | `operations/**`, `render/**`, `registry.ts`, `extensions.ts` (loader), `surface/map.ts` (plan surface — used by DST, so it is application-level), `surface/format.ts` if it is receipt formatting rather than TTY printing (decide; record) | depends on `@kb/contracts` service tags, **never** on `@kb/store-jsonl` |
| `@kb/runtime` | app | backend | `context.ts`, the *implementation* half of `foundation/services.ts` (`openKbEffect`, `reloadEffect`, `persistEffect`, `jsonlStoreLayer`, `kbRuntimeLayer`), `surface/root.ts` | the composition root: the only backend package allowed to import both `@kb/operations` and `@kb/store-jsonl` |
| `@kb/cli` | app | backend | `surface/cli.ts`, `bin/{docs-check,docs-materialize}.ts`, console output seam | `bin/kb` entry |
| `@kb/mcp` | app | backend | `surface/mcp.ts` | |
| `@kb/server` | app | backend | `surface/ui.ts`, `surface/ui/**` | HTTP/WS/session/assets/paths/build/dev |
| `@kb/ui` | app | browser | `ui/**` | imports only `scope:shared` packages |
| `@kb/ext-docs`, `@kb/ext-canvas` | extension | extension | `extensions-bundled/{docs,canvas}.ts` | reach kb only through `@kb/ext-sdk` + `@kb/contracts` |
| `@kb/test-kit` | test-support | test-support | `tests/dst/harness.ts`, fast-check arbitraries, fixtures used by ≥ 2 packages | |
| `@kb/harness` | — | tooling | new | repo-shape tests (`g2` fills it; `w1` adds `boundaries`, `public-surface`, `version-authored-once`, `workspace-shape`) |

Tests: each `tests/*.test.ts` moves next to the package it exercises
(`packages/<name>/tests/` or co-located `*.test.ts`). Cross-package tests
(`cli.test`, `mcp.test`, `ui*.test`, `surface-effect.test`) live in the app
package they drive. `tests/dst/{dst.test,run-many}` → `@kb/test-kit` (the
harness) + `@kb/runtime` (the seeded runs). `benchmark.test.ts` → `@kb/query`.

Gray cases: decide by the rule "who would break if it changed" and record the
decision in the report. If a file genuinely belongs to two packages, it is two
files or a new package — never a re-export shim.

## 2. Tag axes and the constraint matrix (harness `boundaries`)

```
layer:domain          → domain
layer:contract        → domain, contract
layer:infrastructure  → domain, contract                 (implements ports; imports nothing above)
layer:application     → domain, contract, application    (NOT infrastructure — DI via Effect service tags)
layer:app             → any layer
layer:extension       → domain, contract                 (ext-sdk is contract)
layer:test-support    → domain, contract, application, test-support

scope:shared          → shared
scope:backend         → shared, backend
scope:browser         → shared, browser                  (never backend)
scope:extension       → shared, extension
scope:test-support    → shared, backend, test-support
scope:tooling         → (no workspace deps)
```

Both axes must pass. Every package carries exactly one tag from each axis
(harness `workspace-shape`). This is refrepo's model with the two gaps closed:
application ↛ infrastructure is *enforced* (Effect Layers make it natural), and
no package is untagged.

**Isomorphism fence** (the one restriction the graph cannot see): packages
tagged `scope:shared` may not import `bun:*`, `node:*`, or `@effect/platform-bun`.
Expressed once, in `.oxlintrc.json`, as a `no-restricted-imports` override on
`packages/{model,canvas,query,contracts,ext-sdk}/**`. Hand this to `g2`'s
config (add it to Appendix B's placeholder override) — do not create a second
lint config.

## 3. Nx (graph and task runner only)

- Root devDep `nx` (catalog). `nx.json`:
  `namedInputs.default = ["{projectRoot}/**/*", "sharedGlobals"]`,
  `sharedGlobals = ["{workspaceRoot}/tsconfig.base.json", "{workspaceRoot}/.oxlintrc.json", "{workspaceRoot}/bun.lock"]`,
  `targetDefaults`: `typecheck` (cache, inputs default + `^default`), `test`
  (cache), `build` (ui only). `analytics: false`, no cloud, no plugins, no
  generators. Nx infers projects from Bun workspaces + each package's `nx`
  key. **Verify** Nx detects the Bun lockfile; if it needs a hint, record it.
- `nx graph --file=<tmp>.json` is the boundaries input. Confirm the JSON carries
  `nodes[].data.tags` and `dependencies` derived from imports (not only
  manifests). If import-derived edges are missing, the harness falls back to
  manifest deps + a TS import scan and says so.
- Root scripts fan out with `nx run-many -t typecheck,test`; `lint` stays one
  root oxlint invocation over `packages` (one scope map; plan Appendix B);
  `verify` = `bun run typecheck && bun run lint && bun run fmt:check && bun run knip && bun run harness`.
  `g2` finalises `fmt:check`/`knip`; `w1` wires `typecheck`, `lint`, `test`,
  `harness` and keeps `verify` green with what exists.
- `nx affected -t typecheck,test --base=main` as a convenience script.

## 4. Manifests, catalog, bunfig

- Root `package.json`: `private`, `workspaces: { packages: ["packages/*"], catalog: {…} }`.
  **Every** external dependency in the catalog (owner decision: strict), sorted;
  every package manifest uses `catalog:` / `workspace:*` only. Pinning style
  as refrepo: caret default, tilde for `typescript`, exact for `vite-plus` +
  its `vite` alias twin (alias cannot reference a catalog entry; keep adjacent
  with the comment), exact for `@stryker-mutator/core`.
- Bumps inside the catalog: `effect` + `@effect/platform-bun` → `4.0.0-rc.112`
  (lockstep), `datascript` → `^1.8.1`. Run the suite; re-verify the one
  `effect/unstable/http/HttpServerResponse` import.
- Delete `ui/bun.lock`; one root `bun.lock`. Keep ui's `overrides` for the
  `vite` alias and `devEngines.packageManager` (blocks `npm run`; one line).
- `bunfig.toml` `[install]`: `minimumReleaseAge = 4320`, `trustedDependencies`
  explicit (enumerate what actually needs lifecycle scripts; expect none or
  `esbuild`), `linker = "isolated"` if the ui build and Storybook tolerate it
  (measure; otherwise `hoisted` with the reason recorded).
- `[test]`: delete the `pathIgnorePatterns` list; `bun test packages` runs
  backend + harness; `@kb/ui` tests run via `vp test` inside the package (the
  two-runner split stands, documented once in `DESIGN.md`).
- Establish why `@oxlint-tsgolint/darwin-arm64` was missing and make
  `oxlint --type-aware packages` run. Add `oxlint-tsgolint` to the catalog
  explicitly rather than relying on the `vite-plus` transitive.

## 5. Per-package shape (harness `workspace-shape` + `public-surface`)

```jsonc
{
  "name": "@kb/model",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "bun test"
  },
  "dependencies": { "effect": "catalog:" },
  "nx": { "tags": ["layer:domain", "scope:shared"] }
}
```

- `src/index.ts` is a **curated barrel of named exports** — `export * from` is
  forbidden (`export * as ns` allowed). The membership test: would a second
  client need this symbol? Internals stay unexported from the barrel.
- `tsconfig.json`: `extends: "../../tsconfig.base.json"`, declares only
  `include` and any genuine delta (`types: ["bun"]` for backend, DOM `lib` +
  `jsx` for ui). `g2` writes the base; until then `w1` creates a base with the
  current flags and moves both existing configs onto it (no new flags — that is
  `g2`'s job).
- No `paths` anywhere. Module resolution = workspace + `exports`.
- `@kb/ui`: `vite.config.ts` loses its `@kb/*` aliases; `.storybook/main.ts`
  loses its alias map; `knip.json` loses its `paths`. Linked workspace packages
  are served as source by Vite — verify `vp dev`, `vp build`, Storybook, and
  the Playwright render harness still work.

## 6. Entrypoints

- `tools/kb/bin/kb` stays at that path (direnv shim, `.mcp.json`) and execs
  `bun packages/cli/src/main.ts`. `packages/cli/package.json` `bin.kb` points
  at the same file.
- Root scripts are the minimal-and-complete entrypoints (refrepo's rule): a
  fresh shell can run each with no prior env; nothing below the entrypoint
  layer. Delete `index.ts` ("kb M1" stub) and `lint:all`/`check` (superseded).
- `pkgs/kb/default.nix`: single `bun install --frozen-lockfile` at root;
  `cliJs` bundles `packages/cli/src/main.ts`; `uiDist` runs
  `bun run --filter @kb/ui build`. Update both FOD hashes. `nix build .#kb`
  must pass and `result/bin/kb --version` must run. Do **not** `rebuild`.

## 7. Skills CLI (D6)

From the repo root `/Users/popemkt/.dotfiles`: `bunx skills add Effect-TS/skills`
at **project** scope (check `bunx skills --help` for the non-interactive /
agent-selection flags). Expect `.agents/skills/{effect-ts,effect-v3-to-v4}` +
a `.claude/skills` link and a lockfile; commit them. Record what the CLI wrote.
This is the one mechanism for future skills; do not hand-copy skill files.

## 8. Harness checks `w1` ships (with red-then-green evidence)

| Check | Asserts | Red case |
|---|---|---|
| `boundaries` | §2 matrix over `nx graph --file` + tags | temporarily import `@kb/store-jsonl` from `@kb/operations` |
| `public-surface` | each package has exactly one `.` export → `src/index.ts`; barrel has named exports only | add `export * from` |
| `version-authored-once` | every dep `workspace:*`/`catalog:`; no literals outside `OFF_CATALOG_BY_DECISION` (starts empty); no `latest`/`*`/`next`; `minimumReleaseAge ≥ 4320`; `trustedDependencies` explicit | add `"zod": "^4"` to a package |
| `workspace-shape` | every `packages/*` dir is a workspace member with `name`, `private`, `exports`, both tags, `scripts.typecheck`; every workspace member is under `packages/` | drop a tag |

`packages/harness` is `scope:tooling`, depends on nothing in the workspace,
reads files and runs `nx graph`. `g2` adds its nine more checks here.

## 9. Acceptance

- `git mv`-based history; `git log --follow` works for moved files.
- `bun install` (one lockfile) → `bun run verify` green → `bun test packages`
  green → `cd packages/ui && bun run test` green → `nix build .#kb` green.
- `nx graph --file` shows every package with two tags; `boundaries` red case
  demonstrated then reverted.
- `grep -rn "@kb/" --include=tsconfig.json --include=vite.config.ts --include=main.ts --include=knip.json` finds **no alias maps**.
- `oxlint --type-aware packages` runs (exit 0/1 for findings, never a crash).
- `effect@4.0.0-rc.112`, `datascript@1.8.1` in `bun.lock`; suite green.
- `.agents/skills/effect-ts` present via the skills CLI, lockfile committed.
- No behaviour change: DST replay seeds identical; `store-roundtrip` property
  green; `kb --version`, `kb search x`, `kb mcp` smoke from `bin/kb`.

## 10. Report

`reports/w1-workspace.md`: final package table with LOC and tags; every gray
placement decision with its reason; the Nx/Bun verification result; red/green
table for the four checks; `linker` decision; `pkgs/kb` hash update; anything
cut as `#gap` text (nodes are filed by `r2` — list the text here).
