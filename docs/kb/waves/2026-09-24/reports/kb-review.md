# kb review — trajectory, domain, modules, code

Date: 2026-09-24
Audited snapshot: `77f0133` (`feat(kb): @kb/plugin, an Effect-native plugin kernel`)
Worktree: `/Volumes/Data/workspace/repos/_worktrees/.dotfiles/kb-r2` (`review/kb-2026-09-24`)
Not reviewed: uncommitted plugin-phase-2 edits on the main worktree (`registry.ts`, `extension-loader.ts`, `contracts/src/extension.ts`, the three bundled extensions). Those files were dirty in another session.

Mode: read-only. No `verify` run in this pass; judgments below are from the tree, the harness, and the generated rule ledger.

## Verdict

The core is still one of the more deliberate TypeScript workspaces around: one node model, one store port with two adapters chosen by presence, one import matrix, and a rule ledger that is honest about what is prose. An agent can extend the graph, the stores, and the harness without inventing a second stack.

It cannot yet extend the thing the current wave is about.

`@kb/plugin` landed with a real kernel and real tests, and nothing in the product imports it. The documents an agent reads first — `tools/kb/AGENTS.md` and `tools/kb/DESIGN.md` — still describe an extension as a default-exported array registered by a hand-rolled loop. The only spec for the kernel is `docs/kb/waves/2026-09-23/briefs/p1-plugins.md`. Spec-first and canonical-statements are both prose, so that split is legal. It is also how phase 2 grows a second registration path beside the kernel.

Short version:

> The harness steers structure. It does not steer the spec. The plugin wave is ahead of the documents that are supposed to be the spec.

| Area | Confidence | What is true at `77f0133` |
| --- | --- | --- |
| Store port and adapters | High | One `EffectStore`, JSONL and sqlite, selected by file presence, conditional commit shared |
| Node model, tx, ontology, query IR | High | One owner each; ontology is a lens, not a second graph |
| Package matrix | High | Layer folder + one `scope:*` tag; harness reads imports |
| Rule ledger mechanics | High | `ext.check.audit` derives enforcement and is on `verify` |
| Rule ledger contents | Medium | 12 gap nodes say "Closed by …" and are still published as open gaps |
| Extension / plugin trajectory | Low-medium | Kernel tested and unused; agent docs and DESIGN.md do not name it |
| UI module shape | Medium | Zones are enforced; three sanctioned cycles remain; views are hardwired |
| Code-level cohesion | Medium | The tangled units are already gap nodes; size is not the problem |

## 1. Trajectory — tests, rules, SDD

### How the loop is supposed to work

A rule is a node. `docs/kb/rules.md` is generated from those nodes and is not edited. Each rule names a home, a principle, and an enforcement: `harness`, `hook`, `lint`, or `prose`. `prose` means nothing checks it. `@kb/ext-check` (`packages/extension/ext-check/src/audit.ts`) proves that a machine-enforced rule points at a `#check` whose evidence file exists and whose invocation is wired, and it derives `rule.enforcement` from the check surface. `bun run verify` is typecheck, oxlint, format, `bun test harness`, and `check:audit`. The pre-commit hook runs that against a staged snapshot, not the working tree (`.githooks/pre-commit`).

Of the 29 rules in the ledger: 14 harness, 2 hook, 2 lint, 11 prose.

What the harness actually locks, and locks well:

- layer and scope direction, from folders and `scope:*` tags (`harness/src/constraints.ts`)
- the isomorphism fence (`bun:`, `node:`, `@effect/platform-bun` out of `scope:shared`)
- one barrel, no star re-exports, no deep imports
- catalog versions, one tsconfig strictness base, lint-scope coverage
- UI zone matrix (`UI_ALLOWS`), with a `// GAP [[id]]` required on a sanctioned breach
- skip/todo tests paired with a gap id within three lines
- warn counts frozen per rule; a new rule cannot arrive pre-forgiven
- Knip identities frozen in the same ledger (`harness/tests/lint-warn-ratchet.test.ts`). Knip is not a separate `verify` step; it runs inside the harness. The pre-commit comment that lists it beside harness is slightly redundant, not a hole.

That is a closed loop for structure. It is not a closed loop for meaning.

### Findings

