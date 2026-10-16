# kb overnight plans, 2026-10-17

The owner asked for five capabilities tonight. There is one plan for each.
Nothing in them is built, and none is decided until the owner answers its
questions. Main was at `863a1ed2` when they were written, with O3 and O4
(the outline and graph family cut) running in worktrees, and the Cordis
gap 1 work, config as fields with re-apply, expected next.

## The plans, in the owner's rank

| # | Plan | Owner's words |
|---|---|---|
| 1 | [Canvas parity with tldraw offline](2026-10-17-kb-canvas-tldraw-parity/README.md) | "make canvas feature parity with tldraw offline" |
| 2 | [Locations: a picker over saved stores](2026-10-17-kb-locations/README.md) | "an extension to help me pick between saved kb locations? much like logseq itself." |
| 3 | [The agent beyond Claude Code](2026-10-17-kb-agent-providers/README.md) | "the agent plugin with model config chooser and stuff. make it a bit flexible rather than just claude code." |
| 4 | [A family's footprint on the graph](2026-10-17-kb-family-contributions/README.md) | "probably make it so that plugins can declare how it contribute to data graph" |
| 5 | [Tracing and labelling connections](2026-10-17-kb-trace-and-label/README.md) | "ability to trace connections to make out new insights, (also labeling connections where appropriate, probably under a toggle)" |

## Cross-dependencies

Each item below is one mechanism that more than one plan needs. Whichever plan
reaches it first builds it, and the others use it. None of them is built
twice.

- **The seed fold reads declarations, not loaded families.** Two plans need
  the fold to take a declaration whose code is composed by a host:
  - agent A5, so the agent's provider tag and fields can be seeded;
  - contributions C2, which seeds `sys.extension.<name>` for every
    declaration.

  It is one restructure: separate `BUNDLED_DECLARATIONS` (what the fold
  reads) from `BUNDLED_FAMILIES` (what the registry loads). It also bears on
  GAP [[01M43H3T8XEMTNBARC024PZD2W]].
- **Gap 1's config write path for extension nodes.** Four steps need it:
  - agent A5, the provider selection on `sys.extension.agent`;
  - trace T7, the suggestions toggle on `sys.extension.graph`;
  - contributions C2, the family nodes gap 1 writes to;
  - locations, which does not need it.

  `sys.*` nodes are write-protected (`assertSysWriteAllowed`), so these steps
  wait for that path rather than add a second one.
- **Datoms derived when the index is built.** Two steps add derived
  attributes to the datom build (`@kb/query` `index/datoms.ts`), beside
  `:node/mentions`:
  - contributions C3, `:node/owner`, from the fold;
  - canvas P6 and P7, a reference-carrier table so that canvas `nodeId`s
    become mentions.

  Both are "an index option fed from declarations". P6's restructure should
  land first, as the one table, and C3 then adds a second entry to that
  seam, not a parallel option.
- **The edge projection becomes shared.** Trace T0 moves `collectEdges` into
  the graph family's `@kb/graph`, and canvas P13 (a diagram from a query)
  reads it. Both wait for O4.
- **Approval policy nodes in this repository's store.** Two plans add one:
  - "An agent asks before opening a location" (locations L5);
  - "An agent asks before typing a relation" (trace T4).

  Neither action declares `approval: "required"`, because that would also
  block the CLI actor.
- **Actions that reach outside their root.** Locations L2 adds an action-mode
  member, so that MCP stops claiming `openWorldHint: false` for them. Agent
  A7's `ext.agent.models` calls a remote endpoint and should use the same
  member.

## What the overnight builders can start safely

O3 and O4 are cutting `app/ui`, `@kb/ui-sdk`, `@kb/views`' graph keys and seed
ownership. Gap 1 will touch `extension-switch.ts`, `composeHosted` and the
kernel.

| Plan | Steps safe now | Waits |
|---|---|---|
| Locations | L1–L7. New packages; the CLI; `kb ui --port 0`. Only the edits to the `BUNDLED_FAMILIES` and `BUNDLED_EXTENSIONS` lists are shared, and they merge trivially | — |
| Agent | A1–A4 (agent packages only), A6 (the `secret` type in `field-value.ts`) | A5 and A7 wait for gap 1's write path; A10 (Codex) waits for the owner |
| Canvas | none. By the owner's instruction, it starts after O3–O5 | after O3–O5. P1–P7 and P9–P12 need nothing else from the cut; P8 and P14 need O3, P13 needs O4 |
| Trace | none | O4 (T0 moves code O4 is moving); T7 also needs O3 and gap 1 |
| Contributions | none | O4 (C1 changes the fold while O4 moves seeds), and gap 1 for C2; C5 with Cordis gap 4 |

## Recommended order

1. **Tonight, in parallel:** locations L1→L5, and agent A1→A4 then A6.
   Neither touches what O3, O4 or gap 1 are changing.
2. **After gap 1 lands:** agent A5 and A7, then A8 (this repo's CLIProxyAPI
   provider node). Then locations L6 and L7 if they are not done.
3. **After O3–O5 land:** canvas P1–P3, then P6–P8 (pages and drill-down,
   with references), then P5, P11 and P12. Trace T0–T5 can run beside it:
   they share no files with the canvas.
4. **Then:** contributions C1–C4 with Cordis gap 4 (the plugin view), and
   C5. Then trace T6 and T7, canvas P13 and P14, and the rest.

The canvas plan ranks first by the owner's word, and its implementation waits
for O3–O5 by instruction. So the work that can start tonight is locations and
the first half of the agent plan.

## The three owner questions that matter most

1. **Canvas: references now, items-as-nodes (7b) later?**
   *Recommended: yes.* A core reference-carrier seam makes each canvas
   card's `nodeId` a mention, and a board's pages become its child `#canvas`
   nodes. That gives drill-down, back badges and "which canvases show this
   node" without 7b. ([canvas](2026-10-17-kb-canvas-tldraw-parity/README.md),
   questions 1 and 2.)
2. **Agent: providers as nodes, and a core `secret` field type?**
   *Recommended: yes.* A `#agent-provider` node holds the adapter, endpoint,
   credential reference and model, and `sys.extension.agent` holds only the
   selection. The `secret` type means the write check refuses a pasted key
   before it can reach a committed store.
   ([agent](2026-10-17-kb-agent-providers/README.md), questions 1 and 2.)
3. **The fold: seed every family's node and derive ownership, rather than
   store it?** *Recommended: yes.* `sys.extension.<name>` is seeded for every
   declaration, the host-composed agent's included. Ownership is the derived
   `:node/owner`, because O3 and O4 move ownership and a stored edge would go
   stale. ([contributions](2026-10-17-kb-family-contributions/README.md),
   questions 1 and 2.)
