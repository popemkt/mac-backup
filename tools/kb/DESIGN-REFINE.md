# kb refinement plan — editor-grade UI + core/extension split (rev 3)

Rev 2 per annotations: bullet-mode catalog (§2 W1), query nodes as pure system nodes (§2 W4), `:node/path-refs` explained (§0), md-swap cost budget (§2 W2), palette perf bar (§2 W3), Electron seam statement (§4).
Rev 3: W6 media/canvas/graph concretized from R5 research (`.research/kb-refine/viz/report.md`).

Synthesized from 4 research reports in `.research/kb-refine/`:
**R1 Tana** (22 live-app screenshots + measured DOM tokens), **R2 nxus** (design-system extraction, file:line), **R3 kb self-audit** (feature inventory + gaps), **R4 editor-tech** (Logseq/Roam/Tana editor + schema prior art, sourced).

Governing constraint (your 1.1): **core = outliner/db + subscription infra + a few example templates. Nothing else.** QoL lives above core; repo-specific output (md files) lives in extensions.

---

## 0. What research settled (decisions locked into this plan)

| Question | Answer | Source |
|---|---|---|
| Editor tech for md nodes | **Plain-text edit + rendered md view swap** (Logseq pattern). No Lexical (history plugin leaked to 3.9GB in stress test), no ProseMirror unless live-WYSIWYG becomes hard requirement. We already have the swap architecture (contentEditable ↔ static div). | R4, R2 §6 |
| Refs as relationship | Already correct: `[[id\|label]]` parsed → `:node/mentions` datom at load — same design as Logseq `:block/refs` (parse-at-transact). Missing piece is **UI rendering + docs**, not model. | R4 §3, R3 gap table |
| `:node/path-refs` (asked in annotation) | Logseq extra: a block also gets ref-datoms for everything its **ancestors** reference — so "show me everything about X" catches nodes nested *under* a node that mentions X, not just direct mentions. Costs index size, pays off in hierarchy-scoped queries. Optional; add only when a real query needs it. | R4 §3 |
| Query-as-node semantics | Query def stored **as a prop on the node** (Tana style, fits props-are-nodes), results rendered as **references to real nodes** (edits hit source), re-run **only while expanded** (Tana cheap-by-default). | R4 §2, R2 §8 |
| Metric system | Adopt nxus numbers wholesale — they're a proven Tana-alike: **24px indent/level, 24×24 bullet hit, 14.5px/1.6 content, 11px chips, 120px field labels, min-h-24px rows**. Tana's own measured baseline (Inter 15/21 = 1.47, bullet 15/5) confirms the ballpark. | R2 §1, R1 §1 |
| Palette shape | Tana = "Search and open" (nodes + commands in one overlay) + small insert menu. nxus palette is app-launcher chrome only — borrow visuals, not model. | R1 §2.5–2.6, R2 §3 |
| Fields UX | Tana: `Name::value`, schema page IS a live query ("Everything tagged #todo"). nxus: field rows under node, type-specific editors, 120px labels. Both point at: **fields inline under node, schema views = query nodes over tags**. | R1 §2.3–2.4, R2 §4 |

Current kb UI baseline (R3): solid v1 — full keyboard editing, collapse/zoom/breadcrumbs, `[[` autocomplete, backlinks panel (`:node/mentions` already queried!), props/tags side panel with correct multi-value semantics, query page with live WS sub, optimistic mutations. 76 backend + 47 UI tests green.

---

## 1. Target architecture — core vs extensions (your 1.1)

