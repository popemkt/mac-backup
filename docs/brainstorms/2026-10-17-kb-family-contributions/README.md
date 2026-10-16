# A family's footprint on the graph: declared, derived, queryable

Plan of 2026-10-17. Nothing here is built. It builds on
[DESIGN.md → Extension families](../../../tools/kb/DESIGN.md#extension-families)
and is the data half of gap 4 ("a plugin view") in the
[Cordis survey](../2026-10-16-kb-cordis-layers/README.md#4-a-plugin-view-over-the-kernel-s-to-m).
Index: [2026-10-17-kb-overnight-plans.md](../2026-10-17-kb-overnight-plans.md).

## What the owner asked

> "probably make it so that plugins can declare how it contribute to data graph"

## What exists today

- **The declaration.** It is `{name, label, optional?, seed?, views?}`
  (`contract/contracts/src/declaration.ts`). Data contributions are the
  `seed` function. Views are listed in it, and `declarationPlugin` contributes
  them from it. That is a bridge rather than a mirror: the plugin's views come
  from the declaration.
- **The fold.** `foldSeed(BUNDLED_DECLARATIONS)` (`@kb/model`, `seed.ts`) fails
  on an id that two declarations seed. So it knows the owner of every seeded
  node, and then discards it.
- **The kernel.** Every contribution records its `owner` (`Contribution.owner`
  in `domain/plugin/src/kernel.ts`), and `kernel.plugins()` gives status.
- **The report.** `kb.manifest.extensions` and `kb ext list` give one row per
  family, `{name, label, optional, enabled, source}`, and the actions of the
  families that loaded.
- **The family node.** `sys.extension.<name>` exists only once someone has
  switched the family. "Neither node is seeded"
  (`contracts/src/extension-switch.ts`).

What these cannot answer:
- who owns `sys.f.canvas` or `sys.tag.canvas`, by query;
- what a family that is switched off would add if switched on;
- which seeded nodes no bundled family owns any longer (data that outlived its
  code).

## The concept in kb's terms

A family's **footprint** is what it adds to the graph and to the runtime:

- **Data:** its seed nodes, meaning tags, fields, options, view-type options
  and view nodes. The fold owns this, and it is known without loading
  anything.
- **Runtime:** actions, templates, view keys and channels; on the page, also
  routes, views, docks, sidebar sections and commands. The kernel that loaded
  the family owns this, and it is known only while the family is loaded.

**Ownership** of a node is the declaration whose seed holds its id.

The framing I was handed, tested:

- **"Contributions become nodes or edges, linked to `sys.extension.<name>`":
  not as stored data.** Both halves fail:
  - **A stored owner on each seed node goes stale.** O3 and O4 are moving seed
    ownership right now. The projection-families plan: "At O3 the option's
    provider becomes the outline family's declaration, while the ref and the
    id stay as they are". The fill-absent pass only fills what is absent, so
    it cannot correct a stored owner. Correcting it on open would break
    "opening never writes".
  - **Runtime contributions as stored nodes mirror code.** They would be
    written at open, and they would drift with every change. Repository
    extensions contribute no seed at all.
- **"'Who owns `sys.f.canvas`' is a datalog query; the plugin view is a
  projection of it": kept, by derivation.** The index emits ownership from the
  fold when it is built, as it already derives `:node/mentions` from text
  (DESIGN.md → Data model, "parse-at-transact"). The datom is derived, it has
  one source, and it is never stored.
- **Family nodes as the hub: kept, by seeding them** (owner question 2). An
  ownership edge needs a node to point at, gap 1 needs a node to carry config,
  and gap 2 (the graph-driven loader) needs one per entry.

## Where it lives

- **Core, mechanism only:**
  - the fold's provenance (`@kb/model`);
  - the derived `:node/owner` attribute (`@kb/query`'s datom build);
  - the `extension.footprint` action (`@kb/operations`, beside
    `extension.switch`);
  - a kernel listing of contributions by owner (`@kb/plugin`).
- **Composition roots:**
  - `@kb/bundled` hands the owner map to every index it builds: the runtime's
    `openKbEffect` and the page's replica;
  - the `kb ui` server adds its hosted kernel's rows, and the page adds its
    own kernel's.
- **No family changes its code.** Each one's footprint follows from what it
  already declares and registers.

## Data model

- **`sys.tag.extension`** ("extension"), seeded by core.
- **`sys.extension.<name>`** for every declaration in the fold: its text is
  the label, it carries the tag, and it holds **no** `enabled` prop. So
  `familyOn` still reads the declared default, and `switchWrites` updates the
  node in place, as it already does when one exists. The new-node pass adds
  them to an existing store once, and no later open writes (the same path
  O2's default-view field took).
- **`:node/owner`.** A derived ref datom from a seeded node to its family's
  node, emitted for every id in `bundledOwners()`. It is never a prop, so
  `node.get` shows no change.

```clojure
; who owns sys.f.canvas
[:find ?label :where [?f :node/id "sys.f.canvas"] [?f :node/owner ?e] [?e :node/text ?label]]
; what canvas seeds
[:find ?id :where [?e :node/id "sys.extension.canvas"] [?n :node/owner ?e] [?n :node/id ?id]]
; seeded-looking nodes no bundled family owns
[:find ?id :where [?n :node/id ?id] [(clojure.string/starts-with? ?id "sys.")] (not [?n :node/owner _])]
```

The last query uses a predicate, so it runs as `raw` (DESIGN.md → Query layer).

- **`FootprintRow`**, the output of the action:
  `{family, kind, id, enabled, source: "seed" | "registry" | "host" | "page"}`,
  where `kind` is `tag | field | option | view-option | node | action |
  template | view | channel | route | dock | sidebar | command`.

## Mechanisms reused and new

**Reused:**
- the fold;
- the datom build that already derives `:node/mentions`;
- the kernel's `owner` records;
- the manifest's extension rows;
- the seed's new-node pass;
- `extensionContract`.

**New:**
1. **`foldSeed` yields provenance.** One fold gives two readings:
   `bundledSeed()`, unchanged, and `bundledOwners(): ReadonlyMap<NodeId,
   string>`.
2. **An index option `owners`.** Without it, no owner datoms are emitted, so
   tests and older callers stay as they are.
3. **`extension.footprint {name?}`** (read). Data rows come from the fold,
   runtime rows from the kernel. Owners resolve through the kernel's plugin
   tree, so a child plugin counts for its family.
4. **`Kernel.contributionsOf(owner)`.**

## Surfaces

- **Datalog:** the queries above, from `kb query`, MCP `graph_query`, `#query`
  nodes and the agent.
- **CLI:** `kb ext footprint <name> [--json]`. `kb ext list` gains a
  "contributes" count per family.
- **MCP and the agent:** `extension.footprint` as a tool with no extra code.
- **UI:**
  - each `sys.extension.<name>` node is a real node, so it opens in the
    outline, and its References section lists what it owns, because
    `:node/owner` joins the references query (owner question 5);
  - the plugin view (survey gap 4) is a table over `#extension` nodes joined
    with `extension.footprint`. This plan stops at handing it its rows.

## The contract suite

`extensionContract` (`@kb/test-kit`) gains these properties for every
bundled family:

- **Its seed is owned.** Every node its declaration seeds is owned by it in
  `bundledOwners()`, and a reloaded index answers `:node/owner` for it. The
  check runs over `STORE_BACKENDS`.
- **Its family node is seeded.** `sys.extension.<name>` holds the label, and
  switching writes only `sys.f.extension.enabled`.
- **Its runtime rows match its kernel.** `extension.footprint`'s runtime rows
  equal what the kernel holds under its plugins, and every action id is in
  `ext.<name>.*` or is one of its declared aliases.
- **Off means data rows only.** For a family switched off, the footprint
  lists its data rows with `enabled: false` and no runtime rows. Switched back
  on, its runtime rows return.
- **Moving ownership writes nothing.** A store seeded under one owner, opened
  after a seed id moves to another family's declaration (the O3/O4 case),
  writes nothing and answers the new owner.

On the page, a case in `ui-plugins.test.ts` checks that the page rows per
family equal that family's page-kernel contributions.

## Steps

| Step | What | Kind | Size | Waits for |
|---|---|---|---|---|
| C0 | This plan; queue nodes | docs | S | — |
| C1 | `foldSeed` yields provenance; `bundledOwners()`. Behaviour unchanged | restructure | S | O4 (it moves seeds) |
| C2 | Seed `sys.tag.extension` and every `sys.extension.<name>`. The extension-switch statement changes. The seed golden is regenerated | add | S | C1; coordinate with gap 1 |
| C3 | The derived `:node/owner` datom; the index `owners` option on both hosts; the DESIGN.md Data model and Query layer bullets | add | M | C2 |
| C4 | `extension.footprint`, `Kernel.contributionsOf`, `kb ext footprint` | add | M | C1 |
| C5 | Page rows; handed to gap 4's plugin view | add | S | C4, O3 |
| C6 | Optional: declared action metadata (owner question 3) | restructure + add | L | owner |

## Questions for the owner

1. **Derive ownership when the index is built**, against storing owner edges.
   *Recommended: derive.* O3 and O4 move ownership, and a stored edge would be
   stale on the day it was written.
2. **Seed the family nodes.** This reverses "Neither node is seeded" and adds
   a node per family to every store, once. *Recommended: yes.* Gaps 1 and 2
   need the same nodes.
3. **Declare action metadata statically**, as views are declared, so that a
   family switched off can still say which actions it would add.
   VS Code's `contributes` is the precedent. The family's backend would then
   only implement ids it declared. *Recommended: later, and only if the plugin
   view needs the off-family action list.* It is an L restructure of every
   family.
4. **Give repository extensions (`.kb/extensions/*.ts`) family nodes.**
   *Recommended: with gap 2, not here.* Their nodes are entries, not seeds.
5. **Let `:node/owner` reach the References section** (backlinks), against
   keeping it to queries. *Recommended: yes.* The References section is how a
   person sees "what points here".
6. **A write footprint**: declare the tags and fields a family's actions
   write, with the contract checking each committed transaction against it.
   *Recommended: not now.* It is valuable for agents and approval, but it is a
   new contract on every action.

## Non-adoptions

- **Actions, templates or UI points as stored nodes.**
- **A stored owner prop on seed nodes.**
- **Registry facts as a second datalog source.** That would be `$ext` beside
  `$`. The action covers it. Revisit if a query must join runtime rows.
- **Cordis effect labels and `getEffects()`.** They are gap 4's concern.
- **A code-defined "plugin metadata" index beside datalog.**
