# t2-harness-root — the harness is root tooling, not a workspace package

Wave `t2` of `docs/kb/waves/2026-09-04/plan.md`. Branch
`feature/t2-harness-root`, five commits on top of a merge of `main` (t1 at
`a821ecc`, merged clean — git's rename detection carried t1's edits to
`constraints.ts` and `version-authored-once.test.ts` onto the moved paths).

```
3cba561 refactor(kb): move the harness to tools/kb/harness as root tooling
239f437 Merge branch 'main' into feature/t2-harness-root
acfcf1f refactor(kb): delete the tooling matrix row and its special cases
e146f1f feat(kb): parse imports instead of regex-scanning them
08d5630 refactor(kb): read bunfig.toml as data, not as text
7d74925 refactor(kb): read barrels with the parser, not line patterns
```

The last two are the coordinator's addendum ("owner dislikes regex parsing
structured input in the harness"), kept separate from the briefed three so the
briefed scope stays legible.

## 1. What moved

`tools/kb/packages/harness/` → `tools/kb/harness/` with `git mv`, keeping
`src/`, `tests/` and `lint-warn-baseline.json`. It is no longer a workspace
member:

| Was | Is |
|---|---|
| `packages/harness/package.json` (`@kb/harness`, `layer:tooling`/`scope:tooling`) | deleted — not a member, so no manifest and no tags |
| `packages/harness/tsconfig.json` `extends: "../../tsconfig.bun.json"` | `harness/tsconfig.json` `extends: "../tsconfig.bun.json"`, `include: ["src", "tests"]` |
| typechecked by `nx run @kb/harness:typecheck` | typechecked by `nx run kb-workspace:typecheck`, a root `tools/kb/project.json` with `"command": "tsc --noEmit -p harness/tsconfig.json"` and `default` inputs |
| typed by its own `@types/bun` devDependency | typed by the root one; nothing added |
| `lint: "oxlint … packages"` | `lint: "oxlint … packages harness"` |
| `fmt` / `fmt:check`: `vp fmt packages [--check]` | `vp fmt packages harness [--check]` |
| `harness: "bun test packages/harness"` | `harness: "bun test harness"` |
| `harness:snapshot: "bun packages/harness/src/snapshot.ts"` | `bun harness/src/snapshot.ts` |
| `.oxlintrc.json` test-file override `packages/harness/**` | `harness/**` |
| `knip.json` workspace block `packages/harness` | root workspace `"."` with entries `harness/tests/*.test.ts`, `harness/src/snapshot.ts` |

`nx.json` `sharedGlobals` needed no change: the root project's `default` inputs
are `{projectRoot}/**/*` with `projectRoot` = `.`, which already covers
`harness/**`.

`lint-scope-coverage` needed no parser edit — it splits `scripts.lint` on
whitespace and takes the positionals, so `harness` became a scope by
construction.

`pkgs/kb/default.nix` filters `tools/kb` with `lib.cleanSourceWith` on
**basenames** only (`node_modules`, `dist`, `.source-hash`), so the moved
directory is picked up like any other. Nothing to change there. The UI FOD's
`outputHash` describes the built SPA, which the move does not touch.

## 2. Every special case deleted

Paths are `tools/kb/` relative, line numbers at `68f7e73` (the branch point).

| Site before | What it was | Now |
|---|---|---|
| `packages/harness/src/constraints.ts:31` | `LAYER_ALLOWS.tooling: []` | deleted |
| `packages/harness/src/constraints.ts:39` | `SCOPE_ALLOWS.tooling: []` | deleted |
| `packages/harness/src/constraints.ts:94` | `RUNTIME_PRESET_BY_SCOPE.tooling` | deleted |
| `packages/harness/src/constraints.ts:18-19` | docblock bullet claiming the harness's own row | replaced by one saying there is no `tooling` row and why |
| `packages/harness/src/snapshot.ts:51-57` | `toolingPackageDirs()` | deleted |
| `packages/harness/src/snapshot.ts:69,83` | `toolingDirs` parameters on `countsTowardRatchet` / `tsgoDiagnosticCounts` | deleted; both take only what they measure |
| `packages/harness/src/snapshot.ts:44,77` | `PACKAGE_SRC_FILE` capturing the package dir, so the dir could be tested against the tooling set | non-capturing: `countsTowardRatchet` keeps only the `src/` rule |
| `packages/harness/src/workspace.ts:206-211` | `srcGlobsForScope(scope)` | deleted |
| `tsconfig.bun.json:62-64` | Effect override `exclude: ["packages/harness/src/**/*"]` | deleted; `include: ["packages/*/src/**/*"]` alone excludes a checker that lives outside `packages/` |
| `packages/harness/tests/ratchet-scope.test.ts:24,41-49` | `toolingFile` fixture and the `scope:tooling` case | deleted — its subject was a workspace package tagged `scope:tooling` |
| `packages/harness/tests/tsconfig-contract.test.ts:303-306` | `expect(override?.exclude).toEqual(srcGlobsForScope("tooling"))` | `expect(override?.exclude).toBeUndefined()` — "the include is the whole scope; a carve-out would be a second list" |
| `packages/harness/tests/boundaries.test.ts:2` | `import { present } from "../../model/src/present.ts"` | `../src/present.ts`, a local copy |
| `packages/harness/tests/determinism-seam.test.ts:2` | the same product import (not named in the brief; found by the new fence) | same fix |
| `packages/harness/tests/determinism-seam.test.ts:33` | `const PACKAGES_ROOT = join(import.meta.dir, "..", "..")`, a second derivation of a constant `workspace.ts` already owns | imports `PACKAGES_ROOT` |

