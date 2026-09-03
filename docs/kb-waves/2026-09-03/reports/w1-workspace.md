# w1-workspace — report

Wave `w1` of `docs/kb-waves/2026-09-03/plan.md` (D1, D2, D6, D7, D11, D12).
Harness: claude (opus), isolated worktree
`/Users/popemkt/.dotfiles/.claude/worktrees/agent-afc5f21d10581247f`, branch
`main` (worktree-local; **not** pushed, **not** merged).

Base: `91b94e6`. Commits are listed in §8.

---

## 1. Final package table

LOC counts `.ts`/`.tsx` only, excluding `node_modules`, `dist`,
`storybook-static`.

| Package | layer | scope | src LOC | test LOC |
|---|---|---|---:|---:|
| `@kb/model` | domain | shared | 2200 | 1331 |
| `@kb/canvas` | domain | shared | 396 | 0 |
| `@kb/query` | domain | shared | 347 | 75 |
| `@kb/contracts` | contract | shared | 302 | 81 |
| `@kb/ext-sdk` | contract | backend | 317 | 0 |
| `@kb/store-jsonl` | infrastructure | backend | 476 | 170 |
| `@kb/operations` | application | backend | 2310 | 45 |
| `@kb/ext-docs` | extension | backend | 126 | 0 |
| `@kb/ext-canvas` | extension | backend | 263 | 0 |
| `@kb/runtime` | app | backend | 560 | 3611 |
| `@kb/cli` | app | backend | 1107 | 1120 |
| `@kb/mcp` | app | backend | 373 | 192 |
| `@kb/server` | app | backend | 1317 | 1563 |
| `@kb/ui` | app | browser | 38684 | 0 |
| `@kb/test-kit` | app | test-support | 524 | 151 |
| `@kb/render-tests` | test-support | test-support | 0 | 1246 |
| `@kb/harness` | tooling | tooling | 295 | 462 |
| **total** | | | **49597** | **10047** |

`@kb/ui` LOC includes its co-located `*.test.tsx` files (Vitest, not `bun
test`), which is why its test column reads 0.

## 2. The constraint matrix as shipped

Stated once, in `packages/harness/src/constraints.ts`.

```
layer:domain          → domain
layer:contract        → domain, contract
layer:infrastructure  → domain, contract
layer:application     → domain, contract, application
layer:extension       → domain, contract, application          [widened]
layer:app             → any
layer:test-support    → domain, contract, application, extension, app  [widened]
layer:tooling         → (nothing)                              [added]

scope:shared          → shared
scope:backend         → shared, backend
scope:browser         → shared, browser
scope:test-support    → shared, backend, test-support
scope:tooling         → (nothing)                              [added]
```

Three deviations from the brief's §2 table, each recorded in the source:

- **`layer:extension → application` (widened).** The bundled extensions are
  policy modules registered from inside the package — their own docstrings say
  so — not sandboxed third-party code. `@kb/ext-docs` needs
  `loadViewsEffect`/`renderViewEffect` and `@kb/ext-canvas` needs
  `persistEffect`, all `layer:application`. Making the brief's row true would
  mean designing an extension API that exposes those through
  `@kb/contracts` — a design job, not a move. The fences that matter still
  hold and are enforced: extension ↛ infrastructure and extension ↛ app, so a
  bundled extension can never reach the store adapter, the composition root,
  the CLI or the server. Third-party `.kb/extensions/*.ts` are fenced by
  `@kb/ext-sdk`'s ambient `.d.ts`, which is a different mechanism and not a
  package edge at all.
- **`layer:test-support → app` (widened).** `@kb/render-tests` drives the
  server through `startUi`. It still may not reach infrastructure.
- **`layer:tooling` / `scope:tooling` (added).** The brief's table left
  `@kb/harness`'s layer as "—" while §2 requires exactly one tag per axis. A
  row that forbids every workspace dependency says the same thing honestly.

Two rows were **not** added:

- **No `scope:extension` row.** No package carries it (the bundled extensions
  run in the Bun backend process, so `scope:backend` is the factual tag), and a
  declared abstraction no code path reads is worse than none.
- **No `infrastructure → infrastructure` edge.** See the `platform.ts` gap in
  §7.