```
                           ┌────────────────────────────────────────────┐
                           │                 EXTENSIONS                 │
                           │  (repo-owned, replaceable, NOT core)       │
                           │                                            │
                           │  .kb/extensions/*.ts                       │
                           │  ┌──────────────┐  ┌────────────────────┐  │
                           │  │ docs-todos.ts│  │ your-custom-ext.ts │  │
                           │  │ query → md   │  │ query → anything   │  │
                           │  └──────┬───────┘  └─────────┬──────────┘  │
                           └─────────┼────────────────────┼─────────────┘
                                     │ registered as actions (ext.*)
   ┌─────────────────────────────────▼────────────────────▼─────────────┐
   │                              CORE                                  │
   │                                                                    │
   │   store (JSONL) ── datalog (DataScript) ── action registry         │
   │        │                                        │                  │
   │   subscription hub (WS /ws, live queries)       │                  │
   │        │                                        │                  │
   │   surfaces: CLI ── MCP ── kb ui (outliner)      │                  │
   │                                                                    │
   │   templates: a few EXAMPLE view templates, nothing more            │
   └────────────────────────────────────────────────────────────────────┘

   Rule: core ships mechanism (query, subscribe, act).
         Extensions ship policy (what md to write, where, how it looks).
```

- **Move `docs.materialize` / `docs.check` out of core** into the first bundled extension (`ext.docs`) — proof the seam works; pre-commit keeps calling it, path unchanged.
- Extension = TS module in `.kb/extensions/` exporting harman-style actions; registry loads them at startup (repo-local = trusted). CLI: `kb ext list`, `kb action-invoke '{"id":"ext.docs.materialize"}'`.
- Core keeps `render.view` (rows→md/html templates) as *mechanism* — extensions and MCP resources both feed on it.

## 2. Wave plan

### W1 — Token system + row anatomy (S, cursor)
Replace hardcoded Tailwind sizes with a row token sheet; restructure row to nxus anatomy.

```
 ROW ANATOMY (target)                        tokens
 ────────────────────────────────────────────────────────────
 │◄─ depth × 24px ─►│
                    ┌──┐
 ── tree line ──────│()│  Node text content #tag ⟨chip 11px⟩   ← 14.5px / 1.6
      w:1px         └──┘                                          min-h: 24px
                   24×24    ├─ Status      In progress   ← field row, label 120px
                   bullet   ├─ Due::       2026-08-10       (indent +24px)
                    hit     └─ ⌕ query results…           ← W4
     bullet dot: 4px leaf / 5px parent / dashed ring = ref
```