**Deviation from the brief's commit split.** The brief put the `ratchet-scope`
tooling case, the `tsconfig-contract` exclude assertion and `srcGlobsForScope`
in commit 2. They are in commit 1, because the move is what removes their
subject: with no workspace package tagged `scope:tooling`, `toolingPackageDirs()`
returns the empty set and `srcGlobsForScope("tooling")` returns `[]`, so those
three assertions go red the moment the directory moves. Commit 1 could not be
green otherwise. Commit 2 then deletes the rows and functions that nothing reads
any more.

### Two things the brief did not list, both required by the move

- **`boundaries` asked every Nx project for tags.** The new root project
  `kb-workspace` is a project and is not a workspace member, so "every project
  carries exactly one layer and one scope tag" would have failed on it. The tag
  map is now built from graph nodes whose `data.root` starts with `packages/`:
  the two axes describe members, which is the same statement commit 2 makes by
  deleting the `tooling` row.
- **The ratchet collector held a second copy of the lint scope**
  (`snapshot.ts:114`, `"… --type-aware packages --format json"`) and iterated
  `workspacePackages()` for tsgo. After the move both were wrong in the same
  direction — they measured `packages/` while `bun run lint` and
  `nx run-many -t typecheck` had grown `harness`. `harness/`'s own diagnostics
  would have left the ledger silently. Both now read the authored source:
  `oxlintCommand()` runs the root `lint` script itself, and the tsgo loop walks
  `typecheckProjectDirs()`.

### New gate

`boundaries` gains **"no harness file imports product code"**: no specifier
under `harness/` starts with `@kb/`, and no relative specifier resolves outside
`HARNESS_ROOT`. The checker stays outside the thing it checks, which is the
property that made the `tooling` row unnecessary in the first place.

### kb `#rule` nodes