## 3. Gray placement decisions

Decided by "who would break if it changed"; deviations from the brief's §1
table are marked.

| File(s) | Home | Why |
|---|---|---|
| `surface/format.ts` | `@kb/cli` | It turns an `ActionReceipt` into a display string and its only caller is `cli.ts` (3 sites). Receipt formatting with exactly one client is that client's code. |
| `surface/map.ts` | `@kb/operations` | Per the brief. The DST harness drives it, so it cannot live in `@kb/cli`. |
| `foundation/ontology.ts` | `@kb/model` — **deviation** (brief: `@kb/query`) | `ontology.ts` is imported *by* `field-type.ts`, `resolve.ts` and `seed.ts`, all `@kb/model`, while `query/*` never imports it. Putting it in `@kb/query` would make `model → query → model` a package cycle. It is a pure resolver over `KbNode`; it belongs with the model. |
| `foundation/saved-query.ts` | `@kb/operations` — **deviation** (brief: `@kb/store-jsonl`) | Its four consumers are `map.ts`, `operations/actions.ts`, `operations/docs`, and `@kb/server`. Placing it in infrastructure would create exactly the `application → infrastructure` edge the matrix forbids, on four counts. It also keeps `@kb/store-jsonl` matching its own name: the `nodes.jsonl` adapter. |
| `foundation/platform.ts` (`bunFileSystemLayer`) | `@kb/store-jsonl` | Per the brief; see the gap in §7. |
| `foundation/services.ts` | split three ways | The service **tags** (`KbCtx`, `KbStore`, `KbContext`, `kbStoreLayer`, `kbCtxLayer`) are the DI surface → `@kb/contracts`. `reloadEffect`/`persistEffect` reach the store only through the `KbStore` tag, so they are application behaviour → `@kb/operations`. `openKbEffect`/`jsonlStoreLayer`/`kbRuntimeLayer`/`runWithKb` construct a concrete `JsonlStore` and a Bun Layer → `@kb/runtime`. |
| `src/extensions.ts` | split in two | The extension **contract types** → `@kb/contracts/extension.ts`; the loader that reads `.kb/extensions/*.ts` from disk → `@kb/operations/extension-loader.ts`. |
| `shared/contracts.ts` `FailureCode` | `@kb/model/failure.ts` | `errors.ts` and `resolve.ts` (domain) both need it. Leaving it in the contracts package made `domain → contract`, which the matrix forbids. It is the domain's failure vocabulary, and the action contracts consume it. |
| `storage/store.ts` `StoreTx` | `@kb/model/tx.ts` | `tx-validation.ts` (domain) validates it. Same `domain → contract` problem; the transaction is a domain shape, and the port transports it. |
| `foundation/schema-seam.ts` | `@kb/model` | Per the brief. Odd (it is a zod↔JSON-schema seam for *action* schemas) but it creates no boundary violation and the brief is explicit. |
| `src/types/datascript.d.ts` + `ui/src/types/datascript.d.ts` | one file, `@kb/query/src/datascript.d.ts` | They were byte-identical apart from a comment. The one copy travels to every consumer through a triple-slash reference from `datascript.ts`, so `@kb/ui` picks it up via `@kb/query`. |
| `ui/tests-render/**` + `playwright.config.ts` | new `@kb/render-tests` — **deviation** | `tests-render/server.ts` imports `startUi` from `@kb/server`, which `scope:browser` forbids. It is not browser code and is never bundled: it is the visual harness. Its own package makes the tag honest instead of carving a hole in the browser fence. |
| `tests/dst/{dst.test,run-many}` | `@kb/test-kit` — **deviation** (brief: `@kb/runtime`) | The brief's placement makes `@kb/runtime → @kb/test-kit → @kb/runtime` a package cycle. The seeded runs live with the harness they drive. |
| `tests/benchmark.test.ts` | `@kb/store-jsonl` — **deviation** (brief: `@kb/query`) | It loads a real `JsonlStore` from disk and then indexes it, so it cannot live in a `scope:shared` package. |
| `tests/dst/guard.test.ts` | `@kb/harness/tests/determinism-seam.test.ts` | It is a repo-shape check, not a unit test. |
| `@kb/test-kit` tag | `layer:app`, not `layer:test-support` | The DST harness builds `kbRuntimeLayer` and provides `bunFileSystemLayer` itself: it is a composition root, whatever its audience. Tagging it `test-support` would have required widening that row to allow infrastructure, which empties the row of meaning. |

