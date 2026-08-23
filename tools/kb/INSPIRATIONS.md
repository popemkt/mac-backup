# kb — design inspirations

Where each aspect of kb comes from. This is the "why does it feel like X"
record — DESIGN*.md documents the mechanics; this documents the lineage.
Most entries were stated by the project owner during the build program
(2026-08); the ones marked *(research-adopted)* entered via design research
and were approved with the wave that shipped them. A few are marked
*(researched, parked)* — the idea was studied and deliberately not built yet;
they are listed so the lineage is on record if a later wave adopts them.

| Aspect | Inspiration | What was taken |
|---|---|---|
| Data model (everything-is-a-node, supertags) | **Tana** | Tags template fields; fields and tags are themselves nodes; props keyed by field-node id; "Tana parity" is the stated bar for core functional requirements (incl. the open tag-inheritance investigation) |
| Outliner editing UX | **Tana** | Node rows with inline fields, ⌘K node command palette, ref links, zoom-in navigation |
| View options UX | **Tana** | List is the default view and shows no chrome; "View as: Table/Board/Cards" lives in the node ⌘K menu; view toolbar appears only on expanded non-list nodes. Directly modeled on Tana's "View as" menu (owner supplied a Tana screenshot as the spec) |
| Sidebar | **Tana** | Collapsible left rail with shortcuts (Home / Graph / Canvases) and a **Pinned** section — explicitly "a sidebar like Tana", and explicitly *Pinned*, not Favorites |
| Query model | **Roam/Logseq lineage (DataScript)** | Datalog queries over the node graph; `#query` nodes render live results in the outline, in the spirit of Logseq/Roam query blocks |
| Editor/data boundary | **Logseq** | Editor concerns are read-time defaults, never write-time requirements — the CLI/backend stays the source of truth for functionality |
| Canvas purpose | **draw.io** (also Miro) | "Free-form thinking… add things and connect things" — a thinking surface first; media cards planned; connections are an afterthought, not the point |
| Canvas node/edge semantics | **Logseq whiteboards** | Edges are drawings, not relationships. Owner asked "how does Logseq address this?" and adopted its answer: no edge↔prop reconciler, one-shot native bind only, bound-state computed at render. Chosen deliberately over an edge-sync model to avoid edge-case plumbing |
| Canvas elements (shapes/tools) | **Excalidraw / draw.io / Miro** | Left tool strip, click-to-place rect/ellipse/diamond/group, inline labels, color swatches. Freehand and rotation deliberately cut (simplicity rule); z-order was cut then re-added in the 2026-08-23 wave as bring-to-front / send-to-back |
| Canvas file format | **JSON Canvas 1.0 (Obsidian)** | Open interchange format stored in `sys.f.canvas`; unknown node types/fields preserved on round-trip |
| Graph view (concept) | **Obsidian / Logseq global graph** | Universal graph of `[[ref]]`/mention topology (not the outline tree), local/ego neighborhoods, filter-by-tag/query, click→open node. sigma.js + ForceAtlas2 chosen by research explicitly to match Obsidian graph-plugin prior art. Owner directives on top: universal graph button, clean/modular, smart-elide of system/editor-only nodes with a toggle |
| Graph UX + in-graph tools | **nxus** (owner's editor project) | The interaction surface inside a single graph type — how tools, controls, and exploration behave within one rendered graph (`.research/kb-refine/nxus/report.md`) |
| Graph renderer types | **CodeFlow** (github.com/braedonsaunders/codeflow) | The renderer catalog — force 2D, tree/hierarchy, cluster, 3D force as switchable modes over one dataset. Deep-studied in `.research/kb-refine/graphviz/report.md`, which locked the "one graph, many lenses" principle: every viz = datalog query → `{nodes, edges}` → renderer |
| Graph perspectives | **kb-original** (owner design; nearest prior art: Obsidian graph filters/groups) | "A special tag that lets you add a query to scope down stuff, then display as graphs" — `#graph-perspective` nodes carrying datalog query + renderer/color-by/size-by/edge-kinds/cluster-by props, so saved graph lenses are themselves nodes queryable like everything else |
| Visual skin | **nxus** (owner's editor project) | Tokens, type scale, row metrics, chip styling, dark/light palette ported to match nxus exactly (DESIGN-RESKIN.md) |
| Display views (Table/Board/Cards) | **Notion** *(research-adopted)* | Database-view semantics — one node list projected through interchangeable views, per-view config (sort/group/filter/column widths) stored as props on the frame node. Tana's menu was the UX spec; Notion's view model informed what the views do |
| Agent-facing render surface | **MCP Apps** *(research-adopted)* | Saved views served as `ui://kb/view/<name>` HTML resources plus a `render_view` tool over the MCP server — "adding an app = drop a view JSON + template", following the MCP Apps resource shape |
| Ontologies (scoped lenses) | **kb-original** (owner design) + **Tana** supertags | Owner design; its *anatomy* is deliberately cloned from kb's own `#graph-perspective` (a saved lens that is itself a node, configured by props, listed in the sidebar, picked from a popover) so it costs almost no new concepts. Tana contributes the membership vocabulary — a tag names a set, and `include` pulls that set in. Tag *inheritance* was explicitly **not** copied: the Tana capture has no evidence for its mechanics, so `extends` is plain set union over ontologies. RDF/OWL/SKOS semantics are a named non-adoption (`extends` is union, not subsumption; there is no reasoner) |
| Canvas direct manipulation | **Excalidraw** | Marquee multi-select, drag threshold before a move commits, magnetic alignment guides, zoom-to-fit, one-shot vs sticky tool modes, undo ring buffer. Adopted in the 2026-08-23 canvas wave as the bar for "feels professional"; cursor-centred scroll zoom is the known remaining gap |
| Editor transient rows | **Tana** | No permanent ghost bullet at the end of a list. `Enter` or a click on the whitespace strip mints a *real* node immediately; a session-minted node that is still empty when focus leaves is silently pruned. Chosen over ghost rows explicitly because phantom rows caused input-sync bugs (r1-editor.md §3.3) |
| Graph interaction vocabulary | **CodeFlow** *(research-adopted)* | Select-in-place with neighbourhood lighting instead of navigate-to-inspect, animated cameras (fit/zoom/focus), worker-driven force layout with auto-settle, in-graph search composing with legend filters as an intersection, directed arrows, and edge width scaling with `√weight` from deduplicated parallel edges. The renderer *catalog* row above is the same source; this row is the interaction layer inside one renderer |
| Conditional semantic writes | **Zerolang** *(researched, parked)* | An `expect` precondition on mutating actions (graph identity / node hash / prop value) so an agent's write states the snapshot it assumed and fails atomically via the existing `conflict` receipt. Studied in r8-zerolang.md §1; **not implemented** — the 2026-08-23 wave shipped only a write lock, which serializes writers but does not make a reader's snapshot binding. Zerolang's binary store, patch DSL, and editable-projection model are explicit non-adoptions |

## Standing design rules attached to these inspirations

- **Tana parity is the direction, not a clone mandate** — core mechanisms
  (supertags, fields, views, inheritance) should reach Tana's expressive
  level; chrome stays minimal.
- **Simplicity beats fidelity** (stated during the canvas redesign): any
  feature that demands heavy edge-case handling and plumbing gets simplified
  or dropped — kb is a human/agent-collab KB and must stay maintainable.
- **CLI/backend is the source of truth for functionality**; the UI is a
  projection. Anything the UI can do must be reachable through data
  (e.g. Pinned = `#pinned` tag lookup, no UI-private state). The ontology wave
  is the current worked example: the UI's whole scoped reading mode is exactly
  `kb ontology members <id>`.
- **A broken definition must never make a surface unopenable** (stated during
  the ontology wave, and already the posture of `buildTreeForest`): cycles,
  malformed EDN, unknown refs and size caps surface as *warnings* attached to
  the result, never as a thrown error.
