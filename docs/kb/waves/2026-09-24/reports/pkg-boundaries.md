# Package boundaries — investigation and tightening

Measured in the `tools/kb` workspace on 2026-09-26. The inventory below uses
`workspacePackages()` and the *source-derived* `importEdges()`; it does not
confuse Nx's manifest-derived graph with actual imports. Names in the last
two columns omit the common `@kb/` prefix. Test imports count, except the
special `@kb/test-kit` test-file allowance. A blank means no package edge.
All 22 packages carry exactly one `scope:*` tag and no `layer:*` tag; their
layer is their directory, not a manifest copy.

| Folder / package | `nx.tags` | Imports | Imported by |
| --- | --- | --- | --- |
| `app/cli` / `cli` | `scope:backend` | contracts, ext-check, ext-docs, ext-sdk, mcp, model, operations, runtime, server | — |
| `app/client` / `client` | `scope:backend` | contracts, model, query, runtime | — |
| `app/mcp` / `mcp` | `scope:backend` | contracts, model, operations, runtime | cli |
| `app/runtime` / `runtime` | `scope:backend` | canvas, contracts, ext-canvas, ext-check, ext-docs, ext-sdk, model, operations, plugin, query, store-jsonl, store-sqlite, tx-log, workspace-fs | cli, client, mcp, server, test-kit |
| `app/server` / `server` | `scope:backend` | contracts, model, operations, query, runtime, store-jsonl, workspace-fs | cli, render-tests |
| `app/test-kit` / `test-kit` | `scope:test-support` | contracts, model, operations, query, runtime, tx-log | store-jsonl, store-sqlite (tests) |
| `app/ui` / `ui` | `scope:browser` | canvas, contracts, model, operations, plugin, query, tx-log | — |
| `application/operations` / `operations` | `scope:shared` | contracts, model, query | cli, ext-canvas, ext-check, ext-docs, mcp, runtime, server, test-kit, ui |
| `contract/contracts` / `contracts` | `scope:shared` | model, plugin, query | cli, client, ext-canvas, ext-check, ext-docs, ext-sdk, mcp, operations, runtime, server, store-jsonl, store-sqlite, test-kit, tx-log, ui, workspace-fs |
| `contract/ext-sdk` / `ext-sdk` | `scope:backend` | contracts, model | cli, runtime |
| `domain/model` / `model` | `scope:shared` | — | cli, client, contracts, ext-canvas, ext-check, ext-docs, ext-sdk, mcp, operations, query, render-tests, runtime, server, store-jsonl, store-sqlite, test-kit, tx-log, ui, workspace-fs |
| `domain/plugin` / `plugin` | `scope:shared` | — | contracts, runtime, ui |
| `domain/query` / `query` | `scope:shared` | model | client, contracts, operations, runtime, server, test-kit, ui |
| `extension/canvas` / `canvas` | `scope:shared` | — | ext-canvas, runtime, ui |
| `extension/ext-canvas` / `ext-canvas` | `scope:backend` | canvas, contracts, model, operations | runtime |
| `extension/ext-check` / `ext-check` | `scope:backend` | contracts, model, operations | cli, runtime |
| `extension/ext-docs` / `ext-docs` | `scope:backend` | contracts, model, operations | cli, runtime |
| `infrastructure/store-jsonl` / `store-jsonl` | `scope:backend` | contracts, model, test-kit (tests) | runtime, server |
| `infrastructure/store-sqlite` / `store-sqlite` | `scope:backend` | contracts, model, test-kit (tests) | runtime |
| `infrastructure/tx-log` / `tx-log` | `scope:shared` | contracts, model | runtime, test-kit, ui |
| `infrastructure/workspace-fs` / `workspace-fs` | `scope:backend` | contracts, model | runtime, server |
| `test-support/render-tests` / `render-tests` | `scope:test-support` | model, server | — |

## Rules, evidence and changes

The same `matrixViolation` evaluates both imported and declared edges in
`boundaries.test.ts`; `workspace-shape.test.ts` validates the axes. The red
fixtures in `import-graph.test.ts` build actual two-package source trees and
run that resolver and the same predicate. A positive edge in the table means
*used by at least one source import*, not that every pair of packages in those
layers may sensibly depend on one another. A row's negative fixture proves
the row is read; the seven newly removed edges each have their own fixture.

| Axis / source | Before → after allowed targets | Evidence / honesty |
| --- | --- | --- |
| layer `domain` | domain → domain | Used; rejects domain→app in a source fixture. |
| layer `contract` | domain, contract → same | Both used; fixture rejects contract→app. |
| layer `infrastructure` | domain, contract → same | Both used; fixture rejects infrastructure→app. |
| layer `application` | domain, contract, **application** → domain, contract | Self-edge unused; fixture now rejects it and infrastructure. |
| layer `extension` | domain, contract, application, extension → same | All used after moving canvas; fixture rejects extension→infrastructure. |
| layer `app` | domain, contract, infrastructure, application, extension, app → same | All used; broad composition-root row, fixture rejects app→test-support. |
| layer `test-support` | domain, **contract, application, extension**, app, **test-support** → domain, app | Only these two used; fixture rejects the other four and infrastructure. |
| scope `shared` | shared → shared | Used; fixture rejects shared→backend; runtime-only specifiers also rejected. |
| scope `backend` | shared, backend → same | Both used; fixture rejects backend→browser. |
| scope `browser` | shared, **browser** → shared | Browser→browser unused across packages; fixture rejects it and browser→backend. |
| scope `test-support` | shared, backend, **test-support** → shared, backend | Self-edge unused; fixture rejects it and test-support→browser. |

