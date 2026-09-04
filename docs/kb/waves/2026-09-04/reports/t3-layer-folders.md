# t3-layer-folders — packages live under their layer; the folder is the layer

Wave `t3` of `docs/kb/waves/2026-09-04/plan.md`. Branch
`feature/t3-layer-folders`, three commits on top of `585c17c` (the t2 merge).

```
dbe75e8 refactor(kb): delete the layer:* tags; the folder is the layer
3543fc1 fix(nix): refresh the kb fixed-output hashes
eb99356 refactor(kb): move every package under its layer folder
```

Three, not the briefed two. The extra one is the Nix hash refresh, kept
separate because it is **not** caused by the move: both fixed-output hashes
were already wrong on `main` (§5).

## 1. The mapping applied

`git mv` only; every package keeps its name, its `src/`, its history.

| Layer folder | Packages |
|---|---|
| `packages/domain/` | `model` `query` `canvas` |
| `packages/contract/` | `contracts` `ext-sdk` |
| `packages/infrastructure/` | `store-jsonl` |
| `packages/application/` | `operations` |
| `packages/extension/` | `ext-canvas` `ext-docs` |
| `packages/app/` | `runtime` `server` `cli` `mcp` `ui` `test-kit` |
| `packages/test-support/` | `render-tests` |

The folder names are exactly the `LAYER_ALLOWS` keys, and that is now the only
place the set of layers is written down.

## 2. Commit split, and why it is not the briefed one

The brief put the move in commit 1 and the tag deletion in commit 2, but also
put "no package declares a `layer:*` tag" in commit 1's `workspace-shape`
changes. Those two cannot both be commit 1: the assertion goes red until the
tags are gone.

So commit 1 is a genuinely behaviour-preserving move and `workspace-shape`
grows a **transitional bridge** instead — "every member sits in the layer
folder its `layer:*` tag names". That is the assertion which proves the move
put all sixteen packages where their tags already said they belonged, and it
is the one thing commit 2 deletes when it deletes the tags. A mirror exists for
exactly one commit, and a gate watches it while it does.

Commit 2 then deletes the tags and everything that deleting them forces (§4).

## 3. Every file touched

### The move itself (commit 1)

| File | Change |
|---|---|
| `tools/kb/package.json` | `workspaces.packages` → `["packages/*/*"]`; `test:dst`, `bench`, `gen:ext-sdk` re-pathed |
| 16 × `packages/*/*/tsconfig.json` | `extends` gains one `../` |
| `tools/kb/tsconfig.bun.json` | Effect override `include` → `packages/*/*/src/**/*` |
| `tools/kb/.oxlintrc.json` | the one ignore glob → `**/ext-sdk/generated/**` (no path, so no layer) |
| `tools/kb/bunfig.toml` | `pathIgnorePatterns` → `["**/packages/app/ui/**"]` |
| `tools/kb/knip.json` | 4 workspace keys + 3 `ignoreFiles` |
| `tools/kb/stryker.config.json` | command, `mutate`, `ignorePatterns` |
| `tools/kb/bin/kb` | → `packages/app/cli/src/main.ts` |
| `tools/kb/bun.lock` | 16 workspace path labels only (§6) |
| `.githooks/pre-commit`, `.github/workflows/validate.yml` | `docs-check.ts` path |
| `pkgs/kb/default.nix` | `cd packages/app/ui`, the `cp -a`, `bun build ./packages/app/cli/src/main.ts`, and both `$out/lib/kb/packages/app/ui` sites |
| `packages/app/server/src/paths.ts` | root climb `../../..` → `../../../..`; `UI_ROOT` → `packages/app/ui` — the wrapper's `$out/lib/kb/packages/app/ui/dist` and this agree |
| `packages/contract/ext-sdk/scripts/generate.ts` | `KB_ROOT` climb gains one `..`; its own path in three header strings |
| `packages/contract/ext-sdk/src/sdk-dts.text.ts` | regenerated (`bun run gen:ext-sdk`) — the embedded header names the generator |
| `packages/test-support/render-tests/tests-render/server.ts` | repo-root climb gains one `..` |
| `packages/app/cli/tests/ext-sdk-fresh.test.ts` | `node_modules/.bin/tsc` climb gains one `..` |
| `tools/kb/README.md`, `DESIGN.md`, `DESIGN-UI.md`, `DESIGN-RESKIN.md`, `AGENTS.md` | prose paths |

Four of those climbs (`paths.ts`, `generate.ts`, `server.ts`, `ext-sdk-fresh`)
are the sites a grep for `packages/<name>` does **not** find — they count
`..` segments instead of naming anything. Three surfaced as green-to-red test
failures; `server.ts` was found by reading.