`bun tools/kb/packages/cli/src/main.ts search "harness" --json` returns two
nodes, neither a `#rule`. Grepping `.kb/nodes.jsonl` for `packages/harness`
returns nothing: every `#rule` `gate` names a check by name ("harness
boundaries over nx graph (w1)", "harness lint-warn-ratchet (g2)", …), not a
path. Nothing to update, and `docs/kb/rules.md` is unchanged — `docs.check`
passes in pre-commit on all five commits.

## 3. The parser

`ts.preProcessFile` was the brief's first choice and **is not available**. The
installed `typescript` is `7.0.2` (catalog), whose native port exports exactly
three names:

```
$ bun -e 'import * as ts from "typescript"; console.log(Object.keys(ts))'
[ "default", "version", "versionMajorMinor" ]
```

So `oxc-parser@0.148.0`, added to the catalog and to the root
`devDependencies` as `catalog:` — `version-authored-once` caught the literal
version on the first try, which is the gate doing its job:

```
error: root devDependencies.oxc-parser = 0.148.0
```

`specifiersOf(file, source)` reads the module record: `staticImports` (which
includes side-effect imports), every `staticExports` entry that carries a
`moduleRequest` (`export … from` in all its forms), and `dynamicImports` whose
argument is a quoted literal. A parse error throws with the filename rather
than reporting an empty import list. `stripComments` is gone — a comment cannot
produce a module record entry.

`require()` is absent from the module record and stays absent: the workspace is
ESM (`"type": "module"`), and `grep -rn 'require(' packages harness` over
`.ts`/`.tsx` returns nothing.

`importSites()` and `importEdges()` keep their signatures.

**Rejections recorded in DESIGN.md** next to the fence paragraph:
dependency-cruiser and `@nx/enforce-module-boundaries` both take path-pattern
rules, which would mean generating a mirror of the tag matrix — the thing
`4b63dff` removed.

New `harness/tests/import-graph.test.ts`: six cases covering the side-effect
import, `export … from`, every other form the workspace can write, comments and
strings, a computed dynamic import, `.tsx`, and a parse error.

## 4. Red cases

### A. A harness file importing product code

Appended to `harness/src/present.ts`:

```ts
import { present as _q } from "../../packages/model/src/present.ts";
```

```
error: harness/src/present.ts imports ../../packages/model/src/present.ts, which resolves outside harness/
(fail) boundaries > no harness file imports product code
 6 pass, 1 fail
```

A bare `import "@kb/model"` from `harness/` never even reaches the assertion —
Bun cannot resolve it, because the harness is no longer a workspace member:
`error: Cannot find module '@kb/model' from …/harness/src/present.ts`. The test
covers the case anyway, since a checker that grew a `node_modules` link should
still fail loudly rather than resolve.

### B. A side-effect import crossing the fence

Appended to `packages/model/src/present.ts`:

```ts
import "@kb/store-jsonl";
```

```
error: @kb/model (layer:domain) -> @kb/store-jsonl (layer:infrastructure)  [model/src/present.ts]
@kb/model (scope:shared) -> @kb/store-jsonl (scope:backend)  [model/src/present.ts]
(fail) boundaries > every cross-package import satisfies both axes of the matrix
```

The old scanner saw nothing there. Side by side on the same two lines:

```
old regex sees: ["@kb/reexport"]
parser sees:    ["@kb/store-jsonl","@kb/reexport"]
```

### C. A wrapped `export * from` in a barrel

Appended to `packages/canvas/src/index.ts`:

```ts
export *
  from "./doc.ts";
export { present } from "@kb/model";
export * as ok from "./doc.ts";
```

```
error: canvas/src/index.ts: export * from "./doc.ts"
(fail) public-surface > no barrel re-exports a whole module
error: canvas/src/index.ts: re-exports from "@kb/model"
(fail) public-surface > no barrel re-exports another package's symbols
 1 pass, 2 fail
```

The `export * as ok from` correctly does not fire. The line pattern this
replaced saw none of it — `old star regex hits: []` — because the statement is
wrapped. That rule could be broken by pressing enter.

## 5. Which regexes remain in the harness, and why each is a marker

Every remaining pattern matches a **lexical marker or a path shape**, not a
grammar. Nothing in the harness parses TypeScript, TOML, or JSON with a regex
any more.

| Site | Pattern | Why it is a marker |
|---|---|---|
| `src/constraints.ts:47` | `RUNTIME_ONLY_SPECIFIERS = /^(bun:\|node:\|@effect\/platform-bun)/` | a specifier **prefix** test applied to a specifier the parser already produced |
| `src/constraints.ts:60` | `tests/`, `tests-render/`, `.test.tsx?$` | path globs, the same file classes `.oxlintrc.json` uses |
| `src/import-graph.ts:25` | `QUOTED = /^(['"])(.*)\1$/s` | one quoted-literal test over a span the parser handed us, to reject a computed `import(expr)` |
| `src/import-graph.ts` (`importEdges`) | `/^@kb\/[a-z0-9-]+$/` | a package-name shape test over a parsed specifier |
| `src/scopes.ts` (`assignToScopes`) | `.replace(/\/$/, "")` | trailing-slash trim on a path |
| `src/scopes.ts` (`typecheckScopes`) | `/[*?[\]]/` | "does this `include` entry contain a glob character" — the reader is a prefix matcher and **refuses** rather than approximating |
| `src/snapshot.ts:45` | `PACKAGE_SRC_FILE` | a path shape (`packages/<x>/src/`) |
| `src/snapshot.ts` (`normalizeRuleName`) | `/^([^()]+)\(([^()]+)\)$/` | oxlint's own diagnostic label form `plugin(rule)`; a fixed two-field token, not a language |
| `tests/boundaries.test.ts` | `/^[^/]+\/src\//` | path shape |
| `tests/gap-markers-resolve.test.ts`, `tests/skip-pairing.test.ts` | `GAP [[id]]`, `test\|describe\|it . skip\|todo`, `\.(ts\|tsx\|js\|jsx)$` | the marker patterns the addendum explicitly leaves alone |
| `tests/lint-scope-coverage.test.ts` | `lintScript.split(/\s+/)` | shell word-splitting of a script string; no shell parser is in the dependency set, and the scopes are plain positionals |
| `tests/scripts-chain-exists.test.ts` | `(?:bun\|npm\|pnpm\|yarn)\s+run\s+(…)` | same: a marker inside a shell command string |
| `tests/version-authored-once.test.ts` | `/^npm:@voidzero-dev\/vite-plus-core@(.+)$/` | npm alias specifier `npm:<pkg>@<version>` — a fixed two-field form with no parser available; inherited from t1 and left as it stands |

The two shell-string cases are the only ones where a real parser would be an
improvement and none is on hand. Both read a *marker inside* a command line
(`bun run <name>`, and the positional scopes), not the command's grammar, and
both feed an assertion that fails loudly when the shape changes. Flagging in
case the owner wants them closed in a later wave.

## 6. Gate results

```
$ bun run verify                       # typecheck + lint + fmt:check + knip + harness
57 pass, 0 fail  (17 files)            exit 0
$ bun test packages
328 pass, 0 fail  (40 files)
$ bun run typecheck
Successfully ran target typecheck for 17 projects   # includes kb-workspace
$ bun run harness:snapshot
2 blocking rules, 0 advisory rules     # no ledger change
```

The ledger is byte-identical across all five commits, including after the
oxlint scope grew `harness` and the tsgo loop started visiting it: neither
produces a warning.

`bun test packages` flaked once early on (327/1) and then ran clean five times
in a row; the failure never reproduced and did not name a test. Not investigated
further.

Acceptance greps:

- `git grep -n tooling tools/kb/harness tools/kb/DESIGN.md tools/kb/tsconfig.bun.json`
  — `tsconfig.bun.json` is clean. `DESIGN.md` keeps the "Runtime/tooling
  boundary" heading and two pre-existing prose lines, plus new prose that says
  the harness is *root tooling* and that there is no `tooling` row.
  `harness/` has three comment lines using the word in that same sense. No tag,
  no matrix row, no glob.
- `git grep -n 'packages/harness'` — only `docs/kb/waves/2026-09-03/**`, the
  `2026-09-04` briefs and plan, and t1's report. All historical records.

### knip

No new **findings**. One new **configuration hint**:

```
harness/src/snapshot.ts    knip.json  Remove redundant entry pattern
```

Kept deliberately: `harness/src/snapshot.ts` is a real entrypoint (`bun run
harness:snapshot`), and it is only "redundant" because a test happens to import
it today. Dropping it would make knip flag the file the moment that stops being
true.

`vite` shows as an unused root devDependency. That is on `main` already (t1
`f6f7227` moved the vite alias into the catalog); not introduced here and not
touched.

## 7. For t3 (layer folders): every site that assumes `packages/<dir>`

`WorkspacePackage.dir` is a **directory name** and `@kb/<name>` is derived from
it by string concatenation in three places. When a package moves under a layer
folder, `dir` stops predicting the manifest name and each of these must read
`manifest.name` (or a `WorkspacePackage` field that carries it) instead.

**The derivation `@kb/${dir}` — the ones that actually break:**

| Site | What it does |
|---|---|
| `harness/src/import-graph.ts:129` | `const source = \`@kb/${dir}\`` — every import site's owning package name. This is the one that feeds `boundaries`, so it is the load-bearing site. |
| `harness/tests/workspace-shape.test.ts:38` | asserts `manifest.name === \`@kb/${dir}\`` — this **is** the rule that t3 changes, so it becomes "the manifest name is `@kb/<basename>`" or is dropped |

**The reader itself:**

| Site | What it does |
|---|---|
| `harness/src/workspace.ts:9` | `PACKAGES_ROOT = join(WORKSPACE_ROOT, "packages")` |
| `harness/src/workspace.ts` `packageDirs()` | one `readdirSync(PACKAGES_ROOT)` level; a layer folder makes this two levels, and it is the single place to fix |
| `harness/src/workspace.ts` `workspacePackages()` | `join(PACKAGES_ROOT, dir, "package.json")` |
| `harness/src/scopes.ts:85` | `typecheckProjectDirs()` → `packages/${dir}` plus `harness` — the workspace-relative directory of every `tsc -p` project |

**Callers that join `PACKAGES_ROOT` with `dir`** (all would follow a
`WorkspacePackage.dir` that became workspace-relative, and none needs its own
knowledge of the layout):

| Site | What it reaches for |
|---|---|
| `harness/src/import-graph.ts:130,132` | the package's source tree, and the package-relative `file` in every `ImportSite` |
| `harness/tests/workspace-shape.test.ts:30,49` | `package.json`, `tsconfig.json` |
| `harness/tests/tsconfig-contract.test.ts:223,266` | `tsconfig.json`, twice |
| `harness/tests/public-surface.test.ts:37,48` | `src/index.ts` |
| `harness/tests/determinism-seam.test.ts:61,63,78` | walks `PACKAGES_ROOT` itself with `readdir`, then `relative(PACKAGES_ROOT, file)` — **a second package walker**, independent of `packageDirs()`. t3 should collapse it into the reader rather than teach it about layer folders. |

**Not affected:** `snapshot.ts`'s `PACKAGE_SRC_FILE` matches
`packages/<anything>/src/` and a layer folder only adds a segment before the
package, so the pattern needs `packages/(?:[^/]+/)?<x>/src/` or, better, a
derivation from `typecheckProjectDirs()`. Flagging it here because it is the one
site where the assumption is inside a pattern rather than a `join`.
