# d3-template-seam — report

Wave `d3` of `docs/kb-waves/2026-09-03/plan.md` (run log row
`d3-template-seam`, gap `01M1M08VXGJ5RTQJ3AJNK12G79`).
Harness: claude (opus), worktree
`/Volumes/Data/workspace/repos/_worktrees/.dotfiles/d3-template-seam`,
branch **`feature/d3-template-seam`**, stacked on `g2` (`cd6a5b9`).

---

## 1. The problem, restated

`renderViewEffect` resolved a view spec's `template` name against a
module-level `Record<string, TemplateFn>` exported from core
(`packages/operations/src/docs/templates.ts`). Two consequences, both Rule 1
violations:

- The record was the **only** way to add a template, and it was core's. r2's
  bundled docs extension therefore did `templates["rules"] = rules` at module
  load — a second home for the same concept, reached by mutation, marked
  `// GAP [[01M1M08VXGJ5RTQJ3AJNK12G79]]`.
- A third-party `.kb/extensions/*.ts` module could contribute an **action**
  but not a **template**, even though a template is exactly the kind of policy
  the extension boundary exists for. The declared boundary ("core is
  mechanism only") did not hold: `todos` — repo-doc policy — lived in core.

## 2. What shipped

One seam, the action seam, widened to carry both kinds of contribution.

| Concept | Before | After |
|---|---|---|
| Extension default export | array of actions | array of **contributions**: actions *or* templates |
| Discrimination | `effect` vs `handler`, structural | same mechanism, one level up: a contribution with a `template` function is a template |
| Id namespacing | `ext.<file>.<action>` | `ext.<file>.<id>` for both kinds |
| Compat ids | `aliases` on actions | `aliases` on both kinds |
| Template lookup | `templates[name]` in core | `TemplateRegistry` service, provided once by `kbRuntimeLayer` |
| Templates in core | `todos` | **none** |

Files:

- **`@kb/contracts/src/template.ts` (new).** `TemplateContext`, `TemplateFn`,
  `ExtensionTemplate`, the `TemplateRegistry` service and
  `templateRegistryLayer`. Contracts is where `KbCtx`/`KbStore` already live,
  so the DI seam for templates is the same mechanism as the DI seam for the
  store.
- **`@kb/contracts/src/extension.ts`.** `ExtensionContribution =
  ExtensionAction | ExtensionTemplate`; `LoadedExtension` carries `templates`
  beside `actions`.
- **`@kb/operations/src/extension-loader.ts`.** One validation pass over the
  default-exported array, branching on the structural discriminator. The
  narrowing that was spread over three `as` casts is now one `asRecord` seam,
  so the loader trips one fewer `no-unsafe-type-assertion` than before.
- **`@kb/runtime/src/registry.ts`.** `RegisteredTemplate`, per-extension
  `templates`, `Registry.templates` (namespaced ids + aliases), clash
  detection identical to the action path, and bundled extensions declaring
  `templates` in the same literal that declares `actions`.
- **`@kb/runtime/src/layers.ts`.** `kbRuntimeLayer` provides
  `TemplateRegistry` from `registryFor(ctx.root)`; that is the single
  provisioning point every surface already used (CLI, MCP, server, test-kit,
  `invoke`).
- **`@kb/runtime/src/invoke.ts` (new).** The Promise edge `invoke` moved out
  of `registry.ts` so `layers.ts` can read the registry without an import
  cycle (`import/no-cycle` is `error`). registry → layers is gone; layers →
  registry and invoke → both.
- **`@kb/operations/src/docs/docs.ts`.** `renderViewEffect` yields
  `TemplateRegistry`, resolves the name, and reports the *registered* ids in
  the `invalid_input` failure.
- **`@kb/operations/src/docs/text.ts` (new).** `renderText` — resolving
  `[[id|label]]` against the graph is mechanism, so it stays in core and is
  exported for template authors. It is all that remained of `templates.ts`.
- **`@kb/ext-docs`.** `todos.ts` (moved verbatim from core) and `rules.ts`
  (ported from r2's `db2f8c0`), registered as `ext.docs.todos` /
  `ext.docs.rules` with the bare ids `todos` / `rules` as aliases — the same
  compat shape `docs.materialize` / `docs.check` already use. **The
  `templates["rules"] = rules` mutation does not exist on this branch.**
- **`@kb/ext-sdk/src/surface.ts` + regenerated `sdk-dts.text.ts`.** External
  authors get `TemplateContext` / `TemplateFn` / `ExtensionTemplate` /
  `ExtensionContribution` from the ambient `kb-ext-sdk` module.
- **`@kb/server/src/http.ts`.** The HTTP facade re-assembled the runtime by
  hand (`bunFileSystemLayer` + `kbStoreLayer` + `provideService(KbCtx)`). It
  now provides the one `kbRuntimeLayer` — a second composition root removed,
  not a third layer added to it.
- **Docs.** `tools/kb/DESIGN.md` (core boundary & extensions,
  Materialization, SDK) and `AGENTS.md`/`CLAUDE.md` state the contract once,
  in the place that already owned it.

`docs/kb/todos.md` is byte-identical after the move (`docs.check` clean).

## 3. Red-then-green evidence

New test: `tools/kb/packages/runtime/tests/template-seam.test.ts`
(4 tests). It writes a real `.kb/extensions/loud.ts` whose default export is
`[{ id: "shout", template(rows, ctx) {...} }]`, a `.kb/views/shout.json`
naming `ext.loud.shout`, and drives `docs.materialize` through `invoke`.

Red — run against the pre-change tree (the loader had no template concept, so
the contribution was validated as a malformed *action*):

```
kb: extension loud.ts: action shout: title must be a string (skipped)
TypeError: undefined is not an object (evaluating 'registry.templates.has')
- "known": ExpectArrayContaining {}
+ "known": [ "todos" ]

 0 pass
 4 fail
Ran 4 tests across 1 file.
```

Green — after the seam:

```
 4 pass
 0 fail
 18 expect() calls
Ran 4 tests across 1 file. [2.13s]
```

What each test pins: (1) the module's template is registered under
`ext.loud.shout` with `source: "ext:loud"` and no loader failure;
(2) `docs.materialize` renders `docs/kb/shout.md` through it
(`- HELLO SEAM`); (3) the bundled `ext.docs.todos` still answers to the bare
id `todos` and both ids resolve to the *same* function; (4) an unknown
template fails `invalid_input` and lists the registered ids, extension ones
included.

No lint rule was promoted in this wave, so there is no promotion table.

## 4. Lint / ratchet counts (before → after)

`bun run harness` compares against `packages/harness/lint-warn-baseline.json`
(g2's frozen baseline). **No rule rose.** Two dropped:

| Rule | Baseline | After | Δ |
|---|---:|---:|---:|
| `typescript/no-import-type-side-effects` | 9 | 8 | −1 |
| `typescript/strict-boolean-expressions` | 346 | 345 | −1 |

The baseline file is **not** re-snapshotted: leaving it above the current
count keeps `d1`/`d2`'s drain targets intact and the ratchet still fails on
any rise.

Rises that appeared while writing this wave and were fixed rather than
absorbed (each would have failed `harness`):

| Rule | Peak | Fixed by |
|---|---:|---|
| `effect/asyncFunction` | +7 | the new test file is Effect-native (`Effect.gen` + `Effect.promise`, `test(() => Effect.runPromise(...))`) instead of `async` callbacks |
| `unicorn/no-array-sort` | +2 | `toSorted` in the ported `rules` template |
| `typescript/no-unsafe-type-assertion` | +2 | one `asRecord` narrowing seam in the loader instead of per-branch casts |
| `typescript/no-unnecessary-type-assertion` | +2 | dropped `as NodeId` in `rules.ts` (the prop value is already `NodeId`) |
| `typescript/no-unnecessary-type-conversion` | +1 | dropped `String(value.v)` on a string |
| `typescript/consistent-type-imports` | +2 | `TemplateRegistry` imported as a type where it is only a type |
| `typescript/strict-boolean-expressions` | +1 | `problem !== null` in the loader (net −1 vs baseline) |

## 5. Gate results

| Gate | Result |
|---|---|
| `bun run verify` (typecheck → lint → fmt:check → knip → harness) | **green** on both commits (`36 pass / 0 fail` harness, 0 oxlint errors, `tsc` clean incl. tsgo) |
| `bun test packages` | 350 pass / 1 fail — `packages/store-jsonl/tests/benchmark.test.ts`, the wave's documented known-red at base (perf budget: 2284 ms vs `< 1000`) |
| `bun tools/kb/packages/cli/src/bin/docs-check.ts` | clean (2 views) |
| `.githooks/pre-commit` | ran on both commits (gate + docs check + asset backup + verify) |

Under concurrent load from the sibling worktrees (`d1`, `d2`; load average
~38) the two DST tests in `@kb/test-kit` time out at their 5 s budget; with
`--timeout 30000` they are `10 pass / 0 fail`. Not a behaviour change from
this branch — it is wall-clock contention.

## 6. Shared-file touches outside `tools/kb`

| File | Change |
|---|---|
| `AGENTS.md` (`CLAUDE.md`) | kb section: extensions default-export contributions (actions **and** templates); bundled docs templates and their aliases |
| `.kb/views/rules.json` | new — r2's rules view, cherry-picked from `db2f8c0` |
| `docs/kb/rules.md` | new — generated; see §7 |

`.kb/nodes.jsonl` was **not** touched, and no node was created.

## 7. Handover notes for the coordinator

- **The gap is closed by this branch.** Node
  `01M1M08VXGJ5RTQJ3AJNK12G79` ("core exposes no template-registration seam")
  is satisfied: the mutation is gone, templates are a first-class
  contribution, and a `.kb/extensions` module can ship one (test §3). The
  node lives in r2's `.kb/nodes.jsonl`, which this branch does not carry, so
  the flip is yours to make at integration.
- **`docs/kb/rules.md` on this branch is the empty render.** The rules view
  came over from r2, but the `#rule` / `#gap` nodes did not (they are in r2's
  `.kb/nodes.jsonl`). `docs.check` is a pre-commit gate, so the view had to be
  materialized to commit at all; it renders `_no rules recorded_` /
  `_No gaps recorded._`. **After merging r2, re-run
  `kb action-invoke '{"id":"docs.materialize","input":{}}'`** — the file then
  matches r2's, generated through the contract path instead of the mutation.
- **Merging r2.** r2's `db2f8c0` edits `tools/kb/extensions-bundled/docs.ts`,
  a file `w1` deleted. Resolve in favour of this branch: the `rules` template
  is already here at `tools/kb/packages/ext-docs/src/rules.ts`, minus the
  mutation and the `// GAP` marker.

### Needs owner

- **`ExtensionAction`'s `title` / `description` are required; `ExtensionTemplate`'s
  are absent** (`packages/contracts/src/template.ts:22`). Adding them would be
  a declared abstraction no code path reads — `kb ext list` prints actions
  only. If templates should show up in `kb ext list` / the manifest, that is a
  surface decision, not a mechanical one.
- **`@kb/ext-docs` now depends on `@kb/model`**
  (`packages/ext-docs/package.json`) because the moved templates read
  `KbNode` / `NodeId`. `layer:extension → domain` is allowed by the matrix, so
  nothing was widened — flagging it only because it is a new package edge.
- **The `render.view` / `render.views` core actions now require
  `TemplateRegistry`** (`packages/operations/src/render.ts:11`). With no
  extension loaded they can render nothing, which is correct for a
  mechanism-only core but is a visible behaviour change for anyone who
  expected `todos` to exist without `@kb/ext-docs`. Worth an owner ruling on
  whether `render.view` should stay a *core* action at all now that every
  template is extension policy.
- **The ratchet has no lane for legitimately-new code**
  (`packages/harness/tests/lint-warn-ratchet.test.ts:44`). Any rise fails, so
  a new async test raises `effect/asyncFunction` (312 in backend today) and
  blocks the commit. This wave dodged it by writing the test Effect-natively,
  which was an improvement — but the general case (a new `.test.ts` with
  `async` callbacks) has no honest path except editing the baseline. Decide
  whether `effect/asyncFunction` should be scoped to `src/` or moved to the
  advisory lane.
- **`benchmark.test.ts` fails under load** (documented known-red at base) and
  the two `@kb/test-kit` DST tests have a 5 s budget that concurrent waves
  blow. Both are timing budgets, not correctness — but they make "suite green"
  machine-dependent.

## 8. Commits

| Commit | Subject |
|---|---|
| `0b7f4b8` | `feat(kb): extensions contribute render templates through the extension contract` |
| `1d1bd9f` | `feat(kb): port r2's rules template onto the template seam` |
| _(this file)_ | `docs: d3-template-seam wave report` |