`packages/app/ui`'s vite, storybook and vitest configs needed **no** change:
every path in them is derived from `import.meta.url`, and the `@/*` alias is
intra-package. `render-tests/playwright.config.ts` likewise — its paths are all
`./tests-render`-relative.

### The reader (commit 1)

`WorkspacePackage` gains two fields and `dir` changes meaning:

| Field | Was | Is |
|---|---|---|
| `dir` | directory name (`model`) | path under `packages/` (`domain/model`) |
| `layer` | — | first segment of `dir`; the folder *is* the layer |
| `name` | — | the manifest's `name` |

`packageDirs()` walks two levels; `layerDirs()` names the first. Every
`@kb/${dir}` derivation the t2 report listed now reads `name` —
`import-graph.ts:129` (the load-bearing one) and `workspace-shape`'s
name assertion, which becomes "`@kb/<basename>`".

`name` is a plain `string`, `""` when the manifest declares none. That is a
`workspace-shape` failure, and an empty name matches no import specifier and no
declared dependency, so every other gate goes red rather than quiet.

### Three sites that assumed the depth, restated rather than deepened

The brief's list had them all resolvable by counting one level further. Each
was instead stated in a way that stops knowing the depth:

| Site | Was | Is |
|---|---|---|
| `ImportSite.file` | packages-relative (`model/src/x.ts`), and the isomorphism fence tested `/^[^/]+\/src\//` | package-relative (`src/x.ts`); the fence tests `file.startsWith("src/")`. The owning package is already named by `source`. |
| `SANCTIONED_TSCONFIG_DELTAS` | keyed by directory name | keyed by package name (`@kb/ui`, `@kb/render-tests`) — the sanction is about the package and survives it moving |
| `tsconfig-contract`'s expected `extends` | literal `../../${preset}` | `"../".repeat(pkg.dir.split("/").length + 1)` — derived from the package's own path |

And `determinism-seam.test.ts`, which the t2 report flagged as **a second
package walker**, no longer walks `packages/` at all: it iterates
`workspacePackages()` and skips by name (`@kb/ui`, `@kb/render-tests`). Its
allowlist is `at("@kb/model", "src/model.ts")` — a package plus a
package-relative path — rather than `model/src/model.ts`, which under the new
tree would have read `domain/model/src/model.ts` and named the layer a second
time. Same reasoning made `lint-scope-coverage`'s derived-tree exclusions and
`datascript-shim-typechecks`'s shim location look their packages up in the
reader instead of spelling out a path.

Two more sites the brief flagged:

- **`snapshot.ts`'s `PACKAGE_SRC_FILE`.** The one place the assumption lived
  inside a pattern rather than a `join`. It is now
  `packages/[^/]+/[^/]+/src/` — two explicit segments, which is exactly what
  `workspace-shape` guarantees. Deriving it from `typecheckProjectDirs()` was
  rejected: `countsTowardRatchet` is a pure function over one diagnostic, and
  t2 had just finished removing its directory parameters.
- **`snapshot.ts:132`, `if (dir === "packages/ui") continue`.** Re-pathing this
  to `packages/app/ui` would have named a layer for no reason, so it was
  replaced by the reason it exists: the `@effect/language-service` block is
  authored in `tsconfig.bun.json` alone, so a project on any other preset emits
  no Effect diagnostic. `nonEffectProjectDirs()` derives the skip set from
  `RUNTIME_PRESET_BY_SCOPE` — the table that already knew — via a new
  `projectDirOf(pkg)` in `scopes.ts` that `typecheckProjectDirs()` also uses,
  so `packages/${dir}` has one derivation.

## 4. What happened to the Nx dependency

**The harness no longer spawns `nx graph` at all.** `src/project-graph.ts` is
deleted.

Measured, then decided. `boundaries` read the graph for two things:

1. **Tags.** Layer moved into the tree. Scope is one tag on a manifest the
   workspace reader already opens.
2. **`internalEdges(graph)`** — the manifest-edge check. t2's own measurement
   (recorded in `src/import-graph.ts`) is that Nx's dependency edges on this
   workspace are *manifest-derived only*: dropping `@kb/query` from
   `@kb/operations`' package.json removed the edge despite every file importing
   it. So that list is precisely the `@kb/*` entries `dependencyEntries()`
   returns — and `boundaries`' last test was **already** building exactly that
   set, by hand, from the manifests. Two derivations of one list. They are now
   one `declaredEdges()` helper, and the subprocess is gone.

