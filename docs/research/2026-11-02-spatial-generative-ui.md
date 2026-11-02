# A spatial, generative output surface for bb's voice concierge

Date: 2026-11-02. Design only: nothing here is built. **Superseded in part by
[v2](2026-11-02-spatial-generative-ui-v2.md)** (2026-11-03): free placement with presets, the engine in kb, a
data-source contract, data flow, a flat mode, and a latency budget. v2 §0 lists what changed. It pairs with the voice
concierge plugin ([PR #128](https://github.com/popemkt/mac-backup/pull/128),
`assets/bb-plugins/voice-concierge`, research in
`docs/research/2026-11-01-bb-voice-concierge.md`).

**The owner's ask (condensed).** Voice is a strong input, and the output should
be as strong: a live spatial canvas, with the voice still talking back. While
talking to the concierge, it lays out a list of bb threads on the right. The
person asks it to detail one, and that opens on the left. It draws connections
between items. All of it happens in real time, from bb's live data. Pre-made
elements come first, with UI generated on the fly when nothing pre-made fits.
Use standard protocols where they exist. Build it for bb first and port it to
kb later. The owner asked: "html in canvas, but also maybe a mode without html
in canvas: what should be best?"

Claim tags, as in the concierge doc:

- **[doc]**: vendor documentation, a spec, or shipped source read today.
- **[measured]**: read from this machine today (bb 0.48.x SDK declarations, the
  kb checkout at v0.3.0).
- **[secondary]**: a third-party write-up.
- **[unverified]**: a hypothesis to test.

This doc builds on kb's own research of 2026-09-29
(`popemkt/kb: docs/brainstorms/2026-09-29-kb-genui-canvas-agents/`), which
already decided generative UI and the 2D/3D canvas for kb. Where that research
already answers a question, this doc adopts its answer instead of choosing a
second one (Rule 1).

## 1. Recommendation

1. **Render DOM-first, with a GPU layer behind it ("2.5D").** Every card is real
   DOM, so bb's own `ThreadChat`, `experimental_Diff` and `Markdown` can be
   embedded as they are. Each card has its own CSS 3D transform under one shared
   perspective: tilted toward the viewer, at a depth that depends on its region.
   That gives the visionOS "windows in a room" look with full accessibility, IME,
   selection and find. One WebGL canvas behind the cards draws the room and the
   orb; the concierge's `sphere.ts` already does the orb. One SVG overlay above
   them draws the connections from the cards' projected rectangles.
2. **A mode without HTML is a level of detail, not a second UI.** Far-zoom,
   periphery and big graphs (hundreds of threads) draw as GPU impostors: title,
   status dot and glow, drawn by the same scene model. True 3D with real DOM
   textures (WICG HTML-in-Canvas, drawn through three.js) waits until it ships
   outside Chromium. It plugs in as a second projection of the same scene,
   behind feature detection, which is exactly the plan kb already has for its
   canvas (kb steps 8–9).
3. **The protocol is ours, small, and borrows standard shapes at each seam.**
   - **The agent writes scene operations through native bb agent tools.** The
     verbs are the same ones kb's canvas already has: `place`, `edit`,
     `connect`, `remove`, `describe`, `camera`, `undo`. Every item names a view
     from a catalog and a live data source.
   - **Component props use A2UI's shape.** Components form a flat list linked
     by id, and a bound prop is `{"path": "<JSON Pointer>"}` into the resolved
     source. An A2UI adapter at the edge is then cheap.
   - **Scene deltas are RFC 6902 JSON Patch**, which is AG-UI's `STATE_DELTA`.
   - **The escape hatch for generated HTML is an MCP Apps view** (SEP-1865,
     stable 2026-01-26): a sandboxed iframe that talks to the host in
     JSON-RPC over postMessage. kb already chose that bridge for its code
     views.
   - **Don't adopt A2UI, json-render or AG-UI as the model.** All three are
     young and change between versions, and adopting one would give bb a second
     catalog beside its own components.
4. **The agent binds data; it never pushes it.** An item says *which* data it
   shows, for example `{kind: "bb.threads", where: {projectId, open: true}}` or
   `{kind: "bb.pr", threadId}`. The plugin server resolves that, subscribes with
   `bb.sdk.subscribe` (`thread:changed`, `environment:changed`, and so on), and
   signals the page to refetch. A status flips, a PR goes green, a thread
   finishes: the canvas updates with **no model turn and no tokens**, even while
   the concierge is idle.
5. **The agent places things by region and relation, never by coordinates.**
   - There are five regions: `focus` (centre), `left` (detail), `right`
     (collection), `periphery` (ambient, far and dim) and `dock` (the orb and
     captions).
   - A relation is near, on or in another item, which is kb's `ext.canvas.place`
     vocabulary.
   - A deterministic layout solver turns intents into positions. A card placed
     by a person's hand stays where they put it.
6. **Deixis comes from spoken handles plus a recency stack.**
   - Every item gets a handle the person can say: numbers in lists, letters on
     panels.
   - "This" or "that" resolves in order to:
     1. what the person touched or pointed at in the last few seconds;
     2. otherwise, what the concierge last talked about;
     3. otherwise, what is in focus.
   - When two candidates tie, the concierge shows their numbers and asks.
7. **Persistence and undo.**
   - Each concierge call gets a scene, autosaved in the plugin's storage.
   - "Save this" writes it as a **kb canvas**: items become kb `link` items
     with `bb://` URLs, and their view and source go in the extra fields that
     kb's JSON Canvas round-trips.
   - Every tool call is one undo step, whether it came from the agent, a
     gesture or "undo that".
8. **Where it lives in bb.**
   - The MVP is a **"Spatial" layout of the voice concierge page**. The orb
     becomes the dock region.
   - The scene model, the solver, the catalog and the renderer go in a shared
     folder, `assets/bb-plugins/spatial-kit/`. The kb and canvas-links plugins
     already share `linked-items/` this way.
   - The tools are registered for the concierge's thread only, at first.
   - Later, a standalone `spatial` plugin lets any thread drive a scene in its
     side panel, and kb's canvas renders the same scene model.

Effort for the MVP in §7 is about 4–5 days for one agent. The shape of the result
is in the mockup in §1.1.

### 1.1 The mockup

A throwaway HTML mockup (static data, real thread titles from this project) was
rendered headless at 1600×1000 and 390×844. The design thread keeps the files;
they are not committed. The layout:

```
 bb · Spatial                                   ◇ saved as kb canvas   ↶ undo   ● live
 ┌ DETAIL (left) ───────────┐  ┌ FOCUS: timeline ──────┐  ┌ LIST (right) ─────────────┐
 │ Investigate: bb realtime │  │ ●──●──●──◉──○          │  │ 1 Plan: move bb server   ●│
 │ voice concierge          │  └───────────────╲───────┘  │ 2 Investigate: voice … ◐ ◄┼── "detail"
 │ PR #128 ✓  → spawned 1 ──┼╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╲╌╌╌╌╌╌╌►│ 3 Design: spatial UI   ● │
 │ latest reply · diff ·    │                        ╲    │ 4 … 7 (idle, dimmer)      │
 │ changed files            │          ( orb )            └───────────────────────────┘
 └──────────────────────────┘   You: open number two on the left…
   [Automations · periphery]    "The voice concierge thread. PR 128 is green…"   [Lanes · periphery]
                                         Mute   Hang up
```

Panels are frosted glass, tilted about 15° toward the centre, at three depths.
The connections are glowing curves that carry a label. List rows carry a
spoken index. On a phone the depth flattens:

- the list becomes a numbered strip that scrolls sideways, with the selected
  item centred;
- the detail fills the screen below it;
- the orb docks into a bottom bar with the caption, Mute and Hang up, the same
  call bar the concierge has today.

## 2. Rendering model

### 2.1 The options

| | A. DOM in a zoomable plane (tldraw, kb's 2D canvas) | B. GPU only (WebGL/WebGPU, SDF/MSDF text, pmndrs uikit) | C. Hybrid: DOM cards plus a GPU room and LOD impostors (**recommended**) | D. Real DOM in a GPU scene (WICG HTML-in-Canvas) |
|---|---|---|---|---|
| Text quality | Native: subpixel, every script, emoji | Good at a distance, soft at small sizes; complex scripts and emoji are hard | Native up close, impostors far away | Native, rasterized into a texture (no subpixel AA by spec) |
| Accessibility, IME, find, translate | Yes | No: a parallel accessibility tree has to be built | Yes for every real card | Yes: drawable children stay in the accessibility tree [doc] |
| Embedding bb components (`ThreadChat`, diff, markdown) | Yes, as they are | No: every one must be rebuilt | Yes | Yes, as textures, interactive through `updateElementGeometry` |
| "Spatial" feel | CSS 3D: per-card tilt, depth, parallax, perspective; no true occlusion or lighting on cards | Full: lighting, curved panels, depth of field, true 3D | Most of it: glass, depth, parallax, a lit room and orb behind the cards | Full |
| Phone performance | Good up to a few dozen cards; `backdrop-filter` is the cost | Good: one draw loop and instancing | Good with blur off and depth flattened on phones | Unknown; Chromium only |
| Animation | CSS and WAAPI transforms on the compositor | Anything | Both | Both |
| Hit-testing | Free | Hand-written ray casting | Free for cards, ray casting only for impostors | Set per element with `updateElementGeometry` [doc] |
| Availability | Everywhere | Everywhere WebGL2 runs | Everywhere | Chromium only (see 2.2) |

### 2.2 HTML-in-Canvas, as of today

- **API** [doc] ([explainer](https://github.com/WICG/html-in-canvas),
  [Chrome changes](https://developer.chrome.com/blog/html-in-canvas-ot-changes)):
  - Opt-in and drawing: `<canvas content="drawable">`, with a `drawable`
    attribute on each child to be drawn. This replaced `layoutsubtree` in
    Chrome 155. A 2D context draws a child with
    `ctx.drawElementImage(el, x, y)`.
  - WebGL and WebGPU: `gl.texElementSubImage2D(...)` (formerly
    `texElementImage2D`) and `GPUQueue.drawElementImageToTexture(...)`.
  - Hit-testing in a GPU scene: `canvas.updateElementGeometry(el,
    {canvasTransform})` maps hit-testing and focus to where the element is
    drawn.
  - A `paint` event reports changed elements.
  - Privacy: snapshots never show cross-origin content, visited-link state or
    spelling marks.
  - three.js wraps it as `HTMLTexture` (r184+), which kb's research already
    noted.
- **Status:**
  - **Chromium only.** Chrome ran an origin trial from 148. Chrome's post of
    2026-10-26 says 157 makes it stable, which conflicts with an earlier post
    that extended the trial through 160. Check chromestatus before relying on
    it [doc, conflicting].
  - Edge's trial expired on 2026-10-20 [doc].
  - Mozilla ([#1076](https://github.com/mozilla/standards-positions/issues/1076))
    and WebKit ([#630](https://github.com/WebKit/standards-positions/issues/630))
    have open position requests with no position [doc].
- **For bb:**
  - The browser tab and possibly the desktop app (if it is Chromium-based
    [unverified]) could use it in 2027.
  - The iOS app and Safari cannot. The owner tests the concierge on a phone, so
    D cannot be the base.
  - D also needs a full GPU scene, where C needs only a decorative one.

### 2.3 The verdict

**C now, D as an optional projection later, and B only as the far-zoom
impostor.** The reasons, in order:

1. **Embedding is the point.** The owner's example ends in "detail one out".
   The best detail of a bb thread is bb's own `ThreadChat` (the concierge page
   already uses its `timeline` variant), its diff viewer, and its PR badge. B
   would rebuild all of them; A, C and D reuse them.
2. **Text is most of what is shown:** titles, replies, diffs. On a phone, DOM
   text stays sharp at every zoom. SDF text does not, and it loses selection,
   find and the screen reader.
3. **The "spatial" feel comes mostly from three cheap cues:** depth (scale and
   blur by z), parallax (cards at different depths shift differently when the
   camera or the device moves), and material (glass, light, soft shadow). CSS
   3D plus a lit WebGL background gives all three. True occlusion and lighting
   on the cards themselves is what D adds, and it can wait.
4. **One scene, many projections** is already kb's rule for its canvas
   (`CANVAS_PROJECTIONS`: a DOM 2D projection and a three.js WebGPU 3D
   projection, under one contract suite). The spatial surface follows the same
   rule. The scene model knows nothing about the renderer. Projection C ships
   first; D and an XR projection (WebXR on visionOS) can come later and must
   pass the same suite: hit-testing, selection, focus, and "an item moved in one
   projection appears moved in the other".

### 2.4 How C is drawn

- **Stage:** a container with `perspective: 1700px`. Each card is a direct
  child with its own transform, built from its scene box and the region's tilt
  (`rotateY(±15°) translateZ(depth)`).
  - Do not nest `preserve-3d` under `backdrop-filter`: Chrome flattens it.
  - The camera is one transform on the stage. Zoom and pan are compositor-only.
- **Glass:** `backdrop-filter: blur(28px) saturate(150%)` on at most about six
  near panels. It is off on phones, under `prefers-reduced-transparency`, and on
  periphery cards, which use a flat translucent fill.
- **Edges:** an SVG overlay. Each end is anchored to an element (a row, a chip,
  a panel edge) through `getBoundingClientRect`, which already returns the
  *projected* box of a 3D-transformed element. The overlay redraws on
  `requestAnimationFrame` only while something moves (transition events,
  `ResizeObserver`), never in a steady loop.
- **Room and orb:** a WebGL2 canvas behind everything: a soft lit floor, the
  sphere (`sphere.ts`, which already pauses off screen and honours reduced
  motion), and the light that glints off the panels as the orb speaks.
- **Level of detail:** below a zoom threshold, or for the periphery, a card is
  replaced by its impostor: a small DOM chip, or GPU quads once the count is
  past about 200. Heavy components (`ThreadChat`, diff) mount only in `focus`
  and `left`, and at most two at a time.
- **Motion:**
  - An item the agent creates grows out of the orb (from the dock, 250 ms
    spring), and an edge draws itself in (stroke-dashoffset). A status change
    pulses once. Moves use FLIP.
  - A subtle parallax (≤ 2°) follows the pointer, or the device's tilt on a
    phone.
  - Reduced motion turns all of this off and flattens the tilt.
- **Accessibility:**
  - Each region is an ARIA `region` with a label, and the reading order is
    dock, focus, left, right, periphery.
  - A polite live region announces what arrives ("Added: 7 threads, on the
    right").
  - The keys 1–9 select list rows, and Tab walks the cards. Everything the
    voice can do, the keyboard can do.

## 3. The generative UI protocol

### 3.1 The survey (as of 2026-11-02)

| Protocol | What it is | Status | Fit for "an agent emits layout plus a catalog plus live bindings, with a sandboxed HTML escape hatch" |
|---|---|---|---|
| **MCP Apps** (SEP-1865) | `ui://` resources (`text/html;profile=mcp-app`) rendered in a required sandboxed iframe. The iframe talks to the host in JSON-RPC over postMessage: `ui/initialize`, `tools/call`, `ui/notifications/tool-result`, `host-context-changed` (theme). App-only tools are marked `visibility: ["app"]`. CSP is deny by default. | **Final**, stable 2026-01-26. `@modelcontextprotocol/ext-apps` 2.0.4 (2026-10-27). Hosts: Claude, ChatGPT, VS Code, Goose and others. Claude Code renders no `ui://` [doc] | **The escape hatch.** It is the right standard for sandboxed HTML and how it talks back to its host. It is not a layout or catalog format, and templates are meant to be pre-declared |
| **MCP-UI** | Its pioneer (`rawHtml`, `remote-dom`). It now implements MCP Apps; `@mcp-ui/client` 7.1.1 | Folded into MCP Apps [doc] | Use its `AppRenderer`/`app-bridge` as the iframe host |
| **OpenAI Apps SDK** | MCP Apps plus `window.openai` extras (`widgetState`, file upload, modals) | ChatGPT recommends the standard keys [doc] | Nothing to adopt beyond MCP Apps. `widgetState` is prior art for persisting a view's state |
| **Google A2UI** | JSONL messages `createSurface`/`updateComponents`/`updateDataModel`. Components are a flat list linked by id (one has id `root`). Binding is `{"path": "<JSON Pointer>"}`. The client advertises the catalogs it supports. Actions go back as `action{name, sourceComponentId, context}` | v0.9.1 stable, v1.0 RC, "early-stage public preview". Two breaking redesigns in about 9 months. Renderers: Lit, Angular, React, Flutter [doc] | **Closest to what we need for components and bindings.** No notion of space, regions or edges. Borrow the shapes and keep an adapter at the edge; don't depend on it |
| **AG-UI** (CopilotKit) | An event stream between agent and frontend: run, text and tool-call events, `StateSnapshot`/`StateDelta` (RFC 6902 JSON Patch), activity events. It carries A2UI and MCP Apps | `@ag-ui/core` 1.0.3 (2026-10-16) [doc] | A transport, not a UI format. bb already has its own transport (agent tools plus plugin RPC and realtime). Borrow JSON Patch for deltas so an AG-UI bridge is trivial |
| **Vercel json-render** | `defineCatalog` with zod props. The spec is `{root, elements:{id:{type, props, children}}}`. Bindings `{"$state": "/path"}`, plus `$cond`, `$computed`, `$template`. Streams JSON Patch. Renders to React, R3F and others | 0.21.4 (2026-11-01), Vercel Labs, breaking in minor versions [doc] | The same idea as A2UI with zod catalogs, which match the bb SDK's style. Too young to depend on. The `$cond`/`$template` directive set is a good model for later computed props |
| **Vercel AI SDK** | Typed tool parts in `useChat` rendered by your components. RSC `streamUI` is paused | AI SDK 7 [doc] | A pattern bb already has: tool rows. Not a protocol |
| **Adaptive Cards** | A JSON card schema with a host-config split | 1.6, Microsoft hosts [doc] | Prior art only |
| **tldraw agent kit** | The model sees a screenshot plus simplified shape JSON (off-screen shapes clustered with a count) and emits typed actions | tldraw SDK 5.6.0. License required in production [doc] | Prior art for `describe` (cluster what is off screen) and for applying actions as they finish streaming. kb rejected tldraw as a dependency for its license |

### 3.2 The pick: one small scene protocol, standard shapes at each seam

The scene is server-owned data. The agent changes it only through operations;
the page renders it; sources fill it.

```ts
// One scene per concierge call (later: per thread). Revisioned; every change is an op.
type Scene = { id: string; rev: number; items: Item[]; edges: Edge[] };

type Item = {
  id: string;              // short, minted by the server ("t2"), stable for the scene
  handle: string;          // what a person says: "2" in a list, "B" for a panel
  region: Region;          // the layout intent
  place?: Relation;        // finer intent inside or across regions
  view: ViewKey;           // a catalog entry, e.g. "thread.list", "thread.detail", "html"
  source?: Source;         // live data binding (§3.3)
  props?: Record<string, Json | { path: string }>; // A2UI-style: literal or JSON Pointer into the source
  pinnedBy?: "human";      // a hand placement, which the solver must not move
  box?: Box;               // solved geometry (x, y, z, w, h, depth, rotation), kb canvas shape
};
type Region = "focus" | "left" | "right" | "periphery" | "dock";
type Relation =                      // kb ext.canvas.place, the same words
  | { near: string; side: "left" | "right" | "above" | "below"; gap?: number }
  | { on: string } | { in: string } | { at: { x: number; y: number; z?: number } };
type Edge = { id: string; from: Anchor; to: Anchor; label?: string; kind?: "detail" | "relation" | "flow" };
type Anchor = string | { item: string; part: string }; // e.g. a row inside a list: { item: "L", part: "/rows/1" }
```

- **Agent-facing tools** are native bb agent tools (`bb.agents.registerTool`,
  zod-validated, with presentation labels). They keep the verbs of kb's canvas
  extension, so a person or agent who knows one knows both:
  `spatial_place` (add or move items by region or relation, in one batch),
  `spatial_edit` (props, view or source), `spatial_connect`, `spatial_remove`,
  `spatial_describe` (what is visible, with handles, the selection, what the
  person pointed at, and what is recent), `spatial_camera` (focus or fit a
  region), and `spatial_undo`. That is seven tools. The catalog is listed in
  the tool instructions (≤ 4 KiB [doc]), and the full schemas come from
  `spatial_describe({catalog: true})`.
- **On the wire to the page**, the server publishes
  `bb.realtime.publish("scene", {id, rev})`, and the page fetches the patch
  since its revision over RPC (`scene.since({id, rev})` → RFC 6902 ops). This
  follows the SDK's own guidance: realtime carries signals, RPC carries data
  [doc]. A late or reconnecting client gets a snapshot.
- **Catalog entries** are declared like RPC contracts: a key, a zod props
  schema, the source kinds the entry accepts, a markdown fallback (for
  `describe`, for screen readers, and for hosts that cannot render it), and the
  React component. The MVP needs:
  - `thread.list`
  - `thread.card`
  - `thread.detail`: header, PR, the latest reply, `ThreadChat` timeline on
    demand
  - `pr`
  - `timeline`
  - `markdown`
  - `stat`

  Later: `diff` (bb's `experimental_Diff`), `graph` (the thread tree and
  relations), `image`, `automations`, `tasks`, `lanes`, `hosts`, `chart`
  (Vega-Lite, kb's choice).
- **The escape hatch** is `view: "html"`.
  - The agent writes a self-contained HTML document. The page renders it as an
    MCP Apps view in an iframe with `sandbox="allow-scripts"` and no
    `allow-same-origin` (an opaque origin, since a bb plugin page has no second
    origin for the spec's proxy iframe) and a CSP of `default-src 'none'`
    plus inline script and style.
  - It is hosted through `@modelcontextprotocol/ext-apps/app-bridge`.
  - The iframe may call **app-only, read-only** tools: the same source
    resolvers as §3.3. A generated chart can therefore still bind live bb data
    without network access.
  - It is untrusted by default and never persisted to kb unless promoted. A
    generated view that proves itself is promoted into the catalog by a person
    (kb decision 4C).

### 3.3 Live data bindings

A `Source` is a typed query the server knows how to resolve, never a value the
agent copied:

```ts
type Source =
  | { kind: "bb.threads"; where?: { projectId?: string; status?: string[]; needsMe?: boolean; pinned?: boolean; hostId?: string }; sort?: "recent" | "attention"; limit?: number }
  | { kind: "bb.thread"; threadId: string }
  | { kind: "bb.thread.timeline"; threadId: string; last?: number }
  | { kind: "bb.pr"; threadId: string }
  | { kind: "bb.diff"; environmentId: string; path?: string }
  | { kind: "bb.automations" } | { kind: "bb.tasks"; where?: object } | { kind: "bb.hosts" }
  | { kind: "kb.query"; edn: string }   // later, through the kb plugin
  | { kind: "static"; value: Json };    // what the agent summarised itself
```

- **The server owns resolution and invalidation.** Each source kind has a
  resolver over `bb.sdk`, for example `threads.list`/`get`/`timeline` and
  `environments`. Another plugin's data is read through
  `bb.sdk.plugins.callRpc`: `github-pr-status` for PRs, `tasks`, `automations`,
  `agent-lanes`. Each resolver also declares which change events invalidate it.
  One `bb.sdk.subscribe` per event kind (`thread:changed`,
  `environment:changed`, `host:changed`, `project:changed` [measured, SDK
  types]) maps each event to the source keys it affects. Bursts are debounced
  to 250 ms, and the server publishes `bb.realtime.publish("source", {keys})`.
  Data with no change event (PR checks) is polled while visible, at most every
  30 s.
- **The page fetches through RPC** with a keyed query per source
  (`experimental_useRpcKeyedQuery`) and refetches on the signal. A card's bound
  props read `{"path": "/status"}` from the resolved value, exactly A2UI's
  binding, and lists bind each row by the same pointer.
- **So the agent pays once, to decide what to show.** Updates are free. The
  concierge does not need to be running, and the scene stays honest when the
  agent's own summary would have gone stale. `static` exists for what the
  agent itself wrote, such as a summary, and it is visibly marked as written
  at a time.

## 4. Space and interaction

### 4.1 Regions and the solver

| Region | Default content | Depth and tilt | Overflow |
|---|---|---|---|
| `dock` | The orb, captions, call controls | Nearest, flat | Never |
| `focus` | What the conversation is about right now: a timeline, a chart, one card | Near, flat | The previous focus moves to the periphery |
| `left` | Detail: one thread, one PR, one diff | Mid, tilted toward the centre | It stacks; the older item shrinks to a tab behind |
| `right` | Collections: lists, search results, the board | Mid, tilted toward the centre | It pages ("next page" or swipe) |
| `periphery` | Ambient: automations due, lanes, hosts, things that receded | Far, dim, small | The oldest leave the scene (undo brings them back) |

- **Left and right are the owner's words, and a reasonable default.** Reading
  order runs collection then detail, so on a desktop the list could equally sit
  on the left. Keep the region names semantic (`detail`, `collection`) in code,
  and map them to sides through one setting.
- **The solver is deterministic and pure,** so it can be tested and shared
  with kb. Its inputs are the regions, the items' intents and the human pins;
  its output is every box. Moves animate.
- **The agent never reasons about pixels.** It says "on the left", "near t2,
  below", or "in the board". This is kb's `ext.canvas.place` relation set,
  resolved by the same rules (snap, step along until clear).

### 4.2 Voice and touch on the same scene

- **Handles.** Each visible item has a handle: list rows are numbered, and
  panels are lettered when there are more than two. The spoken reply uses them
  ("number two is waiting on you"), and the persona gets one rule: *when you
  put it on the canvas, say one sentence and refer to it by its number*.
- **Deixis:**
  - Every scene has a recency stack: the item pointed at, the item spoken
    about, and the item in focus. "This" or "that" resolves to the item touched
    or pointed at in the last ~3 s, then to the item the concierge last
    mentioned, then to the focused item.
  - Put-that-there (Bolt, 1980) works: tap the item while saying "move this
    next to the PR".
  - Web pages get no gaze on visionOS (it is private by design), so the pointer
    and touch are the deictic channel.
  - When the referent is ambiguous, the candidates light up with their handles
    and the concierge asks which one.
- **Pointer and touch:**
  - Tap selects. The selection enters the recency stack and goes into the next
    concierge turn as context, the same way kb's screen state rides along with
    every message.
  - Drag moves the item and pins it (`pinnedBy: human`).
  - A long press opens a menu: open in bb, detail, explain, remove.
  - Dragging from an item's edge handle to another item connects them.
  - Double-tap focuses. Pinch and scroll zoom, and dragging the background pans.
- **Two speeds of voice command:**
  - The realtime voice model handles **deictic, structural commands** itself
    ("open number two", "go back", "undo that", "show the list again"). It does
    this through a few fast tools on its backing Codex thread (the concierge's
    `dynamicTools` mechanism, answered by the host like `ask_concierge`):
    `spatial_camera`, `spatial_describe`, `spatial_undo`, select. That costs
    no concierge-thread turn and takes about 1 s.
  - **Content questions** ("what did the reboots thread conclude?") go to the
    concierge's bb thread as today. Its agent calls `spatial_place` while it
    composes the answer, so the cards appear before the sentence is spoken.

### 4.3 Persistence and undo

- **The history is the operation log.** Every tool call is one step, tagged
  with its actor (agent, voice or hand), and so is every finished gesture: a
  drag that ends, a connect. "Undo that" and ⌘Z both undo the last step,
  whoever made it, and redo is the same log forward. kb's canvas already
  behaves this way: each canvas write is one history step.
- **Autosave:** each call's scene is kept in `bb.storage` for 30 days, keyed by
  call. "Show me yesterday's board" restores it, and its sources re-resolve, so
  it shows today's data in yesterday's arrangement.
- **"Save this as a canvas"** writes a kb canvas through the kb plugin, using
  kb's own actions (`ext.canvas.tx.apply`, `place`, `connect`):
  - each item becomes a kb `link` item whose `url` is the bb deep link
    (`bb://thread/<id>`, or the web URL);
  - `view`, `source` and `handle` go in the extra fields, which kb's JSON
    Canvas reader round-trips;
  - edges become canvas edges, and `static` content becomes `text` items.

  The saved canvas is then a node in the owner's kb, linked, searchable and
  editable there.

## 5. Architecture in bb

```
 voice (WebRTC) ─► GPT-Live ─► backing Codex thread ──fast tools──┐
                                   │ ask_concierge                │
                                   ▼                              ▼
                     concierge bb thread ──spatial_* tools──► plugin server: scene store (op log, bb.storage)
                                                              │  source registry ◄─ bb.sdk.subscribe(thread:changed, …)
                                                              │                  ◄─ callRpc(github-pr-status, tasks, automations)
                                                              ▼
                       bb.realtime "scene"/"source" signals ─► page(s): concierge page "Spatial" layout
                                                              ◄─ RPC: scene.since, source.resolve, gesture ops
```

- **The plugin surface** [doc, bb-plugin-authoring references]:
  - Server: agent tools with per-thread selection (`bb.agents.registerTool`
    plus `configure`, which selects them for the thread whose plugin metadata
    is `role: concierge`); `bb.rpc` for the data plane; `bb.realtime` for
    signals; `bb.storage` for scenes; `bb.sdk.subscribe` for change events;
    `bb.sdk.plugins.callRpc` for other plugins' data; `bb.cli`
    (`bb voice-concierge scene …`) for agents and scripts that don't load the
    tool.
  - Frontend: the existing `navPanel` page gets the layout, and
    `experimental_appOverlay` keeps the call pill on other pages, as it does
    today. Host components: `ThreadChat`, `experimental_Diff`, `Markdown`,
    `experimental_InfoList`.
- **Why the concierge plugin first and not a new plugin:**
  - The page already owns the call, the sphere and the captions, and the
    surface is its output.
  - A frontend cannot subscribe to another plugin's realtime channel
    (`useRealtime` sees only its own plugin's signals [doc]). A separate plugin
    would need a server-side proxy for every call state.
  - The code goes in `assets/bb-plugins/spatial-kit/` (scene model, solver,
    catalog, renderer, source registry), imported by relative path. The kb and
    canvas-links plugins already share `assets/bb-plugins/linked-items/` this
    way, and `bb-plugins-sync` packs sibling code. When the standalone plugin
    comes (phase 3), it imports the same kit, and tool registration moves
    there.
- **Multiple machines:** nothing new.
  - The plugin server runs with the bb server, and `bb.sdk` already sees every
    machine's threads and environments. Diffs and files come through
    `bb.sdk.files`/git reads on the machine that holds them.
  - The voice backend's machine choice is unchanged.
  - Because the scene lives on the server, **every window that opens the page
    sees the same scene live**: start on the phone, look at the laptop. Each
    client keeps its own camera.
- **Mobile:** the stacked layout of the mockup.
  - No tilt, no blur, one heavy component at a time.
  - The list is a numbered strip that scrolls sideways; the detail is the main
    sheet; the orb sits in the existing bottom call bar.
  - Touch gestures are as in §4.2.
- **Safety:**
  - Every operation is validated against the catalog. Sources are read-only
    and see only what the plugin's SDK can already see.
  - Generated HTML runs sandboxed, with no network and read-only tools.
  - Items that act (open, merge, send) only navigate in the MVP. Writes still
    go through the concierge's spoken "say which thread and wait for yes" rule.

## 6. Path to kb

kb already decided most of this for itself
(`docs/brainstorms/2026-09-29-kb-genui-canvas-agents/README.md` in popemkt/kb).
The port is a matter of *meeting* those decisions, not adding new ones:

| Concern | kb's decision | What bb's surface does now so that the port is a renderer swap |
|---|---|---|
| Scene model | A canvas is a view node. The layout is entries of node id plus transform (x, y, z, size, rotation); 2D and 3D are one layout through two cameras (decisions 6 and 8) | `Item.box` is kb's box shape, and save-as-canvas writes kb canvas items |
| Agent verbs | `ext.canvas.place/connect/arrange/group/edit/describe/tx.apply`, with relational placement | The `spatial_*` tools use the same verbs and the same relation words |
| Generative UI | Mode A: the model writes *view nodes* against kb's own catalog (`ViewPoint`); mode C: code views in a sandbox over the MCP Apps bridge (decisions 4, 5 and 9) | Items are "a view from a catalog, with params and a source". The escape hatch is the same MCP Apps bridge |
| What is on screen | `ui.screen`/`ui.navigate`/`ui.select` over a per-tab screen channel (decision 7) | `spatial_describe` and `spatial_camera` return and act on the same kind of state. Selection rides along with the next turn |
| Projections | DOM 2D plus three.js WebGPU 3D, with HTMLTexture when HTML-in-Canvas ships, under `CANVAS_PROJECTIONS` | Projection C now; D later, under the same contract |

- **Shared:** the scene model and its op log, the relation-based solver, the
  protocol (the operations, A2UI-shaped props, JSON Patch deltas, MCP Apps for
  code), the catalog *contract* (a key, a schema, a markdown fallback, a
  renderer), and the projection contract suite.
- **Host-specific:** catalog *entries* (bb: thread, PR, diff, `ThreadChat`; kb:
  outline, table, graph, chart), source kinds (bb SDK queries vs datalog), and
  the store (`bb.storage` scenes vs kb view nodes).
- **The one new concept kb would need:** a canvas item that shows *a view with
  a live source*, not just a node. In kb terms that is a canvas entry pointing
  at a view node (mode A) whose query is the source, which kb's decision 1
  already allows. A bb source becomes one more source kind, served by the kb
  bb plugin. No second canvas, catalog or format.
- **The end state:** bb's spatial surface and kb's canvas are two hosts of one
  canvas. kb's `canvas-ui` could even render the bb scene inside bb's kb tab,
  with bb's catalog entries registered as view renderers.
  - **A drift to record when this is built:** until kb has view items, the kit's
    renderer is a second canvas renderer. When phase 1 lands, record it as a
    `#gap` node in this repo's kb, closed by phase 4.

## 7. Phased plan

| Phase | Scope | Exit criterion | Size |
|---|---|---|---|
| **0** | This doc and the mockup | Owner picks the open-question defaults | done |
| **1 · MVP** | `spatial-kit`: scene, op log, undo, the solver for the five regions, the source registry (`bb.threads`, `bb.thread`, `bb.pr`, `static`), and catalog entries `thread.list`, `thread.card`, `thread.detail` (with `ThreadChat` timeline), `pr`, `timeline`, `markdown`, `stat`. SVG edges; CSS-3D projection with the room behind. Concierge: a "Spatial" layout ≥ 880 px wide, the orb as the dock, the `spatial_*` tools for its thread, the persona rule on handles, scene autosave. Pointer: select, drag (pins), connect, ⌘Z. Tests: solver, op log, deixis resolution, source invalidation | The owner's example works out loud: "what's running?" puts a list on the right; "detail number two" opens it on the left with an edge; a thread finishing elsewhere updates its card with no new turn; "undo that" works | 4–5 days |
| **2** | Fast voice tools on the backing Codex thread (camera, describe, undo, select); the phone layout; catalog entries `diff`, `graph` (the thread tree), `automations`, `tasks`, `lanes`, `hosts`; save as kb canvas; restore past scenes; LOD chips for the periphery | Hands-free on a phone; a saved board opens in kb | 3–4 days |
| **3** | A standalone `spatial` plugin: any thread drives a scene in its side panel (`experimental_tab`), the tools move there, `bb spatial` CLI; the `html` escape hatch on the MCP Apps bridge; optional A2UI import and export at the edge | A coding thread can say "draw the module graph" in its own panel | 4–6 days |
| **4** | Convergence with kb: kb canvas view items with live sources, a bb source kind through the kb plugin, and kb's `canvas-ui` as a host. Projection D (HTML-in-Canvas through three.js `HTMLTexture`) behind feature detection; WebXR/visionOS immersive as an experiment | One scene opens in bb and in kb's canvas, and the projection suite passes for C and D | open |

## 8. Open questions, each with my default

1. **MVP inside the concierge plugin, or a new plugin straight away?**
   *Default:* inside the concierge, with the code in a shared
   `spatial-kit/` folder; a standalone plugin in phase 3.
2. **Which side is "detail"?** *Default:* detail on the left and collections on
   the right, as the owner described. Regions are semantic in code, so one
   setting swaps them.
3. **Who may drive a scene?** *Default:* only the concierge's thread and its
   voice model in phase 1–2; any thread, in its own panel, from phase 3.
4. **Do canvas items act?** *Default:* in the MVP they only navigate (open in
   bb, detail, focus). Acting items (merge, send, stop) come later, each
   through the concierge's spoken confirmation, never as a bare button press
   from generated UI.
5. **How long are scenes kept, and are they auto-saved to kb?** *Default:* 30
   days in plugin storage; kb only on "save this", so kb holds only what the
   owner chose.
6. **May the agent write HTML (the escape hatch)?** *Default:* yes, from phase
   3. It is sandboxed with no network and read-only tools, marked
   "generated", and never persisted unless promoted.
7. **Build the no-HTML GPU mode?** *Default:* only as LOD impostors when a scene
   passes about 200 items. A full GPU projection waits for HTML-in-Canvas
   outside Chromium, or for an XR use.
8. **Does the concierge speak less when it shows?** *Default:* yes. One
   sentence, then the handles; the canvas carries the detail. The persona can
   be told "say more" per call.
9. **Theme.** *Default:* follow bb's theme tokens. The dark "room" of the
   mockup is the dark theme's atmosphere, and a light theme gets a light room.
10. **One scene shown live on every client?** *Default:* yes, a shared scene
    with a camera per client, so the phone and the laptop show the same
    board.

## Sources

- WICG HTML-in-Canvas: https://github.com/WICG/html-in-canvas ;
  https://developer.chrome.com/blog/html-in-canvas ;
  https://developer.chrome.com/blog/html-in-canvas-ot-changes
- MCP Apps (SEP-1865):
  https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp ;
  https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx ;
  https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt
- A2UI: https://github.com/google/A2UI ; https://a2ui.org/reference/messages/
- AG-UI: https://docs.ag-ui.com/concepts/events
- json-render: https://github.com/vercel-labs/json-render ; https://json-render.dev/docs/streaming
- Vercel AI SDK: https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces
- Adaptive Cards: https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/adaptive-cards-overview
- tldraw: https://tldraw.dev/blog/tldraw-sdk-5-0 ; https://tldraw.dev/starter-kits/agent
- visionOS `<model>`: https://webkit.org/blog/17118/a-step-into-the-spatial-web-the-html-model-element-in-apple-vision-pro/
- WebSpatial: https://webspatial.dev/docs ; pmndrs uikit: https://docs.pmnd.rs/uikit
- R. A. Bolt, "Put-that-there: voice and gesture at the graphics interface", SIGGRAPH 1980.
- kb (popemkt/kb v0.3.0): `docs/brainstorms/2026-09-29-kb-genui-canvas-agents/` (README, generative-ui.md,
  canvas-2d-3d.md); `packages/extension/canvas/src/{doc,place,shapes}.ts`.
- bb Plugin SDK: the bb-plugin-authoring skill references and the bundled `bb-plugin-sdk.d.ts` (bb 0.48.x).