**The spec for the current wave is not in the canonical spec.** High.
`DESIGN.md` headings cover the node, storage, query, ontology, and the action registry. A search for the plugin kernel hits only the Effect language-service plugin and the oxlint plugin. `AGENTS.md` still says core is mechanism and an extension is a default-exported array of actions and templates, registered as `ext.<file>.<id>`. The kernel's contract — keys, `provide` / `inject`, contribution points, scope-tied unload, pending dependents — lives only in the wave brief. Spec-first (`DESIGN.md` § Spec-first changes) says the design doc is edited before the code, in the same change. That rule is `enforcement: prose`. Phase 1 was allowed to land as an unused package. Phase 2, already started on the other worktree, is the moment a second path appears if the agent follows `AGENTS.md` instead of the brief.

**Twelve gap nodes describe finished work and are still open gaps.** Medium.
`docs/kb/rules.md` has 84 gap sections. Twelve of them say "Closed by …" in `current` (saved-query virtual nodes, both tx-log durability gaps, four canvas-pointer and view-config gaps, `KbNode.order`, the sqlite adapter itself, and two more). The audit checks that enforcement matches the check surface. It does not check that an open gap's `current` still describes the code. Agents treat `## Gaps` as the work list. Several of these will send the next session off to rebuild something wave g7 or g8 already built. A few are honest residuals hiding under a closed headline (`KbNode.order` notes that `mutations.ts` still compares a wire node's order to `undefined`). The headline is still the wrong status.

**The load-bearing agent rules are the ones nothing checks.** Medium, and already gap `01M1M08W6Z70XV3KCQB5CWH3ZR` for prompts specifically.
Still prose, and still the rules a new module violates first:

- Abstraction before addition (Rule 1)
- Canonical statements — one home, no restatement
- Spec-first changes
- Domain typing: discriminator over optional, literal discriminators, one canonical schema
- Kinds, roles, and options (the "strip the behaviour and is it still that thing" test)
- Effect v4 idiom, except where `tsc` already sees it

The September 4 review asked for semantic review to use this same ledger. The ledger exists. The semantic half is still a reviewer.

**Fail-closed holes the ledger already names, still open.** Medium. Not new, still the admission boundary:

- Repository extensions warn and skip. Nothing in `verify` compiles `.kb/extensions`. Gap `01M1PJVJX84AZCRVJ82R20WTK3`. The plugin loader will make this worse if phase 2 keeps fail-open as the bridge.
- `main` has CI and no required branch protection. Gap `01M1PJXGKQ0HAYEWY2V0QPWVX1`.
- Two launch paths for the `kb` binary (direnv shim vs nix package). Gap `01M1M08VKDXG6AFZHQPW5M2GRF`, filed under Rule 1.

**`@kb/plugin` is outside the constraint story.** Medium, by the phase-1 plan, and still a risk.
The package is `scope:shared`, depends on nothing, and the only reference outside it is `bun.nix`. The harness will notice if some package imports it illegally. It will not notice that no package imports it at all, that `AGENTS.md` describes a different mechanism, or that a host re-implements `load` / `contribute` beside `makeKernel`. A declared abstraction nothing reads is the case Rule 1 calls a dead seam. The wave plan accepts one commit of that. It should not accept two.

### What is solid

The two-mechanism rule (error + pinpoint GAP, or a frozen ratchet, never both) is itself harness-enforced. React Compiler rules that oxlint 1.83 turned on are warn with frozen counts (59 sites: `react/refs` 22, exhaustive-effect-dependencies 16, set-state-in-effect 14, hooks 4, memo-dependencies 2, globals 1) and a gap that says so (`01M35NJQPKW5YVNVFFAFAYXPFH`). That is the ratchet used as designed, not a quiet disable. `eslint/max-lines-per-function` is the other warn lane, 29 sites, matching the testing doctrine: size warns, cohesion is a review verdict.

Skip pairing has no product skips. The only `describe.skipIf` is the 50k benchmark gate.

## 2. Domain design

### Map

| Concept | Owner | Who else touches a slice |
| --- | --- | --- |
| Node, id, props, rank, tx (`applyTx`, `txIntegrityError`) | `@kb/model` | UI wire types re-export; both stores persist `KbNode[]` |
| System seed, including `#canvas` | `@kb/model` `seed.ts` | Canvas is a core tag, not an extension's data |
| Config slots (perspective, view) | `@kb/model` `node-config.ts` | UI decoders are thin over that table |
| Ontology resolution | `@kb/model` `ontology.ts` | UI draws it; membership is not a second store |
| Query IR, compile, DataScript index | `@kb/query` | UI `ds/` is the sanctioned browser seam; `@kb/client` constructs its own `DatascriptIndex` per query |
| Store port, fingerprint, conditional commit | `@kb/contracts` `store.ts` | `staleCommitError` is the one predicate both adapters use |
| Adapter choice | `@kb/runtime` `store-selection.ts` | The only place allowed to name `JsonlStore` and `SqliteStore` |
| Tx tail | on the store (`txTail`), types in `@kb/contracts` | Virtual saved-query append is the path that does not take the store lock |
| Canvas document | `@kb/canvas` (no deps) | Tag and field seeded by `@kb/model`; action in `@kb/ext-canvas`; UI in `@kb/ui` |
| Plugin kernel | `@kb/plugin` (no kb deps) | Nobody |