- `tokens.css`: `--kb-indent: 24px`, `--kb-row-h: 24px`, `--kb-text: 14.5px/1.6`, `--kb-chip: 11px/1.8`, `--kb-field-label: 120px`, oklch palette (nxus scheme, kb accent).
- **Bullet mode catalog** (your annotation: "visible at a glance" is Tana's superpower — every node kind/state readable off the bullet alone). One `Bullet` component, mode × state matrix:

```
  KIND (shape)                          STATE (ring/halo around any kind)
  ────────────────────────              ─────────────────────────────────
  ●  plain node (4px dot)               ( ● )  collapsed-with-children:
  ⬤  parent node (5px dot)                     halo ring (~18px), Tana-style
  #  tag definition node                 ◌     dashed ring: reference row
  ⌗  field definition node                     (query result / embedded ref)
  ⌕  query node (W4)                     ●̶     dimmed: sys.* node
  ⚙  sys/command node (W3)               ●!    accent tint: has unsaved /
  ▣  media node (W6, has image/file)           failed-sync state
  ◇  canvas node (W6)                    ●∘    small count badge: hidden
                                               children count (existing)
  every kind × every state composable; colors from tag (nxus supertag
  palette hash) when node is tagged
```

- Bullet hit area stays 24×24 for all modes; kind glyph ≤ 14px inside.
- **Fields inline under node** (collapsed with node), side panel stays for bulk editing.
- Selection-mode keymap from nxus (↑↓ select, Enter edit, Space collapse, o new, Del delete).
- Tree guide lines, click-to-navigate.

### W2 — Markdown render-swap + ref links (M, cursor)
Logseq pattern on top of existing swap:

```
   ACTIVE (editing)                 INACTIVE (viewing)
  ┌────────────────────┐   blur   ┌─────────────────────┐
  │ **bold** and       │ ───────► │ 𝗯𝗼𝗹𝗱 and            │
  │ [[01ABC|Node X]]   │ ◄─────── │ ⟨Node X⟩ ← link     │
  │ plain text,        │  focus   │ rendered md,        │
  │ same 14.5/1.6      │          │ same 14.5/1.6       │
  └────────────────────┘          └─────────────────────┘
   contentEditable                 micromark render
   (DOM = source of truth)         (inline only: b/i/code/link/ref)
```

- **Cost budget** (your annotation: OK with Logseq pattern only if it stays small): micromark ≈ 7kb gz, render memoized per node text hash, zero cost while editing (edit mode = plain text, no parser in the hot path). If W2 lands >~300 LOC or degrades typing latency, stop and re-evaluate. Escape hatch to ProseMirror stays open (render layer is one component).
- Inline md subset only (bold/italic/code/links) — block md stays plain; **identical line-height both modes** (your 2.3; enforced by shared token class + test).
- `[[id|label]]` renders as accent-colored link (Tana renders refs as blue text links, not chips — R1); click = zoom, ⌘click = jump.
- Code spans get tinted background (Tana pattern).
- Document `:node/mentions` as the official ref relationship in DESIGN.md + AGENTS.md w/ query examples (your 2.4 — closes the loop; model already right).

### W3 — Command palette + everything-is-a-node surfacing (M, cursor)
- ⌘K "Search and open": one overlay, fuzzy over **all nodes incl. field/tag/system nodes** + commands (add node, add tag, define field, toggle theme, go to query page…). Tana model, nxus chrome (backdrop-blur, single list, ↑↓/Enter).
- **Perf bar** (your annotation): index built once per graph rev (not per keystroke), fuzzy match over prebuilt lowercase haystack, results virtualized (render ≤ 20 rows), open-to-first-paint < 50ms and per-keystroke < 10ms at 50k nodes — measured in a test against the benchmark graph.
- Commands modeled **as nodes** (`sys.command` type) so palette content is itself queryable — your 2.1/2.2.
- Schema section: zooming a **tag node** shows its instances (live query "everything tagged X" — Tana schema page); zooming a **field node** shows nodes carrying it. Fields/tags stop being invisible pick-lists (R3 gap).
- `sys.*` write-guard: core actions refuse text/prop edits on `sys.*` unless `--force` (browse yes, break no).

### W4 — Query nodes (L, claude)
Pure system-node modeling (your annotation — no special node type, just more system nodes):

```
  sys.tag.query      ← a TAG node "query" (bullet renders ⌕ for anything tagged)
  sys.f.query        ← FIELD node: the datalog/EDN definition (str prop)
  sys.f.query.limit  ← FIELD node: optional result cap
     └─ future: sys.f.query.filter/sort fields = the visual builder writes
        these instead of raw EDN; builder is UI sugar over the same props
```

A query node = ordinary node + `#query` tag + `sys.f.query` prop. Tag templates the fields (existing mechanism); CLI/MCP/extensions see nothing new. Renders live results in-outline:

```
  ▸ ⌕ Open todos                 ← query node (sys.f.query = "[:find ...]")
  ▾ ⌕ Open todos                 ← expanded → subscribe via /ws
     ○ Fix drift audit  #todo    ← RESULT ROWS = refs to real nodes
     ○ Nix-package kb   #todo       (dashed bullets; edit-in-place hits source;
     ○ Portless mode    #todo        Tab/indent disabled on results)
        …
  collapse → unsubscribe          ← Tana cheap-by-default: live only while open
```

- Reuses existing SubscriptionHub verbatim — no new server work.
- Query page becomes "zoomed query node" + scratch EDN editor; saved queries (`.kb/queries/*.edn`) surface as query nodes under a `sys.queries` root (your 1.2: queries visible as nodes).
- Palette command "New query node".

### W5 — Core/extension split (M, claude)
Architecture in §1: extension loader (`.kb/extensions/*.ts`), `docs.*` → bundled `ext.docs`, `kb ext list`, AGENTS.md + DESIGN.md updated to state the core boundary explicitly. Pre-commit hook path stays working.

### W6 — Multimedia + viz surfaces (M–L, staged; from R5 research)
Your annotation: images/media like Logseq + infinite canvas + graph view — "as many viz options as possible." R5 verdicts (full report: `.research/kb-refine/viz/report.md`):

```
                 one graph, many lenses
                 ──────────────────────
   /api/graph + /ws (existing, unchanged — the ONLY shared data plane)
        │
        ├── /            outline view (today)
        ├── /graph       sigma.js + graphology (MIT, WebGL, 1–50k nodes)
        │                  edges = :node/mentions + ref props; filter/local/global
        │                  are just different datalog queries
        ├── /canvas/:id  JSON Canvas 1.0 (open spec, Obsidian format) stored as
        │                  a prop ON A CANVAS-TAGGED NODE; cards = live kb node
        │                  refs (type "kb-node" + nodeId); thin custom React
        │                  pan/zoom renderer — NOT tldraw
        └── <ext views>  any client of the same protocol

   media: ![alt](assets/x.png) in node.text → UI renders <img>/<video>/<audio>
          files live in .kb/assets/, kb ui serves GET /assets/* read-only
          drag-drop → asset.upload action → writes file, inserts markdown
```

- **License traps caught by research**: tldraw = source-available, production needs paid key → rejected. Cosmograph = CC-BY-NC → rejected as default. Everything chosen is MIT/open-spec (sigma, graphology, JSON Canvas; Excalidraw MIT optional later as drawing→asset dump only, wrong data model for knowledge canvas).
- **Logseq media model copied**: opaque files on disk + markdown syntax in node text + optional `#asset`-tagged nodes for gallery queries. No binary in nodes.jsonl, no media schema in DataScript.
- Core gains exactly two things: static `/assets` serving + `asset.upload` action. Everything else = UI routes/extensions.
- **Build order (annotation: inline viz first, big viz later)**: W6a = **inline media only** (assets dir + `![]()` render in outline + upload action) ships with the main wave train. Graph/canvas/3D move to a dedicated **viz wave (V-wave)** after W1–W6a stabilize.
- **V-wave target bar (annotation): beyond nxus** — 2D force graph, 3D force graph, local/ego graph, folder/stacked (grouped-by-tag/hierarchy) views, canvas — all as `/route` clients of the same query+WS plane; each viz = query + renderer, addable independently. sigma (2D) + react-force-graph-3d (3D) + d3-hierarchy (stacked/tree) per R5 table.
- W1–W5 don't wait on any of this.
- Bullet catalog ties in: `▣` media node, `◇` canvas node (W1 matrix).

### Backlog (kb todos, not this wave)
Drag handles + DnD · multi-select · undo/redo · `:node/path-refs` · md block elements (headings/checkbox render) · insert menu (`/` commands) · theme palettes · nix packaging · portless/UDS.

## 3. Execution

Same machine as tonight: orca run, cursor:claude ≈ 3:1 (W1 cursor → W2 cursor ∥ W3 cursor → W4 claude → W5 claude; W2∥W3 parallel after W1 merges — both touch node-content but different regions; W4/W5 independent of each other after W3).
Each: worktree → build → my verify (tests + live smoke) → cavecrew review → fix → merge. Tests required per wave (token line-height equality test in W1/W2, palette + guard tests W3, subscribe/unsubscribe lifecycle W4, ext loading W5).

## 4. Out of scope (explicit)

- No Electron now — but the seam is kept drop-in ready (your annotation): the UI is a pure HTTP/WS client of the bun server, zero Node/fs access from the browser code. An Electron shell later = `BrowserWindow` pointed at the same server it spawns; no UI or core code changes. The discipline that preserves this: never import server modules into `ui/src`, all effects through `/api/action` + `/ws` (already enforced by the workspace split).
- No Lexical/ProseMirror, no block-level WYSIWYG (W2 escape hatch documented above).
- No journal/AI/calendar — kb stays a plug-and-play graph tool for agents + you, per repo.
- Core gains **zero** repo-specific output logic — that's extension land forever.
