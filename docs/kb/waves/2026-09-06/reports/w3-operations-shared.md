# w3 — the actions run anywhere

Branch `feature/w3-operations-shared`, base `main` @ `c560019` (w1, w2), merged
`main` @ `aa6ee7e` (w4) before closing. Five commits:

| commit | subject |
|---|---|
| `7f3c6b2` | `feat(kb): EffectStore.fingerprint; the session forgets the filesystem` |
| `9c1f662` | `feat(kb): SavedQueries, Views, Assets ports; workspace-fs adapter` |
| `b276f97` | `refactor(kb): extension discovery is the runtime's` |
| `38a259b` | `feat(kb): operations is scope:shared; the shared preset has no Bun` |
| `74ee03b` | `merge: main (w4) into w3-operations-shared` |

`bun run verify`, `bun test packages` (382 pass / 1 skip) and `bun run test:ui`
(631 pass) are green on the merge commit.

## Acceptance

| check | result |
|---|---|
| `grep -rn "node:\|Buffer\." tools/kb/packages/application` | no import and no `Buffer` use; the remaining hits are the literal `node:` inside zod keys (`node: z.unknown()`) and one comment naming `node:path`'s `extname` |
| `grep -rn "FileSystem" .../operations/src` | empty |
| harness boundaries with `@kb/operations` on `scope:shared` | green |
| `index-rebuilds.test.ts` | green (unchanged by w3; w4 edited it) |
| `bun run verify` / `bun test packages` / `bun run test:ui` | green |

## The action inventory, after

Twelve core actions. "Isomorphic" means the handler's requirement channel names
only `KbCtx` / `KbStore` / `KbIndexService` — services a browser session can
supply from its own store and index without a filesystem anywhere.

| action | requires | class |
|---|---|---|
| `node.get` | `KbCtx` | isomorphic |
| `ontology.members` | `KbCtx` | isomorphic |
| `graph.query` | `KbIndexService` | isomorphic |
| `graph.search` | `KbIndexService` | isomorphic |
| `node.add` | `KbCtx \| KbStore` | isomorphic |
| `node.update` | `KbCtx \| KbStore` | isomorphic |
| `field.define` | `KbCtx \| KbStore` | isomorphic |
| `tag.define` | `KbCtx \| KbStore` | isomorphic |
| `graph.run` | `KbCtx \| SavedQueries` | port-backed |
| `render.view` | `KbCtx \| SavedQueries \| Views \| TemplateRegistry` | port-backed |
| `render.views` | same | port-backed |
| `asset.upload` | `Assets` | port-backed |

Nothing is server-only any more. Extension **discovery** still is, but it is no
longer an action or an operations concern: it is `@kb/runtime`'s.

Bundled extensions (`@kb/ext-docs`) stay `scope:backend` on purpose —
`docs.materialize` writes markdown to arbitrary repo paths, which is a
`FileSystem` job and not a `.kb/` port.

## Every symbol that moved

**`@kb/operations` → `@kb/contracts` (`src/workspace.ts`, new)**

- `isValidSavedQueryName` → `isValidWorkspaceName`. Deviation from the brief,
  which said it stays in operations. It could not: the `SavedQueries` adapter
  needs the same grammar to skip a directory entry it can never address
  (`listSavedQueries` has always dropped `has space.edn`, `-bad.edn`,
  `.dot.edn`), and `infrastructure` may not reach `application`. Two copies of
  one regex is drift, so the grammar moved to the module that owns the ports.
  It also collapsed a real duplicate: `docs/views.ts` carried the same regex
  inline for view names.
- New: `SavedQueries` / `SavedQueriesPort`, `Views` / `ViewsPort`,
  `Assets` / `AssetsPort`. `SavedQueriesPort.list` returns the existing
  `SavedQuery` (`{name, edn}`) from `protocol.ts` rather than a second
  spelling of it.
- `ActionHandlerEnv` gains `SavedQueries | Views | Assets`.

**`@kb/contracts` `src/store.ts`**

- New `StoreFingerprint` and `EffectStore.fingerprint`. `StoreFingerprint` is
  `string`, not the brief's `{size, mtimeMs}` record: the brief's own
  requirement is that it be opaque to callers, and a string makes "is this the
  store I last saw?" a `===`. `JsonlStore` builds it from size and mtime, so
  the evidence is exactly what the brief describes.

**`@kb/operations` → `@kb/workspace-fs` (new, `scope:backend`, `infrastructure`)**

- `resolveSavedQueryFile`, `readSavedQuery`, `saveSavedQuery`,
  `deleteSavedQuery` → `savedQueriesLayer(root)`.