That map is the design. Most concepts have one owner. The exceptions are the ones phase 2 is about to pull on.

### Findings

**Canvas is three owners and a string.** High for this wave, already the brief's premise.
`@kb/canvas` owns the doc (parse, stringify, empty doc). `seed.ts` owns the `#canvas` tag and `sys.f.canvas` field, inside the system seed, with a comment `Canvas nodes (C1)`. `@kb/ext-canvas` owns `ext.canvas.tx.apply` and is `scope:backend`, so the UI cannot import it (`SCOPE_ALLOWS` lets `browser` reach `shared` and `browser` only). The UI calls the action by the literal `"ext.canvas.tx.apply"` in `packages/app/ui/src/lib/canvas-api.ts`. Seeds, action, and UI are three mechanisms for one concept, joined by a name. Phase 2's sentence — "one extension with a backend entry and a `./ui` entry" — collides with the one-scope-tag rule. A single package cannot be `scope:backend` and `scope:browser`. The clean shape is two entries that are two packages (or one shared doc package plus a backend plugin and a browser plugin), both contributing to kernel points, not one folder that breaks the fence. The doc package (`@kb/canvas`) should stay shared and dependency-free. The tag seed should move with the extension or the seed stops being "the system" and becomes "every view we have ever shipped".

**The store port is in good shape. Its lifetime is not on the port.** Medium.
`EffectStore` is one interface: `loadEffect`, `fingerprint`, `txTail`, `commitEffect(tx, record, expected?)`. Fingerprint is opaque and names state, not the connection. `selectStore` refuses when both `.kb/nodes.jsonl` and `.kb/kb.sqlite` exist, rather than inventing precedence. That is the right call.

`selectStore` then does `return BACKENDS[name].open(root).store` and drops `release`. Sqlite's `close` never reaches the port. `@kb/client` documents that the connection lives until the process ends. Fine for `kb ui`. Wrong for a library call that opens a client, commits, and returns: the closer is not expressible. The port grew a fingerprint so two processes can name one state; it has no way to say the session is over.

**`@kb/client` re-implements the index the gaps already say not to duplicate.** Medium.
`openClient` correctly goes through `selectStore`. `query` then does `new DatascriptIndex(current.nodes).runDatalog(...)` on every call (`packages/app/client/src/index.ts`). That is a third construction of the in-memory index (runtime `layers.ts`, the browser session, now the client), and it rebuilds from a full snapshot per query. It matches gap `01M1RYY03MAQPTPRCBHTRJDC39` (sqlite holds nodes and answers nothing) and gap `01M1PH06G67A9HHTTXFZVAZ3YF` (index reads are synchronous, so a SQL index cannot satisfy `KbIndex`). The client was the chance to depend on `KbIndex` rather than on `DatascriptIndex`. It took the concrete class.

**Two schema stacks, one seam, still two authors.** Low-medium, intentional, unfinished.
Persistence is Effect Schema (`node-schema.ts`). Action input and output are zod, bridged by `schema-seam.ts`, whose comment says "Core still authors zod schemas — this widens the extension boundary before any internal Schema migration." DESIGN.md's domain-typing section does not mention zod. The seam is the right abstraction. Leaving it unnamed in the design doc means the next action copies zod because every existing action does, and the migration never starts. `failure.ts` in the domain model also imports zod, so the domain package is not Schema-only.

**Ontology and query are the parts to leave alone.**
Ontology is a resolution over nodes (`extends`, membership, cycle-safe), not a parallel graph. Query has one IR (`parse` → `compile` → `runIr`) and one DataScript executor; `IrRaw` is the explicit escape and the subscription gap already says it has no read set. Do not add a second query language beside that. The sqlite query gap is "compile this IR to SQL", not "let callers pass SQL".

