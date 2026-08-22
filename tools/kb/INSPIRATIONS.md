# kb — design inspirations

Where each aspect of kb comes from. This is the "why does it feel like X"
record — DESIGN*.md documents the mechanics; this documents the lineage.
Most entries were stated by the project owner during the build program
(2026-08); the ones marked *(research-adopted)* entered via design research
and were approved with the wave that shipped them.

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
| Canvas elements (shapes/tools) | **Excalidraw / draw.io / Miro** | Left tool strip, click-to-place rect/ellipse/diamond, inline labels, color swatches. Freehand, rotation, and z-order deliberately cut (simplicity rule) |
| Canvas file format | **JSON Canvas 1.0 (Obsidian)** | Open interchange format stored in `sys.f.canvas`; unknown node types/fields preserved on round-trip |
| Graph view (concept) | **Obsidian / Logseq global graph** | Universal graph of `[[ref]]`/mention topology (not the outline tree), local/ego neighborhoods, filter-by-tag/query, click→open node. sigma.js + ForceAtlas2 chosen by research explicitly to match Obsidian graph-plugin prior art. Owner directives on top: universal graph button, clean/modular, smart-elide of system/editor-only nodes with a toggle |
| Graph UX + in-graph tools | **nxus** (owner's editor project) | The interaction surface inside a single graph type — how tools, controls, and exploration behave within one rendered graph (`.research/kb-refine/nxus/report.md`) |
| Graph renderer types | **CodeFlow** (github.com/braedonsaunders/codeflow) | The renderer catalog — force 2D, tree/hierarchy, cluster, 3D force as switchable modes over one dataset. Deep-studied in `.research/kb-refine/graphviz/report.md`, which locked the "one graph, many lenses" principle: every viz = datalog query → `{nodes, edges}` → renderer |
| Graph perspectives | **kb-original** (owner design; nearest prior art: Obsidian graph filters/groups) | "A special tag that lets you add a query to scope down stuff, then display as graphs" — `#graph-perspective` nodes carrying datalog query + renderer/color-by/size-by/edge-kinds/cluster-by props, so saved graph lenses are themselves nodes queryable like everything else |
| Visual skin | **nxus** (owner's editor project) | Tokens, type scale, row metrics, chip styling, dark/light palette ported to match nxus exactly (DESIGN-RESKIN.md) |
| Display views (Table/Board/Cards) | **Notion** *(research-adopted)* | Database-view semantics — one node list projected through interchangeable views, per-view config (sort/group/filter/column widths) stored as props on the frame node. Tana's menu was the UX spec; Notion's view model informed what the views do |
| Agent-facing render surface | **MCP Apps** *(research-adopted)* | Saved views served as `ui://kb/view/<name>` HTML resources plus a `render_view` tool over the MCP server — "adding an app = drop a view JSON + template", following the MCP Apps resource shape |

## Standing design rules attached to these inspirations

- **Tana parity is the direction, not a clone mandate** — core mechanisms
  (supertags, fields, views, inheritance) should reach Tana's expressive
  level; chrome stays minimal.
- **Simplicity beats fidelity** (stated during the canvas redesign): any
  feature that demands heavy edge-case handling and plumbing gets simplified
  or dropped — kb is a human/agent-collab KB and must stay maintainable.
- **CLI/backend is the source of truth for functionality**; the UI is a
  projection. Anything the UI can do must be reachable through data
  (e.g. Pinned = `#pinned` tag lookup, no UI-private state).