## 4. Deletions (Rule 1, not scope creep)

The `application ↛ infrastructure` edge could not be made true by moving files.
Every Promise facade in `operations/` and `render/` calls `runWithKb`, which
provides `bunFileSystemLayer` — a concrete platform Layer. They are also dead:

| Deleted | Callers before deletion |
|---|---|
| `nodeAdd`, `nodeUpdate`, `nodeGet`, `fieldDefine`, `tagDefine`, `graphQuery`, `graphRun`, `graphSearch` (`operations/index.ts`) | none |
| `renderNamedView`, `listViewNames`, `renderViewAction`, `renderViewsAction` (`render/index.ts`) | none |
| `renderView` (`operations/docs/index.ts`), `loadViews` (`docs/views.ts`) | none |
| `assetUpload` | one test |
| `ontologyMembers` | one test (3 call sites) |
| `index.ts` (the "kb M1" stub) | knip entry only |
| `src/index.ts` (whole-backend re-export barrel) | none |

The two test-reached facades were bodies of the form
`runWithKb(ctx, xEffect(input))`; the four call sites now say that directly.
Behaviour is identical, and `@kb/operations` no longer imports
`@effect/platform-bun` anywhere.

Also deleted: `tools/kb/vite.config.ts` (its only job was scoping `vp lint`
away from `ui/`; the single root `oxlint` invocation supersedes it) and
`tools/kb/tsconfig.json` (a whole-tree typecheck beside the per-package one is
a second mechanism; `nx run-many -t typecheck` is authoritative).

## 5. Nx and Bun — what was verified

- **Nx detects Bun workspaces.** No hint needed. `nx run-many -t typecheck`
  discovers all 17 projects from `packages/*/package.json` and reads
  `nx.tags` from each. Task caching works (17/17 cache hits on a repeat run).
- **Nx does *not* derive import edges here.** Measured, twice:
  - adding `import { JsonlStore } from "@kb/store-jsonl"` to
    `@kb/operations/src/map.ts` produced **no** new edge;
  - deleting `"@kb/query": "workspace:*"` from `@kb/operations`'s manifest
    **removed** the edge, although every file in the package still imports it.

  So Nx's `dependencies` are manifest-derived, despite reporting
  `"type": "static"`. Import analysis needs `@nx/js`, which drags in a plugin
  stack for one job. Per the brief's fallback, `boundaries` reads Nx for
  projects and tags and a **TS import scanner**
  (`packages/harness/src/import-graph.ts`) for edges. The scanner strips
  comments first — every red-case docstring in the harness names an import.
- Manifest edges are checked too, on a separate assertion: a package must
  **declare** what it imports. That check caught nothing at the time it was
  written but is exactly the class of bug that broke the nix build (§6).
- `nx.json` is minimal: `namedInputs`, three `targetDefaults`,
  `useInferencePlugins: false`, `neverConnectToCloud: true`. No plugins, no
  generators, no analytics.
- **`bunfig.toml [install] minimumReleaseAge = 4320` did not visibly gate
  anything.** `bun install` resolved `nx@23.2.0`, published roughly a day
  before this run. Either Bun 1.3.14 applies the setting only on `bun add`, or
  it does not implement it yet. The harness asserts the setting is present and
  ≥ 4320; whether Bun honours it is not something this wave could confirm.
  Recorded as a gap.
- `linker`: left at Bun's default (**hoisted**). `linker = "isolated"` was not
  adopted: the ui toolchain resolves `vite`, `vite-plus`, Storybook and the
  Tailwind/lightningcss native binaries through the root store, and the one
  isolated-style failure this wave already hit (`three`, §6) took a full nix
  build to surface. Flipping the linker is a change whose failure mode is a
  broken browser build, and it belongs in a wave that can iterate on `vp build`
  and Storybook. Recorded as a gap.

## 6. `three`: the undeclared dependency the workspace exposed