- `docs/views.ts`'s `viewsDir` + directory listing + file read → `viewsLayer(root)`.
- `assets.ts`'s `assetsDir`, `resolveAssetFile`, the `.kb/assets` write →
  `assetsLayer(root)` plus `src/paths.ts` (the read-side resolver the server
  still needs for `GET /assets/*`).
- `graphRunEffect`'s `isFsNotFound` → `src/errors.ts` `isNotFound`.

**`@kb/operations` → `@kb/runtime`**

- `discoverExtensions`, `namespacedId` (`src/extension-loader.ts`, moved whole).

**`@kb/operations` internal**

- `session.ts`: `StoreStamp`, `stampOf`, `same` deleted; `noteStoreSynced`
  drops its `path` argument and reads the store through `KbStore` like its two
  siblings.
- `assets.ts`: `Buffer.from(b64, "base64")` → `Uint8Array.fromBase64`;
  `node:path`'s `extname` → a pure `extOf`.
- `docs/views.ts`: the `output` refinement's `isAbsolute`/`normalize` → a pure
  `isRepoRelative` (stricter: it rejects any `..` segment rather than
  normalising it away first).
- `src/saved-query.ts` deleted (nothing left in it).

**Consumers updated (mechanical)**

`runtime/src/{layers,registry,index}.ts`, `server/src/{saved-queries,assets}.ts`,
`ext-docs/src/index.ts`, and four test files
(`runtime/tests/{assets,native-actions,persistence}.test.ts`,
`cli/tests/ext-sdk-fresh.test.ts`).
`server/tests/saved-query-names.test.ts` was split: the name grammar, the path
resolution and the port CRUD now live in
`packages/infrastructure/workspace-fs/tests/workspace-ports.test.ts`, and the
server file keeps only what `GET /api/queries` promises.

`server/src/saved-queries.ts` lost its own copy of the listing loop —
`listSavedQueriesEffect(root)` is now `SavedQueries.list` bound to `root`, with
the same `Effect<…, never, FileSystem>` signature so `server.ts` and `http.ts`
(w4's files) are untouched.

## What the iso preset caught

`tools/kb/tsconfig.iso.json` is `tsconfig.base.json` plus `types: []` and
`lib: ["ESNext", "WebWorker"]`. Two decisions worth stating:

- **`lib` is the worker globals, not DOM and not bare ESNext.** Bare `ESNext`
  rejects `TextEncoder`, which `asset.upload` legitimately needs and every kb
  runtime has; adding `DOM` would type `document` in code that also runs on the
  server, trading one hole for another. `WebWorker` is the intersection:
  `TextEncoder`, `URL`, `fetch`, `crypto`, `atob`, `Uint8Array.fromBase64` —
  and `document`, `process` and `Buffer` are all errors. Verified by probe.
- **`tsconfig.bun.json` extends it** rather than repeating target / module /
  moduleResolution / noEmit / the Effect plugin. That keeps the harness's "the
  Effect language service plugin block is authored exactly once" true with the
  block in `iso`, so a shared package still gets the Effect diagnostics — the
  brief's literal "extends the base" would have silently dropped them for every
  `scope:shared` package.

**What it caught in operations: nothing.** By the time the preset was switched,
commits 2 and 3 had already removed every leak (`Buffer.from`,
`extname`/`isAbsolute`/`normalize`/`join`, `pathToFileURL`, `FileSystem`). The
red-case probe confirms the fence bites: adding
`Buffer.from("x").length + process.pid` to `operations/src/assets.ts` fails
typecheck with `TS2591` on both names.

**What it caught elsewhere: the test-project split.** A `scope:shared` package's
`tests/` import `bun:test`, which `types: []` cannot resolve, so shared packages
grew a second project. The first attempt put it at `<pkg>/tsconfig.tests.json`
and `bun run lint` went red with six findings in `@kb/model` and `@kb/query`
tests — findings that only appear when `noUncheckedIndexedAccess` is *not*
applied. The type-aware linter resolves a file's options by walking up to the
nearest `tsconfig.json`, and a sibling `tsconfig.tests.json` is invisible to
that walk: those tests would have been linted with no strictness contract at
all. The project therefore lives at `<pkg>/tests/tsconfig.json`, and
`constraints.ts` says why.

Harness changes: `RUNTIME_PRESET_BY_SCOPE.shared` → `tsconfig.iso.json`; new
`ISO_PRESET`, `TESTS_TSCONFIG`, `TEST_PRESET`; `typecheckProjects()` discovers
projects from the tree so no gate assumes one config per package;
`tsconfigChain()` / `hasEffectDiagnostics()` walk `extends` instead of comparing
a filename (the ratchet's "which projects emit Effect diagnostics" question
would otherwise have silently narrowed to shared packages only). Two new red
cases in `tsconfig-contract`: a shared package on the Bun preset, and a tests
project in the wrong place. The lint-warn baseline did **not** need
regenerating.

## `@kb/ext-sdk` stays `scope:backend`

The brief allowed either. `src/emit.ts`'s `node:path` is not the only reason:
`scripts/generate.ts` is inside the package's typecheck project and is
inherently a build tool (it spawns `tsc`, reads the workspace, imports
`node:child_process`). Retagging would mean splitting the generator out of its
own project for a capability nothing wants — after commit 3, ext-sdk's only
consumers are `@kb/runtime` and `@kb/cli`, both apps. Note the brief's premise
was wrong on one point: `scripts/generate.ts` does not import `emit.ts`;
`writeSdkDts`'s only consumer is `cli/src/cli.ts`.

## What w5 needs to build a browser `KbContext`

`KbContext` is `{ root, store, index, log, nodes }`. In the browser:

- **`store`** — a `BrowserStore implements EffectStore`: `path` (any stable
  string), `loadEffect`, `commitEffect`, and now `fingerprint`. Returning
  `Effect.succeed(null)` from `fingerprint` is correct and safe for an in-memory
  store — null compares equal to nothing, so `reloadEffect` always goes to the
  port. A store that can answer cheaply (an IndexedDB revision counter) should,
  and `reloadEffect` becomes a no-op again.
- **`index`** — w2's `DatascriptIndex`, already there.
- **`log`** — w4's `MemoryTxLog`, already isomorphic (`@kb/tx-log` is
  `scope:shared`; this wave moved it onto the iso preset).
