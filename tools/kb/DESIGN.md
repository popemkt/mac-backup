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
| Runtime | **Bun + TS**, no build step | Vite+ is web-app toolchain, adds ceremony |
| Model | **Everything is a node** — fields and tags included | Tana model; Logseq DB does the same (properties are first-class entities) |

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
  | { t: "str" | "num" | "bool" | "date"; v: string | number | boolean }
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
  (tmp + rename). Milestone 1 includes a benchmark: 50k-node fixture must
  load+query well under 1s. (Will peek at orca's jsonstore for tricks.)
- Backend-agnostic by construction — operations/query/surfaces see only
  `Store` + `KbNode`. Future backends (SQLite cache, dolt, md-outline) slot in
  without touching upper layers.
- No WAL/leases — single-user repo scale, atomic rename suffices.

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

Harman-lite (zod):

- `ActionDefinition { id, title, description, mode: "read"|"apply", inputSchema, outputSchema }` — JSON Schemas via `z.toJSONSchema`, never hand-written.
- `ActionReceipt` = `succeeded | failed` discriminated union, typed failure codes, never throws across boundary.
- `registryFor(root)` builds a handler table per kb root (cached for the
  process); `manifest(root)` + `invoke(ctx, invocation)` dispatch through it.
- Skipped from harman (YAGNI): profiles, pagination cursors, idempotency
  replay, cancellation, A2A/HTTP surfaces. Contracts leave room.

### Core boundary & extensions

Core ships mechanism only: store (JSONL), datalog (DataScript), the action
registry, subscription hub, render backbone (view specs + templates), and the
CLI/MCP/UI surfaces. Policy — what markdown to write where, repo-specific
output of any kind — lives in **extensions**:

- An extension is a TS module in `.kb/extensions/` (repo-local = trusted)
  whose default export is an array of harman-style actions: an
  `ActionDefinition` plus a `handler(ctx, input)` (see `src/extensions.ts`).
- The registry discovers them at build and namespaces ids as
  `ext.<file>.<action>`. A failing module or malformed action warns and is
  skipped — extension errors never crash core. `kb ext list` shows what
  loaded (and what didn't).
- `tools/kb/extensions-bundled/docs.ts` is the bundled example: it owns
  `ext.docs.materialize` / `ext.docs.check`, with the legacy ids
  `docs.materialize` / `docs.check` registered as aliases so pre-commit and
  existing callers are unchanged. Core keeps only the render mechanism the
  extension calls into (`src/operations/docs/`).
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

- **CLI** (`commander`, `#!/usr/bin/env bun`): human commands + `kb action-invoke <json>`; `--json` everywhere.
- **MCP** (`kb mcp`, `@modelcontextprotocol/sdk` stdio): loop manifest → one
  tool per action → handler calls `registry.invoke`; `readOnlyHint` from mode.
- **Agent onboarding**: CLAUDE.md/AGENTS.md section — node model, field/tag
  conventions, 5 example invocations.

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