`@kb/ui/src/components/graph/force3d-three.ts` imports `three`, which the ui
had never declared — it resolved transitively through `3d-force-graph` under
the old flat `node_modules`. Under the workspace layout the local `bun install`
still resolved it (a stale symlink), and only the clean `nix build` failed:

```
Error: [vite+]: Rolldown failed to resolve import "three" from
  .../packages/ui/src/components/graph/force3d-three.ts.
```

`three` is now a declared, catalogued dependency of `@kb/ui`. `@types/three`
was deliberately **not** added: the package carries a hand-written
`src/types/three.d.ts` documenting exactly the surface the force3d leaf uses,
and installing the real types alongside a `declare module "three"` block would
be two sources for one thing.

This is why `boundaries` also asserts "every imported workspace package is
also declared" — the same failure mode, one package graph up.

## 7. Red-then-green evidence

Script: run the violation, run the check, revert, run the check again. Full
transcript reproduced by the commands below.

| Check | Red case | Red output | Green after revert |
|---|---|---|---|
| `boundaries` | `import { JsonlStore } from "@kb/store-jsonl"` appended to `packages/operations/src/map.ts` | `3 pass, 2 fail` — `@kb/operations (layer:application) -> @kb/store-jsonl (layer:infrastructure) [operations/src/map.ts]` and `@kb/operations imports @kb/store-jsonl without declaring it` | `5 pass, 0 fail` |
| `public-surface` | `export * from "./doc.ts"` appended to `packages/canvas/src/index.ts` | `2 pass, 1 fail` — `canvas/src/index.ts:4: export * from "./doc.ts"` | `3 pass, 0 fail` |
| `version-authored-once` | `"zod": "^4"` added to `packages/model/package.json` | `4 pass, 1 fail` — `model dependencies.zod = ^4 (want catalog:)` | `5 pass, 0 fail` |
| `workspace-shape` | `nx.tags` on `@kb/query` reduced to `["layer:domain"]` | `4 pass, 1 fail` — `query: scope tags []` | `5 pass, 0 fail` |

The first version of `boundaries` — matrix over `nx graph` edges alone — went
**green** on its red case. That is the measurement in §5 and the reason the
import scanner exists: a rule that has never gone red is not known to work,
and this one proved it by not going red.

Three further findings came from the checks' own first run, and are fixed:

- `@kb/cli` had no `exports` field at all (`public-surface`).
- `@kb/test-kit` reached `@kb/store-jsonl` from `layer:test-support`
  (`boundaries`) — resolved by tagging it `layer:app`, see §3.
- an unused root `vitest` devDependency (`knip`).

## 8. Commits

| Commit | Subject |
|---|---|
| `680c09f` | `refactor(kb): delete dead promise facades and aggregate barrels` |
| `22ff41e` | `refactor(kb): separate contract from implementation at four seams` |
| `5162faa` | `refactor(kb)!: restructure tools/kb into a Bun workspace of tagged packages` |
| `e904ede` | `feat(kb): repo-shape harness — boundaries, public surface, versions, shape` |
| `2ced9e4` | `chore: install the official Effect skills at project scope` |

(Further commits for `pkgs/kb` and the docs follow; see the branch head.)

The first two commits exist so the big move is a pure `git mv`: `git log
--follow` works for every moved file.

## 9. Shared-file touches outside `tools/kb`

| File | Change |
|---|---|
| `.githooks/pre-commit` | `docs-check` path → `packages/cli/src/bin/`; the two-package `tsc` loop → `bun run typecheck` (Nx over all 17); its readiness probe → `node_modules/.bin/nx`, because a Bun workspace has no top-level `node_modules/effect` |
| `.github/workflows/validate.yml` | one install instead of two; `npm run verify` → `bun run verify`; `bun test` → `bun run test`; ui suite → `bun run test:ui`; DST sweep → `bun run test:dst`; `docs-check` path |
| `pkgs/kb/default.nix` | one root `bun install`; `cliJs` bundles `packages/cli/src/main.ts`; `uiDist` builds `@kb/ui`; SPA lands at `$out/lib/kb/packages/ui/dist`; both FOD hashes updated |
| `AGENTS.md` (`CLAUDE.md`) | kb section: workspace shape, the new entrypoints, where the boundary rules live |
| `.claude/skills/`, `skills-lock.json` | new, from the skills CLI |
| **git config** `core.hooksPath` | was the absolute `/Users/popemkt/.dotfiles/.githooks`, so a worktree ran the *main checkout's* hook and never the updated one under review. Set to the relative `.githooks`, which is the value `AGENTS.md` documents and resolves identically in the main checkout. Flagged here because it is shared config, not a repo file. |