**Plugin-as-domain is the right layer, with one condition.**
`@kb/plugin` depends on Effect only. `domain` may depend only on `domain`, and a zero-dep package satisfies that. Putting a host kernel in `domain/` is slightly misleading — it is not a kb concept — but a new layer would be a row nothing else used, which this repo has already rejected (`scope:extension` was deleted for that reason). Keep it in `domain/` only if DESIGN.md says why: a mechanism with no kb types, shared by server and browser. The keys module already states the important invariant: keys compare by identity, so a key is created once by the package that owns the concept. Action and template points therefore belong in `@kb/contracts`, as the brief says, not re-created inside the loader.

## 3. Module design

### Graph

`LAYER_ALLOWS`: domain → domain; contract → domain, contract; infrastructure → domain, contract; application → those plus itself; extension → domain, contract, application; app → everything except test-support; test-support → almost everything except infrastructure.

`SCOPE_ALLOWS`: shared → shared; backend → shared, backend; browser → shared, browser.

Measured from manifests at this commit: 22 workspace packages. `@kb/plugin` has no dependents. `@kb/ui` (browser) depends on `@kb/canvas`, `@kb/contracts`, `@kb/model`, `@kb/operations`, `@kb/query`, `@kb/tx-log` — all shared. It does not, and cannot, depend on `@kb/ext-canvas`. `@kb/runtime` (the composition root) depends on both stores, all three bundled extensions, and `@kb/canvas`. That last edge is the seed/action split showing up as a package edge: the runtime needs the doc type because the extension's action is not the whole concept.

UI source under `packages/app/ui/src`, excluding tests, is 197 files. Non-test sources under `packages/app` are 230. Domain is 34. The UI is most of the code, and the matrix treats it as one package with internal zones. That is correct. It is also why "move canvas into the extension" is a module change, not a file move: `components/canvas` is a zone `shell` is allowed to import by name (`UI_ALLOWS.shell` lists `components/canvas` beside graph, ontology, outline). Routes are the same kind of hardwiring (`lib/router.ts` matches `/canvas`, `/graph`, `/o/<id>/graph`). `App.tsx` lazy-imports `GraphPage`, `CanvasPage`, `OntologyPage`. There is no contribution point for a view. The brief's phase 3 (routes, sidebar, bullets, view modes, commands as points) has no seam yet; the kernel's `Point` type is the seam, and it is unused.

Sanctioned UI cycles, each with a live gap on the import line:

- `actions/mutations.ts` and `actions/optimistic.ts` import `useOutlineStore` (`01M1RXMRB7AZB7DPFR6XBPBKQ9`)
- `api/live.ts` writes both outline and ui stores (`01M1RXMQYDBWX4EWJPEFRDR05H`)
- `session/runtime.ts` imports `KbIndexService` from `@kb/query`, beside the `ds/` seam (`01M1RXNP3EMV1ES85BVE9CXMYE`)

Those three are why a plugin-shaped UI will be hard. A view plugin that contributes a route still has to get its data from the outline store, and the action layer is not a function of state — it reaches into the store. Until that gap closes, "unload the plugin" cannot unload the store writes.

`bunFileSystemLayer` is `BunFileSystem.layer` re-exported from `@kb/store-jsonl`. `@kb/client` provides it so `selectStore` can `exists()` the selecting path. The filesystem is not a JSONL concept. Small, but it is why the client manifest depends on the JSONL adapter even when the root is sqlite.

### Readiness for phase 2

Ready:

- The kernel's tests cover the brief's lifecycle claims: namespaced contributions, clash fails the whole plugin and rolls back, `apply` defects do not crash the kernel, inject waits and drops dependents back to pending, one provider per service, key identity, listener isolation, children unload with the parent (`packages/domain/plugin/tests/kernel.test.ts`, 14 tests, 302 lines against a 490-line kernel).
- `registryFor` / `invokeEffect` are the backend functions to turn into point reads. They are already Effect functions, not a class hierarchy.
- Extension packages already may not import infrastructure or app. A plugin that smuggles a store in through a side import will fail the harness.

Not ready, and should be decided in DESIGN.md before more code:

1. One package cannot have two scopes. Backend entry and `./ui` entry means two packages, or a scope model change. Do not special-case `ext-canvas`.
2. Canvas seeds live in `systemSeedNodes`. Moving them is a seed-ownership change, not an export move.
3. UI zones name surfaces. A contributed view is a zone the table does not have. Either `shell` learns "whatever the kernel contributed" or the zone table grows a row per built-in and extensions render into a slot. The second is the one that survives a fourth view.
4. The array form has to become a bridge inside the loader, as the brief says, in the same change that deletes the hand-rolled registration loop. Leaving both is the failure mode.

## 4. Code quality

