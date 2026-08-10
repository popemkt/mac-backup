# `kb` — repo-native outliner datastore (design doc)

A Bun/TS tool living in this repo that persists an outliner graph as
git-friendly JSONL, exposes a datalog query layer (DataScript), and
materializes markdown from queries. One action registry drives CLI and MCP.

**What this actually is** (answering the "graph db?" question): yes — a tiny
graph database plus application features, which is exactly Tana's and Logseq's
architecture. Logseq *is* DataScript in memory (classic parses md → datoms; the
new DB version persists datoms in SQLite). Tana is a proprietary node graph
with supertags/fields/views as app features on top. We build the same shape,
minimal: DataScript = graph engine; our node/field/tag model = app layer.
Reactivity (TanstackDB-style live queries) is how Logseq's UI works —
`d/listen!` on transactions → re-run affected queries. Irrelevant for a
per-invocation CLI (fresh db each run); if we later add watch-mode or a server,
`d.listen` is the hook. Door left open, nothing built.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Name | **`kb`** | confirmed |
| Storage | Backend-agnostic `Store`; **JSONL backend v1** | exact round-trip, line-per-node git diffs. git-lfs rejected (stores blobs, doesn't make them mergeable); dolt-on-branch possible later as another backend |
| Query | **DataScript** in-memory, rebuilt per invocation | real datalog; Cozo persistent backends are binary |
| Surfaces | **CLI + MCP over one action registry** | action is the abstraction (harman pattern) |
| Runtime | **Bun**, no build step | the production `kb` tool (CLI, `kb ui` server, MCP) runs under Bun and may use Bun APIs (`Bun.serve`, `Bun.file`, …) where appropriate |
| Toolchain | **TypeScript 7 + Vite+ (`vp` 0.2.8)** | vp owns lint/check/fmt/UI test; authoritative typecheck is `tsc --noEmit` — see [Runtime/tooling boundary](#runtime-tooling-boundary) |
| Model | **Everything is a node** — fields and tags included | Tana model; Logseq DB does the same (properties are first-class entities) |

## Runtime/tooling boundary

The backend runs on **Bun** in production; the toolchain around it is **Vite+
(`vp` 0.2.8) + TypeScript 7**. The two are deliberately separated:

- **Bun is the production runtime.** `bin/kb` is a bash shim
  (`#!/usr/bin/env bash`) that `exec`s Bun on `src/surface/cli.ts`; the
  `kb ui` server uses `Bun.serve`/`Bun.ServerWebSocket` as the listen/WS/`Bun.file`
  boundary while routing, assets, and the subscription hub are Effect programs;
  the store streams with
  `Bun.file`/`Bun.write`; `Bun.hash` powers change detection. These are
  appropriate Bun APIs and stay.
- **vp owns the tooling.** `tools/kb/package.json` scripts:
  - `typecheck` → `tsc --noEmit` (TS 7, zero-error gate; also enforced by the
    pre-commit hook when `tools/kb/` changes). This is the authoritative
    typecheck — not `vp check`.
  - `lint` → `vp lint` (oxlint)
  - `check` → `vp check --no-fmt` (**lint-only** here: `lint.options.typeCheck`
    is deliberately off in `tools/kb/vite.config.ts` because oxlint-tsgolint
    is not verified as a meaningful gate for this Bun/Effect tree. `--no-fmt`
    skips format; `vp fmt` remains available for incremental adoption)
  - `test` → `bun test` (Bun-dependent backend integration tests keep running
    under Bun). Note: recursive `bun test` from `tools/kb` also discovers many
    `ui/**/*.test.ts(x)` files — only the Vitest-only paths in `bunfig.toml`
    are ignored — so a full backend `bun test` still needs `tools/kb/ui`
    deps installed. The dedicated UI suite is `cd ui && vp test` (Vitest).
- **Backend lint/check never enter `ui/`.** `tools/kb/vite.config.ts` sets
  `lint.ignorePatterns: ["ui/**", …]`. The browser app is its own Vite+
  package (`tools/kb/ui`) with separate install, `vp` config, and gates.
- **Tests are split by runtime need.** Tests that exercise Bun APIs
  (`ui.test.ts`, `query-nodes.test.ts`, store round-trips) stay on `bun:test` —
  forcing them through vp/Vitest would require Bun APIs to exist under a node
  worker. UI component tests that need Vitest mock-hoist / happy-dom stay on
  `vp test` (and are listed in `bunfig.toml` so recursive `bun test` skips them).
- TypeScript 7 removed `baseUrl`; the UI tsconfig uses relative `paths`, and
  the backend tsconfig scopes to backend sources (`src`, `tests`,
  `extensions-bundled`) — it never compiles `ui/`.

## Data model — everything is a node

```ts
type NodeId = string; // ULID, or "sys.*" for seeded system nodes

interface KbNode {
  id: NodeId;
  text: string;
  props: Record<NodeId, PropValue[]>;  // key = FIELD NODE id, not a string
  children: NodeId[];                   // ordered outline
  createdAt: string;
  updatedAt: string;
}

type PropValue =
  | { t: "str"; v: string }
  | { t: "num"; v: number }
  | { t: "bool"; v: boolean }
  | { t: "date"; v: string }
  | { t: "ref"; v: NodeId };
```

- **Fields are nodes.** A field is just a node typed `sys.field` (e.g. node
  `01J..X` text "status"). `props` keys are field-node ids, so fields are
  reusable anywhere, renameable in one place, and can carry their own props
  (description, allowed values) later. Attaching any field to any node is
  legal — tags only *template* fields, never restrict them (Tana semantics).
- **Tags (supertags) are nodes** typed `sys.tag`, holding a `sys.f.fields`
  prop listing field-node refs they template. Applying a tag = adding a
  `sys.f.type` ref prop. Multiple tags per node allowed.
- **System nodes**, seeded on init, are ordinary nodes with reserved ids:
  `sys.field` (the type of fields), `sys.tag` (the type of tags),
  `sys.f.type` (the "type/tag" field), `sys.f.fields` (tag→templated fields).
  That's the whole special set; everything else is user space.
- **Name resolution**: CLI/actions accept field/tag *names*; resolver does a
  unique-text lookup among `sys.field`/`sys.tag` nodes (error on ambiguity,
  `--create` to mint). Resolution is dynamic at load — at our scale (\<\<100k
  nodes) caching is premature; revisit only if load profiling says so.
- **Refs / `:node/mentions` (official ref relationship).** Wiki-links in
  node `text` use `[[node-id|label]]` (or bare `[[node-id]]`). At datom
  build time each target becomes a `:node/mentions` ref datom on the
  source — same shape as Logseq `:block/refs` (parse-at-transact). The UI
  renders inactive refs as accent links (click = zoom, ⌘/Ctrl-click =
  jump); the relationship itself is queryable, not UI-only. Example —
  nodes that mention a target:

  ```
  [:find ?from ?text
   :where [?e :node/mentions ?m]
          [?m :node/id "n.root-a"]
          [?e :node/id ?from]
          [?e :node/text ?text]]
  ```

  (`kb backlinks <id>` is the shorthand.) Optional Logseq-style
  `:node/path-refs` (ancestor mentions) is backlog — add only when a
  real query needs hierarchy-scoped reach.
- Datom mapping: `[id :node/text v]`, `[id :node/child child]` (+order),
  `[id :f/<fieldId> v]` with ref values as entity refs → native datalog joins
  and graph traversal.

## Storage (horizontal)

```ts
interface Store {
  load(): Promise<KbNode[]>;
  commit(tx: { upserts: KbNode[]; deletes: NodeId[] }): Promise<void>;
}
```

- **JsonlStore v1**: `.kb/nodes.jsonl`, one canonical-JSON node per line,
  sorted by id, sorted keys → stable bytes, mergeable diffs.
- **Performance is a stated requirement**: streaming line parse (no
  read-whole-string-then-split), single-pass datom build, atomic write
  (unique tmp + rename; prior file copied to `nodes.jsonl.bak`). Milestone 1 includes
  a benchmark: 50k-node fixture must load+query well under 1s. (Will peek at
  orca's jsonstore for tricks.) `.bak` / `nodes.jsonl.*.tmp` / `nodes.jsonl.lock`
  are gitignored — only the live `nodes.jsonl` is committed.
- **Load is all-or-nothing**: a malformed or schema-invalid line fails the load
  with a line-numbered error and returns no nodes; load never rewrites the file
  (same fail-closed posture as the pre-Schema `JSON.parse` loader). Unknown own
  JSON properties on otherwise-valid nodes are preserved across decode so a later
  commit cannot silently drop them.
- **Commit validates before durable write**: each upsert and the merged snapshot
  must decode via the persistence `KbNodeSchema` (correlated PropValue `t`/`v`,
  matching wire). Invalid input fails `invalid_input` and leaves the live file
  untouched. Temp files are cleaned on write/copy/rename/interrupt failure.
- **Concurrency**: multi-surface writers (UI/CLI/MCP/agents) and multiple
  `JsonlStore` instances on the same path are in contract. Commits serialize via
  an exclusive `nodes.jsonl.lock` acquired by write-then-`link` (payload is
  never observed empty mid-create). Empty/unparseable lock bodies are treated
  as held; stale takeover renames the lock away (atomic single winner) then
  retries; release unlinks only when the well-known path still shares the
  owner's sidecar inode. Locks with a dead pid, or a live pid older than
  `COMMIT_LOCK_STALE_MS` (pid-reuse / abandoned), are reclaimable. Acquisition
  is Effect-interruptible. Unique temps prevent same-ms collisions. Still
  single-user repo scale — no WAL.
- Backend-agnostic by construction — operations/query/surfaces see only
  `Store` + `KbNode`. Future backends (SQLite cache, dolt, md-outline) slot in
  without touching upper layers.

## Query layer (horizontal)

- `datascript` npm. Load → datoms → `conn` → query.
- `kb query '<edn datalog>'` for raw power; pull API via `kb get <id> --depth N`.
- **Saved queries are data, not code** (portability): `.kb/queries/*.edn`
  files, run via `kb run <name>`. The tool stays generic; repo-specific
  queries travel with the repo's data dir. Any repo adopting `kb` brings its
  own `.kb/queries/`. Shell-script wrappers optional on top, zero baked-in.
- Built-in shorthands limited to structural ones: `kb backlinks <id>`,
  `kb children <id>`, `kb search <text>`.

## Action registry

Harman-lite (zod) + Effect-native handlers for owned actions:

- `ActionDefinition { id, title, description, mode: "read"|"apply", inputSchema, outputSchema, effect? }` — JSON Schemas via `z.toJSONSchema`, never hand-written. Optional `effect` is the Effect-native handler seam for built-ins / bundled extensions.
- `ActionReceipt` = `succeeded | failed` discriminated union, typed failure codes, never throws across boundary.
- `registryFor(root)` builds a handler table per kb root (cached for the
  process); `manifest(root)` + `invoke(ctx, invocation)` / `invokeReceiptEffect` dispatch through it.
- Dispatch prefers `effect` and composes it under `Effect.scoped` (finalizers / interrupt). Legacy Promise `handler`s (third-party `.kb/extensions`) are the only path lifted via `tryPromise`.
- Skipped from harman (YAGNI): profiles, pagination cursors, idempotency
  replay, A2A surfaces. Contracts leave room; Fiber interrupt covers cancellation for native handlers.

### Core boundary & extensions

Core ships mechanism only: store (JSONL), datalog (DataScript), the action
registry, subscription hub, render backbone (view specs + templates), and the
CLI/MCP/UI surfaces. Policy — what markdown to write where, repo-specific
output of any kind — lives in **extensions**:

- An extension is a TS module in `.kb/extensions/` (repo-local = trusted)
  whose default export is an array of harman-style actions: an
  `ActionDefinition` plus either Effect `effect(input)` (preferred) or a
  legacy Promise `handler(ctx, input)` (see `src/extensions.ts`).
- The registry discovers them at build and namespaces ids as
  `ext.<file>.<action>`. A failing module or malformed action warns and is
  skipped — extension errors never crash core. `kb ext list` shows what
  loaded (and what didn't).
- `tools/kb/extensions-bundled/docs.ts` / `canvas.ts` are Effect-native
  bundled examples (`effect` handlers using `KbCtx` / `FileSystem` /
  `KbStore` Layers). Docs owns `ext.docs.materialize` / `ext.docs.check`,
  with legacy aliases `docs.materialize` / `docs.check`. Core keeps only the
  render mechanism the extension calls into (`src/operations/docs/`).
- Extensions are loaded once per process; changing one requires restarting
  long-lived surfaces (`kb ui`, `kb mcp`).

## Operations (verticals)

| Action | Mode | Does |
|---|---|---|
| `node.add` | apply | create (text, props by field name/id, parent, position, tags) |
| `node.update` | apply | edit text / set-unset props / move / delete |
| `node.get` | read | pull subtree to depth N |
| `field.define` / `tag.define` | apply | mint field/tag nodes (sugar over node.add) |
| `graph.query` | read | raw datalog → JSON rows |
| `graph.run` | read | execute saved query from `.kb/queries/` |
| `graph.search` | read | text/prop filter convenience |
| `ext.docs.materialize` (alias `docs.materialize`) | apply | run view specs → write md (bundled extension) |
| `ext.docs.check` (alias `docs.check`) | read | materialize to memory, diff vs disk (bundled extension) |

## Materialization

- View specs `.kb/views/*.json`: `{ output, query | savedQuery, template }`;
  templates = named TS functions (rows → md), no template-lang dep.
- **v1 ships exactly one view: `docs/kb/todos.md`** (nodes tagged `todo`,
  grouped by status). Curation of more views comes later, driven by tags.
- Generated files carry `<!-- generated by kb; do not edit -->`.
- **`docs.check` in pre-commit from day 1**: `.githooks/pre-commit` gains a
  `kb check` step in the same milestone that ships materialize (M4).

## Surfaces

- **CLI** (`commander`, `#!/usr/bin/env bun`): human commands + `kb action-invoke <json>`; `--json` everywhere. Internal command orchestration is Effect (`resolveRootEffect` → `openKbEffect` → `runPlanEffect` / `invokeReceiptEffect`) with an `Effect.runPromise` + exit-code boundary at each Commander surface action (not a claim that the whole process has a single runPromise). Commander itself stays the argv contract.
- **MCP** (`kb mcp`, `@modelcontextprotocol/sdk` stdio): loop manifest → one
  tool per action → Effect handler (`callToolEffect` / resource Effects via `reloadEffect` + `invokeReceiptEffect`); `readOnlyHint` from mode. SDK request handlers remain Promise-returning; CallTool maps Fail/Die to `isError`, resource Fail/Die to JSON-RPC `-32603`.
- **Agent onboarding**: CLAUDE.md/AGENTS.md section — node model, field/tag
  conventions, 5 example invocations.

### Remaining Effect surface boundaries

- `surface/ui/**` HTTP routing, assets, and SubscriptionHub are Effect programs;
  Bun.serve remains the listen/WS/`Bun.file` boundary (see Runtime/tooling
  boundary and DESIGN-UI.md). `/api/action` composes `invokeReceiptEffect`
  directly (no nested `invoke` Promise).
- Repository-owned / core / bundled action handlers are Effect-native end to
  end (`effect` + Layers). Third-party `.kb/extensions` may still export
  Promise `handler`s; those alone use `tryPromise` inside `invokeEffect`.
- Registry discovery still uses dynamic `import()` of extension modules
  (Promise at the load boundary). Standard Schema `validate` may return a
  Promise and is lifted once at parse time.
- Surface tips (`CLI` Commander actions, MCP SDK handlers, `Bun.serve`) still
  call `Effect.runPromise` / `runPromiseExit` at the process edge — not inside
  action handlers.
- No `@effect/cli` adoption (Commander preserved by design).

## Repo integration

- Code `tools/kb/` (repo tooling, not system config). Committed lockfile.
- Data `.kb/` (nodes.jsonl, queries/, views/). Generated docs `docs/kb/`.
- Shell alias `kb` in `modules/common/home-manager/shell.nix`.
- MCP registration via `ai-agents` stack.
- JSONL = intentional repo data → committed, not Mackup.
- Seed: migrate current `TODO.md` items into tagged todo nodes (M5).

## Milestones

- **M1 Core**: model, system-node seed, JsonlStore (+50k benchmark), DataScript adapter, contracts, registry, `node.*`, `graph.query`. bun tests.
- **M2 CLI**: commander wiring, name resolver UX, saved queries (`kb run`), shorthands.
- **M3 MCP**: stdio server, manifest-driven registration.
- **M4 Materialize**: view specs, todos.md view, `docs.check` + pre-commit hook wiring.
- **M5 Integration**: alias, ai-agents MCP wiring, CLAUDE.md section, TODO.md migration.

## Execution: orca orchestration, cursor:claude ≈ 3:1

- M1 first (everything depends on contracts + store). After M1 merges,
  **M2/M3/M4 run fully parallel** in separate orca worktrees — they touch
  disjoint dirs (surface/cli, surface/mcp, operations/docs-*). M5 last on main.
- Worker assignment: **cursor agents** implement M1, M2, M3 (3 workers);
  **claude agent** takes M4 (materialize + hook touches `.githooks`, closest
  to repo conventions). ≈3:1.
- I orchestrate via orca-cli: dispatch, wait on worker_done, run
  `cavecrew-reviewer` on each worktree diff, **fix findings myself**, merge
  sequentially (M1 → parallel trio → M5).