Nothing else in the harness read the graph. Nx remains the task runner
(`nx run-many -t typecheck`, `nx affected`), and `nx.json`'s tags are still
consumed there.

Two assertions **left** `boundaries` rather than being ported:
"every project carries exactly one layer and one scope tag" and "every tag
value is one the matrix knows". With the graph gone, both would have read the
same manifests `workspace-shape` reads, to make the same claim it already
makes. `workspace-shape` owns what a package is; `boundaries` owns direction.
Coverage is unchanged — `workspace-shape` asserts one known scope tag, a known
layer folder, and no `layer:*` tag.

Measured effect: `bun run harness` **20.9s → 13.6s**, and the test count goes
57 → 57 (two deleted, one added, one split in two).

## 5. Nix

`nix build .#kb` was attempted and **succeeds**. Both fixed-output hashes
changed, and the interesting part is *why*, because it is not what the brief
expected:

| FOD | Recorded on `main` | Actual at the pre-move commit | Actual after t3 |
|---|---|---|---|
| `uiDist` | `sha256-rS/ZKsga…` | `sha256-A3QUQ19v…` | `sha256-A3QUQ19v…` |
| `cliJs` | `sha256-8SvezBj2…` | `sha256-cGU7EuI6…` | `sha256-LZZqPSX1…` |

Verified by building `.#kb` from a detached worktree at `585c17c`, the commit
this branch starts from.

- **Both hashes were already stale.** `nix build .#kb` was red on `main` before
  this wave touched anything. CI's `nix flake check` (the full-build step)
  covers `checks.kb`, so this is either a failing main or drift in something
  outside the FOD's declared inputs — the FODs run `bun install` and a `vp`
  build with the ambient `bun`, so a toolchain bump moves the output without
  moving any input Nix knows about. **Flagging for the owner**: that is a real
  fragility, not a t3 regression, and it is the second wave in a row where a
  Nix artifact's correctness was invisible locally.
- **The move does not change the SPA by a single byte** — `uiDist` hashes
  identically before and after. Good news for the brief's worry.
- **`cliJs` genuinely moves with t3**, and for a legible reason: the bundle
  inlines `sdk-dts.text.ts`, whose generated header string names
  `packages/contract/ext-sdk/scripts/generate.ts`.

`pkgs/kb/default.nix` carries a comment recording all of the above beside the
hashes. No `#gap` node: nothing was deferred, the hashes are correct for this
machine, and the fragility above is an observation for the owner rather than a
workaround I left in place.

Verified end to end: the built wrapper resolves the baked SPA at its new path
(`$out/lib/kb/packages/app/ui/dist` exists and `$out/bin/kb --version` prints
`0.1.0`).

`nix flake check --no-build` is green, including `checks.aarch64-darwin.kb`.
`nixfmt --check`, `statix check`, `deadnix --fail`, `shellcheck
.githooks/pre-commit` and `actionlint` all pass via `nix develop -c`.

> `deadnix --fail pkgs/kb/default.nix` on its own reports an unused lambda
> argument (`type` in the `cleanSourceWith` filter). Pre-existing — it does the
> same at `585c17c` — and CI's actual command,
> `deadnix --fail --exclude ./_sources/generated.nix .`, exits 0. Not touched.

## 6. `bun install --frozen-lockfile`

Fails on the move commit before the lockfile is committed, and succeeds after —
the workspace glob change *does* alter `bun.lock`, and here is exactly how much:

```
top-level keys equal:                        True
packages (third-party resolutions):          16 entries changed
workspace entries, keyed by manifest name:   identical
```

All 16 changed entries are of the form
`@kb/model@workspace:packages/model` → `@kb/model@workspace:packages/domain/model`.
Every non-workspace resolution is byte-identical, and every workspace member's
recorded manifest is identical once you key it by name instead of by path.
So: the lockfile records where a workspace member lives, and the members moved.

## 7. Acceptance

```
$ bun install --frozen-lockfile      no changes                     exit 0
$ bun run verify                     typecheck 17 projects · lint · fmt · knip
                                     57 pass, 0 fail                exit 0
$ bun test packages                  328 pass, 0 fail (40 files)
$ bun run test:ui                    631 pass, 0 fail (89 files)
$ bun run test:dst                   ALL 29 SEEDS GREEN
$ bun run --filter @kb/ui build      ✓ built in 1.29s
$ ./bin/kb --help                    prints the CLI usage
$ bun tools/kb/packages/app/cli/src/bin/docs-check.ts
                                     kb docs: clean (2 views)
$ nix build .#kb                     /nix/store/…-kb-0.1.0
$ nix flake check --no-build         green (checks.kb included)
$ bun run harness:snapshot           ledger byte-identical
```