The code matches the doctrine more often than not. Effect entry points that were sampled use `Effect.fn`. A search of non-test sources did not turn up `catchAll`, `Data.TaggedError`, `Context.Tag`, or `@effect/schema`. The two `as unknown as` casts in UI source are the two gap nodes that name them (`force3d-instance.ts`, `caret.ts`). Oxlint disables are pinpoint, 39 of them, not file-wide overrides. The vendored anti-slop subset (manual tag comparison, manual tagged construction, reflect, reduce-accumulator copy) is the right kind of lint: it deletes a local dialect rather than styling one.

What is actually tangled is already written down, and the review agrees with the ledger rather than finding a new set:

- `outline.store.ts` (~813) and `actions/mutations.ts` (~864) are one cycle. Splitting the store without closing `01M1RXMRB7AZB7DPFR6XBPBKQ9` moves the cycle, it does not remove it.
- `graph-lens.ts` (~787) and `field-value.tsx` (~780) are long because they are tables of cases. The cohesion gaps to believe are the ones that name branches inside an effect: sigma's lifecycle effect, the cluster renderer's effect, `hierarchicalLayout` mixing forest and placement, `parseOnce` as a 41-branch scanner. Those are the untested-without-a-DOM units.
- `cli.ts` (~839) is a composition root. Length there is less interesting than whether a command reaches past `selectStore`.

Tests: 8 characterization files, all under the UI, around keymap, field editors, and node config. They pin current behavior so a refactor can see a change. They are not a substitute for the store-contract tests (`@kb/test-kit`), which are the ones that keep the two adapters honest. The highest-risk untested seam is not another outline key: it is plugin adoption. The kernel is tested in isolation. Nothing tests "the registry's behavior is the kernel's behavior", because nothing wires them. Phase 2's acceptance, already in the brief, is the right one: existing tests pass unchanged in meaning, and a clash fails the plugin rather than skipping one entry.

`@kb/client`'s per-query full reindex is the one new quality issue. It is small code and an expensive shape, copied from the synchronous `KbIndex` port instead of waiting on that port.

Knip's frozen lane is large (unused exports and a handful of devDependency edges, including `@kb/test-kit` on several manifests that only need it from tests — that one is legitimate and noisy). It is a baseline, not a burn-down. Do not start a knip-zero project in the middle of the plugin wave.

## 5. What not to touch

- The store-selection rule (presence, refuse on two). A config key would be a second source of truth; DESIGN.md already says so.
- `staleCommitError` as the single conditional-commit predicate.
- Ontology as a lens. Do not store membership.
- The UI zone matrix as a table in `constraints.ts`. Do not move it back into `ARCHITECTURE.md`.
- The harness living outside `packages/`. It is not a product package.
- Query IR as the only compiled form. SQL, later, is a backend for `KbIndex.run(ir)`.

## 6. Highest-leverage next moves

These are enforcements and doc repairs, not a rewrite. The first three are what makes phase 2 stay one mechanism.

1. **Put the kernel in the canonical spec before the registry is rewritten.** A DESIGN.md section that states: a plugin is the only registration mechanism; an array module is the declarative form the loader bridges; points for actions and templates live in `@kb/contracts`; UI contributions are a later point, not a new registry. Update `AGENTS.md` so it points at that section instead of restating the array loop. Spec-first is prose, so this is a human edit — and it is the edit that makes the prose true.
2. **Decide the two-scope shape in that same section.** Backend plugin package and browser plugin package, both depending on `@kb/plugin` and on `@kb/canvas` for the doc. Do not give `ext-canvas` a `./ui` entry under `scope:backend`.
3. **Add one harness check the kernel needs: a package that mentions contribution ids as string literals outside the loader bridge fails, or at least a test that the only `definePlugin` / `makeKernel` construction sites are the registry.** Weaker, and available today: `workspace-shape` already fails a package nobody depends on once you decide phase 1's grace is over. Turn that on when phase 2 merges, not before.
4. **Gap ledger: a gap whose `current` says the work shipped is not an open gap.** Either `ext.check` grows a finding for that, or someone marks those twelve done (after checking the residuals, especially `KbNode.order` and the canvas pointer notes). Cheap, and it stops the next agent redoing g7.
5. **Do not let `@kb/client` grow a private index.** When the query path needs to change, it should be `KbIndex`, including the synchronous limitation, so there is one place to make reads Effectful later.

Not in this list, on purpose: draining the 59 React Compiler warnings, splitting `outline.store.ts`, and the IndexedDB replica. They are real, they are already gap nodes, and they are not what the current trajectory is blocked on.