- **`root`** — still a `string` on `KbContext`, and nothing in operations reads
  it for a path any more. `graph.run` and `render.view` read `ctx.root` never;
  only the adapter Layers take a root. A browser session can pass anything.

The browser runtime Layer is `kbRuntimeLayer`'s shape minus `FileSystem`:

```
KbCtx, KbStore, KbIndexService, TemplateRegistry   — same as the server
SavedQueries, Views                                — needed, must be implemented
Assets                                             — only for asset.upload
```

Concretely, w5 needs:

1. **A `SavedQueries` implementation.** `graph.run` and every `savedQuery`-backed
   view go through it. The obvious browser adapter is the WS/HTTP surface:
   `list` is `GET /api/queries`, `read(name)` is a lookup in that list. Note the
   plan's recorded gap — saved queries are virtual nodes in the snapshot but not
   in tx frames, so a `since(rev)` resync will not see a `/api/queries` change.
2. **A `Views` implementation**, or a decision that `render.view` is
   server-only in the browser session and the UI keeps calling `/api/action`
   for it. `Views.load` returns the spec's *source text*; all parsing,
   validation and `DocsError` mapping is already isomorphic and stays in
   operations.
3. **Nothing for `Assets`** unless the UI wants a local `asset.upload`. It
   writes bytes; the browser has nowhere sensible to put them, so the honest
   move is to leave `asset.upload` to the server and not provide the Layer —
   an unprovided service is a type error at the composition root, which is the
   right failure.
4. **A `TemplateRegistry`.** The server builds it from `registryFor(root)`,
   which discovers `.kb/extensions` — server-only. A browser session should
   provide `templateRegistryLayer(new Map(coreTemplates))` from the bundled
   extensions only.

The registry itself (`runtime/src/registry.ts`) is still `layer:app` and pulls
in `discoverExtensions`; w5 will want the action table without the discovery. It
is one `coreActions` array and a merge — splitting it is a small, contained job,
not a redesign.

## Notes for the coordinator

- **Files touched outside the brief's list, all forced and mechanical:**
  `harness/src/{scopes,snapshot,workspace}.ts` (the preset name and the
  one-project-per-package assumption live there, not in `constraints.ts`),
  `nx.json` (`sharedGlobals` must name the new preset or Nx caches across a
  preset change), four test files that import moved symbols, and
  `packages/{domain/model,domain/query,domain/canvas,contract/contracts}`
  `tsconfig.json` + `package.json` (every `scope:shared` package has to move
  presets together). `tsconfig.bun.json` is also mine now.
- **`tools/kb/bun.lock`** carries one hunk that is not mine: w2 removed
  `datascript` from `@kb/ui`'s dependencies without refreshing the lockfile, and
  my `bun install` swept it up.
- **`SavedQueries.write` / `.remove` have no production caller** — they had
  none before this wave either (`saveSavedQuery` / `deleteSavedQuery` were
  exercised only by a test). I implemented them because the brief specifies the
  port that way and w5's UI is the obvious consumer, but by Rule 1 they are a
  dead seam today. Worth a decision: wire them to a `POST/DELETE /api/queries`
  in w5, or delete them.
