# Research Report r3: Canvas Professionalism Overhaul Plan

**Author:** `omp` (Canvas Research Specialist)  
**Date:** 2026-08-23  
**Status:** Complete Specification for Implementation Wave `I1` (`i3-canvas`)  
**Target Surface:** `tools/kb/src/canvas/**`, `tools/kb/ui/src/components/canvas/**`, `tools/kb/ui/src/lib/canvas-*`  
**Core Reference Documents:** `tools/kb/INSPIRATIONS.md`, `tools/kb/DESIGN-REFINE.md`, `.research/kb-refine/canvas/report.md`

---

## 1. Executive Summary & Canvas Mission

The `kb` canvas is a **free-form thinking and spatial reasoning surface** modeled on the speed and direct manipulation feel of **Excalidraw, draw.io, and Miro**, strictly governed by kb's **deliberate simplicity rule** and **Logseq whiteboards model**.

### Foundational Principles Locked by Research & Invariant Contracts
1. **Canvas Purpose (draw.io / Miro):** A thinking surface first. Users place notes, brainstorm ideas, draw shapes, and map connections spatially.
2. **Edge Semantics (Logseq Whiteboards):** **Edges are drawings, not database relationships.** The canvas is not an ERD editor. Edges do not enforce or auto-sync DataScript schema. Native binding to a ref prop is a deliberate, one-shot action via `ext.canvas.tx.apply`; afterward, the edge is a drawing whose bound status is computed dynamically at render time. No two-way edge↔prop reconciler exists or will be added.
3. **Open Interchange Format (JSON Canvas 1.0):** The canvas document conforms strictly to the [JSON Canvas 1.0 Specification](https://jsoncanvas.org/spec/1.0/). It is stored as a JSON string in the `sys.f.canvas` prop of a `#canvas`-tagged node. Forward and backward compatibility is guaranteed: all unrecognized node types, custom shapes, and third-party fields (`extra`) round-trip losslessly.
4. **Deliberate Simplicity (Simplicity Beats Fidelity):** Heavy canvas features that demand complex state machines or fragile edge-case plumbing (freehand pen strokes, arbitrary rotation matrices, complex bezier control handles, multi-layer numeric z-indexes) are **deliberately cut**. The UI is a lightweight, high-performance React SVG/DOM stage.
5. **Data Safety Separation:** Removing a `kb-node` card from the canvas document removes only that visual card instance. It **never** mutates or deletes the underlying node entity in the kb database.

---

## 2. Comprehensive Canvas Audit (Everything Broken, Clunky, or Missing)

A line-by-line inspection of `tools/kb/ui/src/components/canvas/**`, `tools/kb/src/canvas/**`, and related shell navigation identified 38 distinct defects and gaps across 6 operational areas.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CURRENT CANVAS STATE: AUDIT                        │
├──────────────────────┬──────────────────────────┬───────────────────────────┤
│ Node Lifecycle / CRUD│ Selection & Keyboard     │ Pointer & Drag Quality    │
│ • NO NODE DELETE     │ • Single selection only  │ • 0px drag threshold      │
│ • No multi-select    │ • No rubber-band marquee │ • Ghost edge invisible    │
│ • No group editing   │ • No Cmd+A, nudging      │ • Port hit target = 10px  │
│ • 1-line shape text  │ • Fragmented state       │ • 1 corner resize handle  │
├──────────────────────┼──────────────────────────┼───────────────────────────┤
│ Edge UX Deficiencies │ Node Cards & Media       │ List Page & Header Flow   │
│ • 1.5px click target │ • No image/asset cards   │ • Canvas title uneditable │
│ • Target port fixed  │ • No link previews       │ • No canvas search/filter │
│ • No label rendering │ • Overflow clipping      │ • No canvas delete/clone  │
│ • Ignored edge color │ • No group drag grouping │ • Empty state unpolished  │
└──────────────────────┴──────────────────────────┴───────────────────────────┘
```

### 2.1 Node Lifecycle & CRUD Gaps
1. **Complete Lack of Node Deletion (P0 Headline Defect):** There is no key listener for `Delete` or `Backspace`, no context menu, and no delete affordance in any toolbar or inspector for canvas cards. Once placed, a node remains permanently on the canvas unless raw JSON is manipulated.
2. **Missing Cascade Deletion of Incident Edges:** When removing a node, any edge where `fromNode === id || toNode === id` must be automatically pruned (implemented in `doc.ts:removeCanvasNode`, but completely uncalled from the UI).
3. **Card Delete vs Node Entity Delete Confusion:** The UI lacks clear semantic boundaries. Deleting a `kb-node` card must only purge the layout card from the canvas document, never deleting the node from the DataScript database.
4. **Shape Card Label Editing Limits:** `ShapeCard` uses a single-line HTML `<input>` on double-click (`shape-card.tsx:160`). Multiline labels, line breaks (`Shift+Enter`), and vertical centering of multiline text are impossible.
5. **Group Nodes are Inert Stubs:** `CanvasPage` renders `isGroupNode(card)` as a static dashed `div` (`canvas-page.tsx:644`). It cannot be selected, dragged, resized, labeled, or styled. Moving a group does not move the nodes inside it.
6. **Unknown / File / Link Nodes are Grey Boxes:** Non-kb nodes render as `<div className="...">{card.type}</div>` (`canvas-page.tsx:774`), with no image preview, link preview, or interaction.
7. **TextCard Raw Textarea Flaws:** `TextCard` renders an unstyled `<textarea>` with no markdown preview when unfocused, no auto-resize height, and stops pointer event propagation completely (`canvas-card.tsx:210`).

### 2.2 Selection & Multi-Selection Gaps
8. **Strict Single-Selection Constraint:** State is modeled as `selectedCard: string | null` and `selectedEdge: string | null` (`canvas-page.tsx:68-69`). Selecting multiple cards or mixed cards and edges is impossible.
9. **No Rubber-Band Marquee Selection:** Clicking and dragging on the canvas background does nothing (or pans if `Alt`/`Space` held). There is no rectangular selection marquee to box-select groups of nodes.
10. **No Additive Selection (`Shift+Click` / `Cmd+Click`):** Clicking a second card immediately discards the first selection.
11. **No `Select All` (`Cmd+A`):** Pressing `Cmd+A` triggers browser default text selection across the whole page DOM instead of selecting all canvas elements.
12. **Fragmented Focus & Selection State:** `selectedCard` in `CanvasPage`, `activeNodeId` in `outline.store`, and `shapeInspectorAnchor` have desynchronized lifecycles. Selecting an edge leaves the card selection active in background stores.
13. **Inconsistent Visual Focus Styling:** `ShapeCard` uses `border-primary/40 shadow-sm`, `TextCard` uses `border-primary/40` (no shadow), and diamond shapes use SVG stroke `var(--primary)`.

### 2.3 Keyboard & Shortcut Gaps
14. **No Keyboard Shortcuts for Tools:** Users must manually click the toolbar. Standard shortcuts (`V` select, `T` text, `R` rect, `O`/`C` ellipse, `D` diamond, `N` kb-node, `F`/`G` frame/group, `H`/`Space` pan) are missing.
15. **No Nudge Navigation:** Arrow keys (`ArrowLeft`, `ArrowRight`, `ArrowUp`, `ArrowDown`) do not move selected cards (1px normal, 10px with `Shift`).
16. **No Zoom Shortcuts:** `Cmd +`, `Cmd -`, `Cmd 0` (reset 100%), `Shift 1` (zoom to fit), `Shift 2` (zoom selection) are not implemented.
17. **No Copy / Paste / Duplicate:** `Cmd+C`, `Cmd+V`, and `Cmd+D` are unhandled, forcing manual re-creation of duplicate structures.
18. **`Escape` Key Incompleteness:** `Escape` reverts the tool to `"select"` but fails to clear current card/edge selections or close popovers consistently.

### 2.4 Pointer Quality, Dragging, & Hit Targets
19. **Zero Drag Threshold (Hair-Trigger Moves):** In `onPointerDownStage` and `onMoveStart`, any pointer down immediately engages move mode (`canvas-page.tsx:288`). A simple click with a 1px hand tremor triggers a drag state, marking the document dirty and enqueuing background HTTP persists.
20. **Missing Pointer Capture:** Pointer capture is inconsistently applied (`(e.target as HTMLElement).setPointerCapture?.(e.pointerId)` is in some card components but missing in `KbNodeCard` and `TextCard`), causing drags to slip and drop when moving quickly outside card boundaries.
21. **Single 1-Corner Resize Handle:** Resizing is restricted to a single 12x12px handle at the bottom-right corner (`cursor-se-resize`). Resizing from top, left, right, or other corners is impossible.
22. **Invisible Ghost Edge During Creation (Critical Glitch):** When dragging from a port (`dragRef.current.kind === "edge"`), `CanvasPage:342` updates pointer coordinates and calls `setPan` to trigger re-renders, but **no temporary SVG `<path>` is rendered**. The user drags an invisible cursor across the screen with zero visual feedback.
23. **Hardcoded Target Port (`toSide: "left"`):** When releasing an edge connection over a target card (`canvas-page.tsx:364`), the engine hardcodes `toSide: "left"` regardless of which port or side the cursor is hovering over.
24. **Microscopic Port Hit Targets:** Port buttons are 10x10px (`h-2.5 w-2.5`) and only appear on hover (`group-hover/card:opacity-100`). Users frequently misclick when attempting to initiate connections.
25. **Origin-Biased Wheel Zooming:** `onWheel` (`canvas-page.tsx:206`) scales `zoom` around the canvas origin `(0, 0)` rather than centering zoom on the mouse cursor `(clientX, clientY)`. Zooming in on a card pushes that card completely out of the viewport.

### 2.5 Edge UX Deficiencies (Within "Edges are Drawings")
26. **Impractically Thin Edge Hit Targets:** The SVG `<path>` has `strokeWidth={1.5}` (`canvas-page.tsx:619`). Clicking a 1.5px bezier curve requires extreme cursor precision.
27. **No Edge Endpoint Re-routing:** Once an edge is created, dragging its source or target endpoint to attach to a different card or side is impossible. The user must delete the edge and redraw it.
28. **Edge Labels Ignored and Un-editable:** `CanvasEdge` defines `label?: string`, but `canvas-page.tsx` never renders an SVG `<text>` or label container, and `EdgeInspector` provides no label input.
29. **Hardcoded Arrowhead Display:** `CanvasEdge` supports `fromEnd` and `toEnd` (`"none" | "arrow"`), but the UI hardcodes `toEnd: "arrow"` and provides no inspector controls to switch directions or remove arrowheads.
30. **Edge Colors Ignored in SVG:** `CanvasEdge.color` is supported in data models but omitted from the rendered SVG `<path>` class/style (`canvas-page.tsx:620`).
31. **Looping Bezier Artifacts:** `edgePath` (`edge-path.ts:25`) computes a rigid cubic bezier. When cards are closely stacked or inverted, the control points produce severe visual loops and kinks.

### 2.6 Canvas List Page & Canvas Creation Sweep
32. **Canvas Header Title is Uneditable:** In `canvas-page.tsx:505`, the canvas node row renders a static `<span>{canvasNode.text}</span>` instead of an editable `NodeContent`. **Users cannot rename a canvas from inside the canvas page.**
33. **Canvas List Page Lacks Actions:** `canvas-list-page.tsx` renders a basic list with a "New canvas" button. It lacks search/filtering, canvas deletion, inline renaming, duplicate canvas, or sorting.
34. **Canvas List Empty State is Sterile:** Displays plain text `"No canvases yet..."` without templates, onboarding cards, or keyboard shortcuts.
35. **Creation Flow Lacks Title Customization:** `createCanvasNode()` hardcodes `"Untitled canvas"` without a prompt or auto-focus rename experience.
36. **No Canvas Export Options:** Users cannot export a canvas to JSON Canvas format, PNG/SVG image, or markdown.
37. **No Clear Canvas / Canvas Reset:** No action exists to reset viewport, zoom to fit content, or clean orphan nodes.
38. **Sidebar Integration Lacks Context Menu:** The sidebar `#canvas` items (`sidebar.tsx:182`) do not offer right-click / ⌘K actions to rename or delete canvases.

---

## 3. Interaction Model Specification (MUST Statements)

To reach the polish and direct-manipulation feel of Excalidraw, Miro, and draw.io, the canvas subsystem MUST implement the following normative interaction contract.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          UNIFIED SELECTION & DRAG ENGINE                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   PointerDown on Stage                                                      │
│        │                                                                    │
│        ├── Dist < 4px ────► Click / Clear Selection / Place Tool            │
│        │                                                                    │
│        └── Dist ≥ 4px ────► Engages Rubber-Band Marquee Selection           │
│                                                                             │
│   PointerDown on Selected Node                                              │
│        │                                                                    │
│        ├── Dist < 4px ────► Select Node / Open Inspector / Focus Text       │
│        │                                                                    │
│        └── Dist ≥ 4px ────► Multi-Node Move (Translates all Selected Nodes) │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Tool Strip & Placement Model
- **MUST** provide the following toolbar tools:
  1. `select` (Hotkey: `V` or `1`) — Select, drag, marquee, and resize.
  2. `text` (Hotkey: `T` or `2`) — Text / Markdown card.
  3. `rect` (Hotkey: `R` or `3`) — Rectangular shape card.
  4. `ellipse` (Hotkey: `O` / `C` or `4`) — Ellipse / pill shape card.
  5. `diamond` (Hotkey: `D` or `5`) — Decision diamond shape card.
  6. `kb-node` (Hotkey: `N` or `6`) — Live kb outline node card (opens `NodePicker`).
  7. `group` (Hotkey: `G` / `F` or `7`) — Visual container / frame card.
- **MUST** support two placement modes:
  - **One-Shot Mode (Single Click):** Clicking a tool icon activates it for one placement. Clicking the canvas places the node and immediately resets the active tool to `select`.
  - **Sticky Mode (Double Click):** Double-clicking a tool icon locks the tool active for continuous placement until `Escape` or `V` is pressed.
- **MUST** support double-clicking empty canvas in `select` mode to instantly spawn a new `text` card at the cursor.
- **MUST** support pressing `Escape` to cancel placement and return to `select`.

### 3.2 Unified Selection Engine
- **MUST** maintain a unified selection data structure:
  ```ts
  interface CanvasSelection {
    nodeIds: Set<string>;
    edgeIds: Set<string>;
  }
  ```
- **MUST** support single selection:
  - Clicking an unselected card or edge selects only that element and deselects all others.
- **MUST** support additive / toggle selection:
  - `Shift+Click` or `Cmd+Click` on a card or edge toggles its presence in the selection set without deselecting other items.
- **MUST** support rubber-band marquee selection:
  - Dragging the pointer on an empty canvas stage (movement $\ge 4\text{px}$) draws a translucent selection rectangle.
  - All cards whose bounding boxes intersect the marquee rectangle become selected upon pointer release.
  - Holding `Shift` during marquee drag performs additive marquee selection (appends to existing selection).
- **MUST** support `Cmd+A` (`Ctrl+A` on Linux/Windows) to select all nodes and edges on the current canvas.
- **MUST** support clicking on empty stage or pressing `Escape` to clear the selection entirely.

### 3.3 Movement, Resizing, & Drag Quality
- **MUST** enforce a **$4\text{px}$ drag threshold**:
  - Pointer displacement $< 4\text{px}$ is treated as a click/selection.
  - Pointer displacement $\ge 4\text{px}$ engages active movement or resizing.
- **MUST** support multi-node movement:
  - Dragging any single card within an active multi-card selection translates all selected cards by the same displacement vector $(\Delta x, \Delta y)$.
- **MUST** provide **4-corner resize handles** on selected cards (NW, NE, SE, SW):
  - Handles MUST display appropriate directional cursors (`nwse-resize`, `nesw-resize`).
  - Resizing MUST enforce minimum card bounds: $\text{width} \ge 80\text{px}$, $\text{height} \ge 40\text{px}$.
  - For `shape` (rect, ellipse, diamond) and `text` cards, corner dragging adjusts width and height relative to the opposite anchor corner.
  - Holding `Shift` during resize MUST lock aspect ratio.
- **MUST** apply pointer capture (`setPointerCapture`) on pointer down for all card drags and resize handles to prevent lost mouse events during high-velocity dragging.

### 3.4 Alignment Snapping & Guides
- **MUST** implement lightweight alignment snapping during card drag:
  - Cards snap to 10px canvas coordinate intervals when `Shift` is held, or automatically with a $5\text{px}$ magnetic snap tolerance to neighboring card bounding box edges (left, center, right, top, middle, bottom).
  - Subtle temporary guide lines ($1\text{px}$ dashed `--primary/40`) render when cards align along matching axes.

### 3.5 Deletion Model & Data Safety Guarantee
- **MUST** bind the `Delete` and `Backspace` keys (when no input/textarea is focused) to delete all currently selected nodes and edges.
- **MUST** uphold the **Canvas vs Database Safety Boundary**:
  - Deleting a `kb-node` card from the canvas **ONLY** removes the `{ id, type: "kb-node", nodeId, ... }` card entry from the `CanvasDoc` in `sys.f.canvas`.
  - It **MUST NOT** delete, mutate, or mark deleted the underlying node entity in the kb DataScript database.
- **MUST** perform cascade deletion of incident edges:
  - Deleting any node automatically removes all edges where `fromNode === id || toNode === id` from the `CanvasDoc`.
- **MUST** provide a delete button in the `EdgeInspector` and `ShapeInspector` as an accessible mouse alternative to keyboard deletion.
- **MUST** provide a contextual floating toolbar for selections with a Delete (Trash) button.

### 3.6 Copy, Paste, Duplicate & Clipboard
- **MUST** serialize copied canvas items to the system clipboard in **JSON Canvas 1.0** format with MIME type `application/json` and fallback text:
  ```json
  {
    "nodes": [ ... ],
    "edges": [ ... ]
  }
  ```
- **MUST** handle `Cmd+C` / `Ctrl+C`: Copies selected nodes and any edges whose `fromNode` AND `toNode` are both within the selection set.
- **MUST** handle `Cmd+V` / `Ctrl+V`:
  - Parses clipboard JSON. If valid JSON Canvas, assigns fresh ULIDs to all nodes and edges, offsets coordinates by $+24\text{px}, +24\text{px}$ (or centers around current cursor position), inserts them into the active `CanvasDoc`, persists, and immediately selects the newly pasted items.
- **MUST** handle `Cmd+D` / `Ctrl+D` (Duplicate):
  - Clones selected cards and internal edges in-place with a $+24\text{px}, +24\text{px}$ offset and focuses the new selection.

### 3.7 Undo / Redo Stance: Recommendation & Specification
- **Recommendation:** **ADOPT a client-side immutable local history ring buffer.**
- **Simplicity-Rule Justification:**
  - `CanvasDoc` is already a pure, self-contained, immutable data structure (`{ nodes: CanvasNode[], edges: CanvasEdge[], extra?: ... }`).
  - Managing an in-memory stack (`past: CanvasDoc[]`, `future: CanvasDoc[]`) capped at 30 snapshots inside the canvas state engine requires **zero backend schema additions, zero database migrations, and zero cross-worker locks**.
  - It provides instant, flawless `Cmd+Z` and `Cmd+Shift+Z` / `Cmd+Y` recovery for accidental deletions, misplaced multi-card drags, color changes, and edge deletions.
- **Contract & Boundaries:**
  - Canvas undo/redo manages document topology, card dimensions, positions, colors, edge connections, and labels.
  - Text typing within a `KbNodeCard` delegates to the existing core mutation stream and outline store.

### 3.8 Z-Order & Layering Stance
- **Stance:** Node array index in `CanvasDoc.nodes` defines DOM/SVG paint order (last in array = top of visual stack).
- **Simplicity-Rule Cut:** **Refuse numeric z-index properties** on nodes. Array order is standard in JSON Canvas 1.0 and eliminates index reconciliation bugs.
- **Layering Actions:**
  - "Bring to Front": Moves selected node(s) to the end of `CanvasDoc.nodes`.
  - "Send to Back": Moves selected node(s) to the start of `CanvasDoc.nodes`.
- **Structural Invariant:** `group` (container) nodes MUST always be rendered beneath content nodes (`shape`, `text`, `kb-node`, `file`, `link`).

### 3.9 Zoom & Pan Quality
- **MUST** implement **Cursor-Centered Zooming**:
  - When wheel-zooming with `Ctrl` or `Meta` (or trackpad pinch), the new zoom factor MUST zoom toward the pointer coordinate $(P_x, P_y)$:
    $$x_{\text{world}} = \frac{P_x - \text{pan}_x}{\text{zoom}_{\text{old}}}$$
    $$\text{pan}_{x,\text{new}} = P_x - x_{\text{world}} \times \text{zoom}_{\text{new}}$$
    $$y_{\text{world}} = \frac{P_y - \text{pan}_y}{\text{zoom}_{\text{old}}}$$
    $$\text{pan}_{y,\text{new}} = P_y - y_{\text{world}} \times \text{zoom}_{\text{new}}$$
- **MUST** clamp zoom between $0.10$ ($10\%$) and $3.00$ ($300\%$).
- **MUST** support `Cmd+0` (reset to $100\%$) and `Shift+1` (zoom to fit all cards with $40\text{px}$ padding).

---

## 4. Edge UX Specification ("Edges are Drawings")

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          EDGE UX: DUAL-PATH & LIVE GHOST                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Source Card Port ───────► (Live Ghost Curve while Dragging) ────► Pointer │
│                                                                        │    │
│                                                                        ▼    │
│   Target Card ◄──── Smart Snap to Nearest Port ◄───────────────────────┘    │
│                                                                             │
│   Rendered Edge:                                                            │
│   ├── Fat Transparent Hit-Box (20px Stroke, Pointer Events)                 │
│   ├── Visible Stroke (1.5px / 2.5px, Color Preset Aware)                    │
│   └── Centered Text Pill Label (Double-Click to Edit)                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Connection Flow & Ghost Edge Engine
- **Port Visibility & Affordance:**
  - Hovering a card reveals 4 circular connection ports (top, right, bottom, left).
  - Port hit area MUST be at least $18\text{px} \times 18\text{px}$ (with an $8\text{px}$ visible dot) to ensure effortless grabbing.
- **Live Ghost Connection Rendering:**
  - Dragging from a port MUST render a live dashed SVG bezier curve (`stroke-dasharray="4 4"`) connecting the source port to the current pointer position $(x, y)$.
- **Smart Target Port Snapping:**
  - As the pointer approaches a target card, the engine calculates the Euclidean distance to each of the target card's 4 ports.
  - The closest port highlights with a pulse animation, and the ghost bezier curve snaps directly to that port.
  - Releasing the pointer binds the edge to that specific `toSide` (e.g. `top`, `right`, `bottom`, or `left`), eliminating the hardcoded `"left"` bug.

### 4.2 Edge Hit Area & Dual-Path Rendering
- **MUST** render every canvas edge using a **dual-path SVG technique**:
  1. **Interaction Path (Transparent Hit Box):**
     ```tsx
     <path
       d={d}
       fill="none"
       stroke="transparent"
       strokeWidth={20}
       className="cursor-pointer"
       onClick={onSelectEdge}
     />
     ```
  2. **Visible Stroke Path:**
     ```tsx
     <path
       d={d}
       fill="none"
       stroke={resolvedColor}
       strokeWidth={selected ? 2.5 : 1.5}
       markerEnd={edge.toEnd === "none" ? undefined : `url(#kb-arrow-${colorId})`}
       markerStart={edge.fromEnd === "arrow" ? `url(#kb-arrow-rev-${colorId})` : undefined}
       className="pointer-events-none transition-colors"
     />
     ```

### 4.3 Endpoint Re-routing (Direct Manipulation)
- When an edge is selected, circular drag handles appear at its source $(A_x, A_y)$ and target $(B_x, B_y)$ endpoints.
- Dragging an endpoint handle detaches that side of the edge and engages the live ghost connection engine.
- Dropping on another card's port updates `fromNode`/`fromSide` or `toNode`/`toSide` in the `CanvasEdge`.

### 4.4 Edge Labels, Arrowheads, and Colors
- **Edge Label Rendering:**
  - If `edge.label` is populated, the canvas MUST render an SVG `<g>` placed at the bezier curve midpoint ($t = 0.5$):
    - Background pill: `<rect rx="4" className="fill-popover stroke border-foreground/10" />`
    - Text element: `<text className="text-[11px] fill-foreground/80 font-medium" />`
  - Double-clicking the edge or label opens an inline text input to edit the label.
- **Arrowhead Controls:**
  - `EdgeInspector` MUST provide toggle buttons for `fromEnd` (`none` | `arrow`) and `toEnd` (`none` | `arrow`).
- **Color Presets:**
  - `EdgeInspector` MUST provide color swatches (JSON Canvas 1–6 + None).
  - SVG markers (`<marker>`) must dynamically support colored arrowheads matching `edge.color`.

---

## 5. Node-Card UX & Multi-Type Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             NODE-CARD CATALOG                               │
├──────────────────────┬──────────────────────────┬───────────────────────────┤
│ kb-node (Live Store) │ shape (Draw.io/Miro)     │ text (Markdown Note)      │
│ • Live store text    │ • Rect / Ellipse/ Diamond│ • Rich Markdown render    │
│ • Tag chips & bullet │ • Multiline auto-wrap    │ • Double-click to edit    │
│ • Click bullet=peek  │ • 1–6 border & tint fill │ • 1–6 color card presets  │
│ • 1–6 color presets  │ • Centered typography    │ • Auto-expanding height   │
├──────────────────────┴──────────────────────────┴───────────────────────────┤
│ file / media (W6 Asset Cards)        group (Visual Framing / Container)     │
│ • Image render from .kb/assets/      • Labeled container frame              │
│ • Drag/drop image upload             • Dragging frame translates children   │
│ • Aspect ratio preservation          • Sits in visual basement              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.1 `kb-node` Cards (Live Store Entities)
- **Visual Structure:**
  - Header with clickable Bullet (`●`, `◇`, `▣`), live title, and Tag chips.
  - Clicking the bullet opens the node in side-peek or navigates to `/node/:id`.
- **Color Theming:**
  - Support JSON Canvas `color` property on `kb-node` cards, tinting card borders and subtle background fills using `--canvas-color-N`.
- **Text Overflow & Expansion:**
  - If node content exceeds card height, render clean gradient fading with a expand/scroll toggle.

### 5.2 `shape` Cards (Freeform Thinking Shapes)
- **Supported Geometries:** `rect` (rounded rectangle), `ellipse` (pill/circle), `diamond` (decision rhombus).
- **Multiline Text Editing:**
  - Double-clicking a shape card opens an auto-wrapping, transparent `<textarea>` centered vertically and horizontally.
  - `Enter` inserts a newline; `Cmd+Enter` or clicking outside commits edits.
- **Visual Styling:**
  - Fill uses `color-mix(in oklab, var(--canvas-color-N) 14%, transparent)`.
  - Border uses `var(--canvas-color-N)`.
  - Default fill is subtle translucent background; text is readable in dark and light themes.

### 5.3 `text` Cards (Markdown Sticky Notes)
- **Two-State Rendering:**
  - **Read Mode (Default):** Renders formatted markdown (headers, bold, lists, inline code) via existing `kb` markdown renderers.
  - **Edit Mode (Double-Click):** Transitions smoothly into a focused `<textarea>`.
- **Color Support:**
  - Color swatches (1–6) tint the sticky note card.

### 5.4 `file` & `link` Media Cards (W6 Conformance)
- **`file` Cards (Images & Attachments):**
  - Conforms to JSON Canvas `file` node spec: `{ id, type: "file", file: "assets/ulid.png", x, y, width, height }`.
  - Renders image directly using `/assets/<filename>` static endpoint.
  - Dropping an image file (`.png`, `.jpg`, `.webp`, `.svg`) directly onto the canvas stage triggers `asset.upload` action and places a `file` card at the drop coordinates.
- **`link` Cards (Web URLs):**
  - Conforms to JSON Canvas `link` node spec: `{ id, type: "link", url: "https://...", x, y, width, height }`.
  - Renders a clean bookmark preview card with favicon, URL hostname, and external launch button.

### 5.5 `group` Cards (Visual Framing Containers)
- **Conforms to JSON Canvas `group` node spec:** `{ id, type: "group", label: "Architecture", x, y, width, height, color?: "..." }`.
- **Header Tab:** Renders an editable label tab along the top border.
- **Hierarchical Drag Translation:**
  - When dragging a `group` card, all nodes whose bounding boxes are geometrically enclosed within the group ($x \ge G_x \land y \ge G_y \land x + w \le G_x + G_w \land y + h \le G_y + G_h$) are translated together by the same $(\Delta x, \Delta y)$.

---

## 6. Data Format Specification (JSON Canvas 1.0 Conformance)

The canvas serialization layer in `tools/kb/src/canvas/doc.ts` strictly enforces [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/) interchange rules.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          JSON CANVAS 1.0 COMPATIBILITY                      │
├─────────────────────────────────────────────────────────────────────────────┤
│   Standard Nodes: text | file | link | group                                │
│   kb-Specific Nodes: kb-node | shape                                        │
│   Standard Edges: id, fromNode, fromSide, toNode, toSide, fromEnd, toEnd... │
│   kb Edge Extension: kbLink (one-shot native prop metadata)                 │
│   Forward/Backward Guarantee: Extra/unknown keys round-trip in extra{}      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.1 TypeScript Schema Definitions (`doc.ts`)
```ts
export type CanvasSide = "top" | "right" | "bottom" | "left";
export type CanvasEdgeEnd = "none" | "arrow";
export type CanvasShapeKind = "rect" | "ellipse" | "diamond";

export interface CanvasNodeBase {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  extra?: Record<string, unknown>;
}

export interface CanvasTextNode extends CanvasNodeBase {
  type: "text";
  text: string;
}

export interface CanvasFileNode extends CanvasNodeBase {
  type: "file";
  file: string;
  subpath?: string;
}

export interface CanvasLinkNode extends CanvasNodeBase {
  type: "link";
  url: string;
}

export interface CanvasGroupNode extends CanvasNodeBase {
  type: "group";
  label?: string;
  background?: string;
  backgroundStyle?: "cover" | "ratio" | "repeat";
}

export interface CanvasKbNode extends CanvasNodeBase {
  type: "kb-node";
  nodeId: string;
}

export interface CanvasShapeNode extends CanvasNodeBase {
  type: "shape";
  shape: CanvasShapeKind;
  label?: string;
}

export type CanvasNode =
  | CanvasTextNode
  | CanvasFileNode
  | CanvasLinkNode
  | CanvasGroupNode
  | CanvasKbNode
  | CanvasShapeNode
  | CanvasNodeBase;

export interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide?: CanvasSide;
  fromEnd?: CanvasEdgeEnd;
  toNode: string;
  toSide?: CanvasSide;
  toEnd?: CanvasEdgeEnd;
  color?: string;
  label?: string;
  kbLink?: {
    mode: "native" | "layout";
    via: "prop";
    fieldId: string;
    sourceNodeId: string;
    targetNodeId: string;
    bindingId: string;
  };
  extra?: Record<string, unknown>;
}

export interface CanvasDoc {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  extra?: Record<string, unknown>;
}
```

### 6.2 Lossless Preservation Rule
- Any unrecognized property on a node, edge, or root document is captured into an `extra` dictionary during `parseCanvasDoc` and re-serialized at top level during `stringifyCanvasDoc`.
- Files exported from Obsidian Canvas or third-party tools open cleanly in `kb` without stripping unknown metadata.

---

## 7. Deliberate Non-Goals (Simplicity-Rule Cuts)

In accordance with `tools/kb/INSPIRATIONS.md` ("Simplicity beats fidelity"), the following features are **explicitly rejected** to prevent code bloat and maintainability hazards:

| Feature | Decision | Justification |
|---|---|---|
| **Freehand Pencil / Pen Drawing** | **CUT** | Vector brush strokes demand canvas rasterization / smoothing algorithms, pollute JSON Canvas data structures, and belong in specialized asset dumps (Excalidraw PNG export) rather than structured knowledge canvases. |
| **Node Rotation (Arbitrary Angles)** | **CUT** | Adds matrix transforms, breaks orthogonal port alignment, complicates text editing boxes, and violates clean outliner typography. |
| **Complex Bezier Control Point Handles** | **CUT** | Manual curve control point tweaking adds high UI overhead. 4-side orthogonal/bezier routing provides predictable, clean visual results. |
| **Two-Way Edge↔Prop Synchronization Engine** | **CUT** | Edges are drawings (Logseq stance). Building a background reconciler that continuously writes ref props on every edge drag introduces race conditions and sync debt. One-shot native bind via `ext.canvas.tx.apply` remains the clean semantic path. |
| **Numeric Z-Index Layer Management** | **CUT** | Explicit integer z-indices cause layer fragmentation and collision bugs. Array order in `CanvasDoc.nodes` + "Bring to Front" / "Send to Back" fully satisfies layering needs. |

---

## 8. Implementation Wave Task Breakdown (Ordered by Impact)

This task sequence is structured for execution by **`i3-canvas`** in wave **`I1`**. Each slice is self-contained, test-driven, and designed to land without regressions.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    IMPLEMENTATION WAVE I1 (i3-canvas) PIPELINE              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Slice 1 (P0): Core Deletion, Unified Multi-Select & Keyboard Engine       │
│        │                                                                    │
│        ▼                                                                    │
│   Slice 2 (P0): Pointer Quality, Drag Deadbands & Ghost Edge Engine         │
│        │                                                                    │
│        ▼                                                                    │
│   Slice 3 (P1): Card UX Overhaul — Multiline Shapes, Media & Groups         │
│        │                                                                    │
│        ▼                                                                    │
│   Slice 4 (P1): Edge Polish — Hit Areas, Endpoint Re-routing & Labels       │
│        │                                                                    │
│        ▼                                                                    │
│   Slice 5 (P2): Canvas List & Header Polish, Zoom-to-Fit & Actions          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Slice 1: Core Deletion, Unified Multi-Selection & Keyboard Engine (P0)
- **Goal:** Fix the headline bug (cannot delete nodes), provide rubber-band marquee multi-selection, and implement keyboard shortcuts.
- **Files to Edit / Create:**
  - `tools/kb/ui/src/lib/canvas-selection.ts` (New pure selection helper module + tests).
  - `tools/kb/ui/src/lib/canvas-history.ts` (New local immutable undo/redo ring buffer + tests).
  - `tools/kb/ui/src/components/canvas/canvas-page.tsx`
  - `tools/kb/ui/src/components/canvas/canvas-card.tsx`
  - `tools/kb/ui/src/components/canvas/shape-card.tsx`
- **Concrete Deliverables:**
  1. `Delete` / `Backspace` key handler deletes all selected cards and edges (calling `removeCanvasNode` / `removeCanvasEdge`).
  2. Multi-selection state `selection: { nodeIds: Set<string>, edgeIds: Set<string> }`.
  3. Rubber-band marquee selection overlay during stage drag.
  4. `Shift+Click` additive selection toggle.
  5. `Cmd+A` (Select All) shortcut.
  6. `Cmd+Z` / `Cmd+Shift+Z` undo/redo stack for canvas transformations.
  7. Tool switching shortcuts (`V`, `T`, `R`, `O`, `D`, `N`, `G`).

### Slice 2: Pointer Quality, Drag Deadbands & Ghost Edge Engine (P0)
- **Goal:** Eliminate hair-trigger dragging, fix fast-drag slip, render live connection ghost line, and implement smart port snapping.
- **Files to Edit / Create:**
  - `tools/kb/ui/src/components/canvas/canvas-page.tsx`
  - `tools/kb/ui/src/components/canvas/canvas-card.tsx`
  - `tools/kb/ui/src/components/canvas/shape-card.tsx`
  - `tools/kb/ui/src/lib/canvas-geometry.ts` (Port hit testing & Euclidean distance snapping).
- **Concrete Deliverables:**
  1. $4\text{px}$ displacement threshold before engaging card move or stage marquee.
  2. Pointer capture (`setPointerCapture`) across all card drag handles.
  3. Multi-node translation (dragging one selected card moves all selected cards).
  4. 4-corner resize handles (NW, NE, SE, SW) with minimum dimension clamping ($80\text{px} \times 40\text{px}$).
  5. Live SVG ghost curve rendered while dragging from a connection port.
  6. Automatic snapping to closest port on target card, setting `toSide` accurately upon release.
  7. Cursor-centered wheel and pinch zooming.

### Slice 3: Card UX Overhaul — Multiline Shapes, Media/File Cards & Groups (P1)
- **Goal:** Professionalize card rendering, allow multiline shape text, support asset image cards, and make group containers functional.
- **Files to Edit / Create:**
  - `tools/kb/src/canvas/doc.ts` (Add `CanvasFileNode` and `CanvasLinkNode` support).
  - `tools/kb/ui/src/components/canvas/shape-card.tsx`
  - `tools/kb/ui/src/components/canvas/canvas-card.tsx`
  - `tools/kb/ui/src/components/canvas/group-card.tsx` (New group container component).
  - `tools/kb/ui/src/components/canvas/media-card.tsx` (New file/link media card component).
- **Concrete Deliverables:**
  1. `ShapeCard` multiline inline text editing via transparent auto-wrapping textarea.
  2. `GroupCard` component supporting resize, move, title editing, and translating enclosed child nodes.
  3. `MediaCard` component rendering image assets (`.png`, `.jpg`, `.webp`, `.svg`) from `.kb/assets/`.
  4. Drag-and-drop file upload directly onto canvas stage triggering `asset.upload`.
  5. Clickable Bullet on `KbNodeCard` to navigate or peek into full node view.
  6. Color presets (1–6) enabled across all card types (`shape`, `text`, `kb-node`, `group`).

### Slice 4: Edge Refinements — Hit Areas, Endpoint Re-routing, Labels & Color (P1)
- **Goal:** Make edges effortless to click, allow endpoint re-routing, and support visible labels and color swatches.
- **Files to Edit / Create:**
  - `tools/kb/ui/src/components/canvas/edge-path.ts`
  - `tools/kb/ui/src/components/canvas/edge-inspector.tsx`
  - `tools/kb/ui/src/components/canvas/canvas-page.tsx`
- **Concrete Deliverables:**
  1. Dual-path SVG rendering ($20\text{px}$ transparent hit box + $1.5\text{px}$ visible path).
  2. Endpoint re-routing drag handles on selected edges.
  3. Midpoint SVG text label rendering with background pill.
  4. Inline double-click edge label editing + `EdgeInspector` label input field.
  5. Arrowhead controls (`toEnd` / `fromEnd`) and color picker in `EdgeInspector`.
  6. Colored SVG markers matching edge tint.

### Slice 5: Canvas List, Header Renaming & Polish Sweep (P2)
- **Goal:** Sweep canvas list page, enable in-canvas title editing, and provide zoom controls.
- **Files to Edit / Create:**
  - `tools/kb/ui/src/components/canvas/canvas-list-page.tsx`
  - `tools/kb/ui/src/components/canvas/canvas-page.tsx`
  - `tools/kb/ui/src/components/sidebar/sidebar.tsx`
- **Concrete Deliverables:**
  1. In-canvas title editing via `NodeContent` in `CanvasPage` header bar.
  2. Canvas search/filter on `CanvasListPage`.
  3. Canvas deletion and duplication actions in list and sidebar context menus.
  4. Zoom control bar (Zoom In, Zoom Out, Zoom to 100%, Zoom to Fit).
  5. Polish empty state on `CanvasListPage` with quick-start action.

---

## 9. Verification & Acceptance Criteria

When `i3-canvas` completes wave `I1`, the canvas subsystem will satisfy the following verifiable test matrix:

| Scenario | Expected Behavior |
|---|---|
| **Node Deletion** | Select card → press `Delete` → card removed from canvas JSON; incident edges pruned; underlying DataScript node intact. |
| **Multi-Selection** | Drag on canvas background → marquee selects intersecting nodes → dragging one moves all. |
| **Edge Creation** | Drag from port → live ghost curve tracks pointer → snaps to nearest target port on hover → releases with exact `fromSide`/`toSide`. |
| **Edge Selection** | Click anywhere within $10\text{px}$ of edge curve → edge selects reliably → inspector opens. |
| **Shape Multiline Edit** | Double-click shape → type multiple lines with `Enter` → text wraps and centers cleanly. |
| **Canvas Title Rename** | Click title in canvas header → edit text → changes persist and update canvas list and sidebar reactively. |
| **Undo / Redo** | Delete a cluster of nodes → press `Cmd+Z` → entire cluster and connections instantly restored. |
| **JSON Canvas Round-Trip** | Import/export JSON Canvas with third-party fields → all unknown types and extra properties preserved verbatim. |