The `app` row is intentionally broad: `runtime` registers extensions and
reaches domain, contract, infrastructure and application; `cli` imports
other app packages; `server` reaches infrastructure; UI
reaches shared infrastructure (`tx-log`) and the extension's document format.
`test-kit` is `layer:app` because it builds a runtime, even though its scope
is `test-support`. The `@kb/test-kit` devDependency and test-file import
exceptions are explicit in the boundary check; no production exception is
implied. `extension→extension` is now a real backend→shared edge, not a dead
entry. No package's actual scope contradicts its runtime: shared packages
compile with the isomorphic preset, browser with DOM, and backend/test with
Bun. `tsconfig-presets` checks this mapping.

The UI zone rule is **enforced against real imports**, and
`ui-boundaries.test.ts` checks the zone vocabulary for missing/stale rows and
GAP markers for stale sanctions. Its negative fixture is a documented
`components/outline/tag-chip`→`stores` import; it does not have an independent
red fixture for *each* permission, unlike the tightened package rules. The
following are allowed but unused in non-test source imports (self-edges are
also redundant because `uiViolation` permits same-zone imports before reading
the matrix):

| UI source | Allowed but unused targets |
| --- | --- |
| shell | shell, actions, session, ds |
| ds | ds |
| lib | lib |
| api | lib, api, ds |
| actions | api, actions, ds |
| session | actions, session, ds |
| stores | stores |
| fixtures | fixtures |
| scene | scene |
| test-support | test-support |
| primitives | primitives |
| catalog | catalog, fixtures, components/ontology, components/palette, components/sidebar |
| components/canvas | components/canvas |
| components/graph | components/graph |
| components/lab | components/lab, actions |
| components/ontology | components/ontology |
| components/outline | components/outline |
| components/palette | components/palette, primitives, actions |
| components/prefs | components/prefs, actions |
| components/sidebar | components/sidebar, primitives, actions |

These rows otherwise have used cross-zone imports. The especially broad
`shell` row actually reaches all eight component families, primitives,
stores, api and lib; `catalog` reaches canvas, graph, outline, prefs,
primitives and lib. R1 is simultaneously modifying UI plugin/route/view
files and introducing `view-keys`, so these unused UI permissions are **not**
removed in this wave. Gap `01M3F8EJSWHS38PMSSQ2BVN8DG`, marked beside
`UI_ALLOWS`, names the still-unproven tighter zone contract.

## Holes and ownership

- No missing or conflicting scope tags, unknown layer folders, deep relative
  cross-package imports, alias escapes, or `@kb/*/src` imports were found.
  `import-graph` resolves package subpaths, cross-package relative paths and
  tsconfig aliases and has red fixtures for all three. Seven declared-only
  `@kb/test-kit` devDependencies are the documented test exception.
- All importable `exports` maps expose only `"."` → `./src/index.ts`;
  `cli`, `ui`, and `render-tests` expose `{}`. `public-surface` rejects
  subpaths and whole-package re-export leaks. This is a package surface,
  not a guarantee that each named barrel export is minimal.
- The layer vocabulary is executable in `LAYER_ALLOWS`; `SCOPE_ALLOWS` and
  `RUNTIME_PRESET_BY_SCOPE` repeat the scope keys, but
  `tsconfig-presets` compares them. `DESIGN.md` and `tools/kb/AGENTS.md`
  also print values for readers; edits to prose are not mechanically kept
  identical to code. The canonical executable direction remains
  `constraints.ts`, not Nx tags or a second lint config.
- `domain/canvas` contained only JSON Canvas document types, parsing,
  round-trip preservation and edge/node updates (`doc.ts`, `index.ts`), with
  no core graph invariant and no imports. Backend `ext-canvas`, runtime and
  UI import it. It now lives at `extension/canvas`, alongside the backend
  package. Its `@kb/canvas` public name, manifest, scope and callers remain
  unchanged; `bun.lock`/`bun.nix` follow the move.
- The core model still defines `SYSTEM_IDS.canvasTag` and `canvasField` in
  `model.ts` and seeds them in `seed.ts`. That is extension-specific policy
  in the shared core and is explicitly part of the existing canvas gap
  `01M39F3MR3HT2NR553FY8CRD6X`, not silently called core domain. The UI
  remains split across `components/canvas` and `lib/canvas-*`, invoking the
  backend by an action id; moving just its page would strand shared helpers.
  Docs' render operation under `application/operations/src/docs` is the
  generic render mechanism consumed by `ext-docs`, not its policy templates.

## Target layout and decisions

Keep **one package per runtime side** under `extension/`: shared
`@kb/canvas` (document model), backend `@kb/ext-canvas` (actions and
eventually its seed contribution), and a future browser canvas plugin.
That preserves the one-scope-per-package compiler fence and one-level Bun
workspace layout without inventing a package-internal second compiler scope.
It costs one extra workspace dependency between backend and shared parts,
but keeps the model available to UI and backend without importing a backend
bundle in the browser. A nested `extension/canvas/{model,backend,ui}` tree
would require changing the workspace discovery, Nx project roots and the
two-level shape check for every extension; a single all-in-one package
would break the scope axis. Neither is justified for this move.

Do not extract the browser side before R1's typed views settle and the
`@kb/ui-sdk` host contract is decided (R2 of `plugin-composition.md`). It
must consume a host API, not reach back into `@kb/ui` internals or duplicate
the page-shaped surface mechanism. This is separate from third-party
`.kb/extensions`, whose generated ambient `kb-ext-sdk` d.ts is a deliberately
narrow trusted-module fence; exposing browser views there awaits the same
SDK decision. The existing canvas gap carries the UI and seed move; the new
UI-matrix gap carries the deferred zone tightening. No new UI zone row or
`view-keys` hunk was made here.