## 10. Skills CLI (D6) — what it actually wrote

`bunx skills add Effect-TS/skills --project --skill '*' --agent claude-code
--yes`. Notes for whoever adds the next skill:

- `--agent claude` is rejected; the valid id is `claude-code`.
- This version **copies** into the agent directory. There is no `.agents/`
  tree and no symlink. Result:
  `.claude/skills/effect-ts/SKILL.md`,
  `.claude/skills/effect-v3-to-v4/SKILL.md`, and `skills-lock.json`
  (source, `sourceType: github`, `skillPath`, `computedHash` per skill).
- 12 KB total. `skills update` is the refresh path.

## 11. Verification

Baseline (base commit, before any change):

| Command | Result |
|---|---|
| `bun test` | 917 pass / 0 fail, 121 files |
| `npm run typecheck` (backend) | clean |
| `ui: tsc --noEmit` | clean |
| `ui: vp test` | 630 pass, 89 files |
| `nix build .#kb` | pass |

Final:

| Command | Result |
|---|---|
| `bun run typecheck` (`nx run-many`, 17 projects) | **pass** |
| `bun test packages` | **331 pass / 0 fail**, 41 files |
| `bun run test:ui` (`vp test`) | **630 pass**, 89 files |
| `bun run lint` (`oxlint --type-aware packages`) | **exit 0**, 64 warnings, 0 errors |
| `bun run knip` | **exit 0**, config hints only |
| `bun run harness` | **19 pass / 0 fail** |
| `nix build .#kb` | see §12 |
| `bin/kb --version` / `kb search` / `kb mcp --help` | **pass** |
| `packages/cli/src/bin/docs-check.ts` | **pass** (`kb docs: clean (1 view)`) |

The `bun test` count falls from 917 to 331 because `@kb/ui`'s suite no longer
runs twice. At base, recursive `bun test` picked up most of `ui/**` (minus six
files named in `bunfig.toml`) *in addition to* `vp test` running all 89. Now
the split is by package: 41 backend + harness files under `bun test`, all 89 ui
files under Vitest. No test was dropped — the ui total is unchanged at 630.

`oxlint --type-aware packages` runs, which closes `measurements.md` §4. Root
cause of the missing binary: `oxlint-tsgolint` was only a transitive dependency
of `vite-plus`, so Bun never installed its platform-specific
`optionalDependencies`. Declaring `oxlint-tsgolint` directly in the root
`devDependencies` (and catalog) makes Bun resolve
`@oxlint-tsgolint/darwin-arm64` on install.

`effect` and `@effect/platform-bun` are on `4.0.0-rc.112` and `datascript` on
`1.8.1` in `bun.lock`. The one
`effect/unstable/http/HttpServerResponse` import (`@kb/server`'s `assets.ts`
and `http.ts`) still resolves and typechecks under `rc.112`; no import path
changed.

## 12. `nix build .#kb`

`pkgs/kb/default.nix` now runs one root `bun install --frozen-lockfile`,
builds the SPA with `(cd packages/ui && bun run build)` — not `bun run
--filter`, which elides the failing plugin's message and cost this wave two
build cycles to diagnose — and bundles `packages/cli/src/main.ts`. The wrapper
still sets `KB_PKG_ROOT`; `paths.ts` gained a single `UI_ROOT` statement
(`$KB_PKG_ROOT/packages/ui`) that both `UI_DIST` and the `kb ui` dev-server
root now read, replacing two independent `join(KB_PKG_ROOT, "ui")` sites.

FOD hashes:

| Derivation | Old | New |
|---|---|---|
| `kb-cli-js` | `sha256-xH5MWLjClFD8wkPPOYNmUIu/x/FJJbVXOEf/6AgnLfk=` | `sha256-8SvezBj2fh5lh9MKkUOgkV/EDKaoO6LG+gvWvm0oA+Q=` |
| `kb-ui-dist` | `sha256-HSLgAbMWQSa8BIuOFlvEffztRs6HSSLnAKUIYG1T93E=` | _see below_ |