**knip is byte-identical to the pre-move run** once package paths are
normalised — same 9 unused devDependencies, same 40 unused exports, same 18
unused types, same duplicate export, same 2 configuration hints. Verified by
running knip in a worktree at `585c17c` with its own `bun install` and diffing
the normalised output; the diff is empty.

The acceptance grep

```
git grep -n 'packages/\(model\|query\|…\|render-tests\)/'
```

returns nothing outside `docs/` and `tools/kb/bun.lock`. Inside `docs/` the
hits are wave records: `2026-08-*`, `2026-09-03/**`, and this wave's own
`2026-09-04` plan, briefs and t1/t2 reports — all written before the move.

> **One live document is now wrong**, and it is not a historical record:
> `docs/kb/waves/2026-09-04/briefs/t4-favicon.md` names
> `tools/kb/packages/ui/public/**`, `tools/kb/packages/ui/index.html`,
> `tools/kb/packages/ui/vite.config.ts`, `packages/ui/dist/favicon.svg` and
> `packages/server/src/assets.ts`. Whoever runs t4 needs `packages/app/ui/…`
> and `packages/app/server/…`. Left for the coordinator: t4's brief is not
> t3's to edit.

## 8. Red cases

### A. A package moved to `packages/misc/`

`git mv packages/domain/canvas packages/misc/canvas`:

```
error: not a layer: misc
(fail) workspace-shape > every directory under packages/ is a layer the matrix knows
 5 pass, 1 fail
```

and, because layer now comes from placement, the direction fence fails with it:

```
error: @kb/runtime (layer:app) -> @kb/canvas (layer:misc)  [tests/canvas.test.ts]
(fail) boundaries > every cross-package import satisfies both axes of the matrix
error: @kb/runtime (layer:app) -> @kb/canvas (layer:misc)  [manifest]
(fail) boundaries > every declared dependency satisfies both axes of the matrix
 3 pass, 2 fail
```

That second pair is the property the whole wave buys: moving a package is not a
rename, it is a change of what the package is allowed to import, and the gate
says so without anyone editing a tag.

### B. A package that still carries `layer:domain`

`"layer:domain"` restored to `packages/domain/model/package.json`, where it is
*correct* — the package really is in `domain/`:

```
error: domain/model: declares ["domain"]; the folder is the layer
(fail) workspace-shape > no member declares a layer tag
 5 pass, 1 fail
```

Agreeing with the folder is not a defence. A second copy is a second copy.

## 9. Anything that still names a layer twice

Nothing does, in code or config. The layer appears in exactly two kinds of
place, and neither is a duplicate of the other:

- the folder name under `packages/`, once per package;
- the `LAYER_ALLOWS` keys in `harness/src/constraints.ts`, which is the
  vocabulary those folder names are checked against.

Every candidate site the brief listed was closed rather than re-pathed: the
oxlint ignore glob, the tsgo ratchet skip, the determinism allowlist, the lint
scope exclusions, the datascript shim location, and the sanctioned-tsconfig
table.

The paths that *do* spell out a layer are all ones where the layer is not
being asserted, only located: `pkgs/kb/default.nix`'s build/install lines,
`bunfig.toml`'s Vitest split, `stryker.config.json`, `knip.json`'s workspace
keys, `bin/kb`, the two `docs-check.ts` invocations, and prose in
`AGENTS.md` / `DESIGN*.md`. Each of those names one specific package for one
specific reason and would have named it before the move too.

## 10. Loose ends

- **`bun run test:ui` flaked twice** in this wave: once at 2 failures / 631 and
  once at 1 / 631, both while another `bun` process was running concurrently on
  the same box. Six consecutive isolated runs are clean (631/631). The failing
  test names were not captured — the piped Vitest reporter output was truncated
  before I thought to keep the log — so this is reported rather than diagnosed.
  t2's report records a similar unreproduced one-off in `bun test packages`;
  two waves in a row is worth someone's attention even though neither
  reproduced.
- `.kb`'s open gap node `01M1P63E3Y5KVHV3XMM6TBV2BM` described its subject as
  "23 files under `packages/ui/src`". Updated to `packages/app/ui/src` and
  `docs/kb/rules.md` re-materialized: an open gap that names a path which no
  longer exists is drift in the drift record.
- `harness/src/present.ts` is now imported only by `determinism-seam`;
  `boundaries` used it to unwrap `manifest.name`, which `WorkspacePackage.name`
  makes unnecessary. Left in place — it is a general helper, and knip does not
  flag it.