STATUS: pending — the final `kb-ui-dist` hash and the `result/bin/kb
--version` smoke are filled in by the last commit on the branch.

## 13. Gaps (text for `r2` to file as `#gap` nodes)

1. **`bunFileSystemLayer` lives inside `@kb/store-jsonl`.** It is a platform
   binding, not part of the JSONL adapter, and every backend package above
   reaches for it. Its own package (`@kb/platform-bun`) would need
   `infrastructure → infrastructure`, which the D11 matrix does not allow —
   the only layer other than `extension` and `tooling` that forbids its own
   row. Either allow same-layer infrastructure edges (every other layer has
   one) or accept that the store package owns the platform Layer.

2. **`@kb/ext-canvas` stamps `updatedAt` from the wall clock and then
   persists.** `nowIso()` is called directly in
   `packages/ext-canvas/src/index.ts`, so a seeded replay of a canvas write
   diverges. This was invisible before w1: the determinism guard scanned
   `src/**` and `extensions-bundled/` sat outside it. The guard now scans every
   store-reachable package and carries this file as a documented, named bypass
   with the reason attached. Closing it means threading the Effect clock
   through the extension contract.

3. **`.kb/queries/*.edn` IO uses `node:fs/promises` directly from
   `@kb/operations`.** `saved-query.ts` is a second store with no port: no
   `SavedQueryStore` tag in `@kb/contracts`, no adapter in infrastructure, no
   way to fake it in a test. It sits in the application layer because moving it
   to infrastructure would violate the matrix (§3) — which is the matrix
   correctly pointing at a missing seam.

4. **`bunfig.toml minimumReleaseAge` is asserted but not observed.** Bun
   1.3.14 installed a version published ~1 day before the run. The harness
   checks the setting exists; nothing checks Bun honours it. Re-measure on a
   Bun upgrade, or drop the setting and say so.

5. **`linker = "isolated"` not adopted.** Left hoisted (§5). The `three`
   incident shows the tree still has undeclared transitive imports that only a
   clean build surfaces; the ui toolchain is the risky part. Flip it in a wave
   that can iterate on `vp build` + Storybook.

6. **`@kb/ui`'s `@/*` self-alias is still declared twice** — in
   `packages/ui/tsconfig.json` and `packages/ui/vite.config.ts` (and
   `.storybook/main.ts` repeats the vite half). The four `@kb/*` alias maps are
   gone; this one intra-package alias remains hand-synced. Collapsing it means
   rewriting ~89 files to relative imports, or moving to a package `imports`
   field (`#*`) that TS, Vite and Storybook all read from `package.json`.

7. **`@kb/operations` is 2310 LOC in one layer** — `actions.ts` alone is the
   bulk. The package boundary is honest, but "one concept per package" is
   thinner here than elsewhere. A later wave should ask whether node actions,
   asset actions, docs and render are really one concept.

8. **`@kb/harness` and `@kb/render-tests` declare `"exports": {}`.** That is a
   deliberate statement ("no importable surface") rather than an omission, and
   `public-surface` enforces the distinction. Worth revisiting if either grows
   something another package needs.

## 14. Not done in this wave

- `fmt:check` and the formatter gate: `g2` owns them (`vp fmt --check` reports
  77 + 180 files of drift at base; one format-only commit is a `g2` step and
  would have made every diff in this wave unreadable).
- Every oxlint rule promotion, the ratchet lanes, `@effect/tsgo`, the
  `tsconfig.base.json` strictness increases, and the remaining nine harness
  checks: all `g2`. `w1` wrote the base with **today's** flags only, and
  `@kb/ui` records `noUncheckedIndexedAccess: false` /
  `noImplicitOverride: false` as deltas so its behaviour is unchanged — those
  two lines are `g2`'s first deletion (2 + 6 sites, matching
  `measurements.md` §1).
- The `CLAUDE.md` pointer to `node_modules/effect/AGENTS.md` (D6's other half)
  and all `#rule`/`#gap` nodes: `r2`. Nothing in this wave wrote to
  `.kb/nodes.jsonl`.
