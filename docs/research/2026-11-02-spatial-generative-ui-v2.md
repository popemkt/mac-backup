# A spatial, generative canvas for the voice concierge (v2)

Date: 2026-11-03. Design only: nothing here is built. This revises
[v1](2026-11-02-spatial-generative-ui.md) after the owner's feedback, and
replaces it where the two differ (§0 lists where).

**Amended by the [v3 delta](2026-11-02-spatial-generative-ui-v3.md)**
(2026-11-03): the engine moves out of kb into a standalone fork of kb's
canvas, shipped first as a bb plugin; the agent acts in plain JS in a
sandbox; skills are the extension point. v3 §0 lists what changed.

**The owner's direction (condensed).**
1. A second mode of the voice concierge: a panel that can expand to full
   screen, with the voice as its input.
2. No fixed layout. Anything can go anywhere in 3D space, with layout,
   window and item presets to pick from. A preset arranges; the person and
   the agent can still move anything.
3. Disciplined, in kb's way: a component library to compose from, plus
   generative UI and styling when needed.
4. Defined data sources (bb, plus kb, GitHub, Google Calendar, files, HTTP,
   static), each with queries over it, and live or static per binding, like a
   tldraw store.
5. A flat 2D canvas mode of the same scene, for when 3D is tiring without a
   headset.
6. tldraw computer's direction: queries and commands flowing between items,
   live.
7. **Speed comes first:** the voice already feels fast, so the canvas must
   keep up.

"In the end I pretty much describe tldraw, with directions like tldraw
computer. If there is no good pre-made tech, we do it ourselves, with kb's
coding discipline, and reference the kb canvas extension."

Claim tags:

- **[measured]**: observed on shared-server today.
- **[doc]**: specification, vendor documentation, or source read today. kb
  claims cite kb's `DESIGN.md` on `main` (`1740c95b`).
- **[secondary]**: a third-party write-up.
- **[estimate]**: arithmetic, or a guess to be measured in phase 1.
- **[unverified]**: a hypothesis.

## 0. What changed from v1

| v1 | v2 | Why |
|---|---|---|
| Five fixed regions; the agent placed items by region | Free placement anywhere in 3D (the page's plane bent around the viewer in the room projection), plus layout presets that arrange and then let go (§5) | Owner direction 2 |
| A protocol of our own and seven `spatial_*` tools in a bb plugin | **kb's canvas verbs, called through `kb_call`**; no new agent tool set | kb's canvas already has the scene model, the verbs, undo, 2D and 3D, and a dataflow run. Two vocabularies would break Rule 1 |
| A `spatial-kit` folder in the dotfiles bb plugins | **The engine lives in kb**; bb keeps only the voice side (§8) | It would otherwise be built twice |
| Sources were bb queries inside the plugin | **One source contract: kb read actions with an optional live feed.** Commands are kb write actions. Adapters are kb extension families (§4) | "One contract, every implementation" |
| No data flow | Typed ports and live dataflow, generalising `ext.canvas.run` (§3.4) | Owner direction 6 |
| A layout on the concierge page | **A second mode of the concierge**: a panel that expands to full screen, with the orb as an ornament (§8) | Owner direction 1 |
| 3D look first | **Flat first**: same scene, two projections, flat as the default (§6) | Owner direction 5; phones |
| Speed was implicit | **A latency budget and a reflex path with no model in it, measured in the prototype** (§7) | Owner direction 7 |

## 1. Recommendation

1. **Build it ourselves, on kb. No pre-made product does this, and kb
   already has most of the parts.**
   - tldraw's editor is the best flat canvas, but it needs a paid production
     licence key [doc], has no 3D, and has no live data sources.
   - tldraw's MIT store and signals (`@tldraw/store`, `@tldraw/state`) would
     be a second store beside kb's node store. That is the mirror kb's Rule 1
     forbids.
   - tldraw computer is closed and has been quiet since 2025 [secondary].
   - kb already has the canvas document, relation-based `place`, `arrange`,
     `connect`, `describe`, `tx.apply`, undo, 2D and 3D projections of one
     document, view nodes with a catalog, code views in a sandbox on the MCP
     Apps bridge, live datalog `rows` subscriptions, an action registry with
     read/write modes and approval, and **`ext.canvas.run`: "a canvas as a
     computer", tldraw computer's model built from kb's parts** [doc].
   - Adopt only small MIT pieces where they fit (§2).
2. **One scene, two projections.**
   - The scene is a kb canvas document: a `#canvas` node, with one page per
     concierge session.
   - **Flat** is kb's DOM canvas as it is today.
   - **Spatial** is a new 3D projection, `room`, set per page. It bends the
     page's plane into a cylinder around the viewer:
     - the floor plan's x runs around the viewer;
     - its y runs up the wall;
     - kb's elevation (z) comes off the wall toward the viewer.

     So `on`, layers, snapping and frames keep their meaning; the plane only
     stands up.
   - Flat draws the page as kb does today. A move in either projection is a
     move in both. The room projection gets a contract of its own: domain,
     seam, inverse picking, orientation and the elevation limit (§3.1).
3. **An item is a component plus a binding, and both are nodes.**
   - A placed component is a canvas item standing for a **view node**: kb's
     generative-UI mode A, where the view key comes from kb's view catalog
     and its params are checked against the view's schema.
   - Its **bindings** say which read action supplies each input, with what
     input, and whether the binding is live, read once, or polled. They are
     node fields, read and written through the view key's existing
     `config.read/write`.
   - Generated UI is a `code.view`, which already exists in kb: sandboxed,
     with a grant. Styling is the view's style params plus kb's look tokens.
4. **One source contract, many adapters.**
   - A query is a kb **read action**. A live query is a read action that also
     declares a **change feed**: the subscription hub re-runs it when the
     feed fires and pushes the result, as it already does for datalog `rows`.
   - A command is a kb **write action**. **Prerequisite:** kb enforces no
     approval today ("Current stance": governance contributes no guard, so
     every call runs [doc]). Commands wait until enforcement is restored
     (§3.5).
   - Sources are kb extension families: core kb, bb (new), GitHub, files,
     HTTP and static, with Google Calendar through the routines family.
5. **Data flow is `ext.canvas.run` made typed and live.**
   - Today `canvas.run` carries text and stores each output on its node, and
     runs only on demand [doc, `flow.ts`]. Typed JSON ports and live re-runs
     are a substantial extension of that contract, not a free reuse.
   - There is **one component execution contract** for both the on-demand
     run and the live scheduler: a component declares typed ports and has one
     performer and one output model. Headless components (query, transform)
     and views are both components.
   - Queries and transforms are **pushed**: they re-run when their input
     changes.
   - Model steps (instructions) and commands are **pulled**: they run only
     when someone presses run or says yes. Nothing spends a model or writes
     on its own.
6. **Presets are named `arrange` layouts.** kb has row, column, grid, ring,
   stack, layers, align and distribute. Add arc, focus+context, kanban,
   timeline, force, tree, radial and shelf, plus visionOS's window, volume
   and ornament as *kinds of item*, not layouts.
   - A preset writes positions once, through the same transform path as a
     person's drag.
   - A frame may keep a preset live, so new members arrange themselves.
   - Anything a hand moved is pinned and left alone.
7. **Speed: a reflex path with no model, three paths in total.**
   - The concierge's host already emits the person's final transcript
     (`host.ts`). A small grammar over the canvas vocabulary plus the spoken
     handles ("number two") turns common asks into kb canvas ops directly.
     - The router **claims the turn**. The voice model's own delegation of
       that turn (`ask_concierge`) is then answered at once from the claim,
       never relayed (§7.2).
   - Data is read from an in-memory cache that bb's change events keep
     current.
   - **What the prototype measured** (local callback timings, from a
     synthetic call): routing about 0 ms, ghost after 33–54 ms, populated
     after 66–101 ms median (p95 125.3 ms).
     - This counts no transcription, socket, kb transaction or real view.
     - The end-to-end targets (≤ 1 s from the end of speech) are
       **unvalidated** until phase 1 measures them.
   - Asks the grammar misses go to a fast model. Only open-ended asks take
     the concierge thread's 20–30 s path; a ghost is placed when the
     delegation is dispatched, and the thread fills it.
8. **Where code lives:**
   - **kb** gets the engine: the scene, projections, presets, the catalog,
     the source contract, live reads, dataflow and the bb source family.
   - **The dotfiles bb plugins** get the voice side: the concierge's canvas
     mode (a kb canvas page in a frame, which can go full screen), the reflex
     router, and the hand-over of bb credentials to kb.
9. **Anything can go on the canvas, and heavy items stay cheap** (§3.6,
   §6.1).
   - Notes, kb nodes and views, bb records, files and media, websites, raw
     or generated HTML: each is an existing kb item type or a view node, with
     no new storage shape.
   - Each view has three faces (live, snapshot, glyph). Only focused or near
     items go live, within a live budget (4 frames, 2 videos, 6 code views on
     a desktop), and a spatial index culls everything off screen.
   - A site that refuses framing becomes a link card with a snapshot.
   - **Live data re-runs only what a write touched** (§7.5): each query
     derives its read set, each write carries its write set, and a query
     re-runs only when the two intersect. It is done in TypeScript, and
     measured before anything heavier.
10. **Build order:**
   - **Flat first**, with live bb data and the reflex path, because it is
     cheap, works on a phone, and is what the owner uses daily.
   - Then the room projection (three.js plus a CSS3D layer for real DOM
     windows), commands with spoken confirmation, and the fast-model path.
   - Generated UI, HTTP and calendar sources come later.
   - XR (WebXR with GPU-drawn faces) comes last.

**Prototype.**
[`canvas.html`](#prototype-v2) shows one scene in both projections, with five
presets, typed ports and wires (query → filter → list → detail → command), and
the reflex path with its local callback timings. The screenshots are in the design
thread's storage and are not committed (§10).

## 2. Pre-made tech: adopt, borrow, or build

The versions and licences below are as of today [doc, from the npm registry
and each project's licence file].

| Candidate | What it offers | Licence and status | Verdict |
|---|---|---|---|
| **kb canvas** (`@kb/canvas`, `canvas-ui`, `ext-canvas`) | JSON Canvas documents in `sys.f.canvas`; pages; relation-based `place`; `arrange`; bound edges; items standing for nodes; scripts; 2D DOM and 3D three.js (WebGPU) projections of one document; `ext.canvas.run` dataflow with a pure engine (`flow.ts`); scale target 2,000 items a page [doc] | Ours | **Build on it.** It is the canvas the owner already uses in place of tldraw |
| tldraw editor (`tldraw` 5.6.0) | The best flat whiteboard UX: ShapeUtil, BindingUtil, agent and workflow starter kits | The tldraw licence: **a key is required in production**; trial or hobby (with a watermark); commercial pricing by quote | **Borrow ideas only** (bindings, the agent kit's clustered `describe`, the workflow kit's `STOP_EXECUTION`). kb already took several |
| `@tldraw/store`, `@tldraw/state` | A record store with migrations and history; signals with incremental diffs | MIT | **Don't adopt.** It would be a second store and a second reactivity beside kb's nodes, transaction tail and subscriptions |
| tldraw computer | Components with instructions, arrows carrying data, Gemini performing | Closed; no updates found since 2025 | Its model is already in kb as `ext.canvas.run` |
| three.js (r187) incl. `CSS3DRenderer` | Already kb's 3D stage. CSS3D draws real DOM with the 3D camera's transforms | MIT | **Adopt** `CSS3DRenderer` for near "windows" in the room projection: what drei's `<Html transform>` does, without React Three Fiber |
| React Three Fiber 9.8 / v10 alpha; drei 10.7 / v11 alpha | A React renderer for three; `<Html transform>`, whose `occlude` only fades the element or cuts a rectangle in the GPU layer (no true depth) | MIT; v10 is mid-migration to WebGPU | **Don't adopt now.** kb drives three directly; kb's own research already deferred R3F |
| pmndrs uikit (`@react-three/uikit` 1.0.78) | GPU flexbox UI with MSDF text; Meta's spatial UI layer | MIT; no accessibility tree [unverified] | **Adopt later, for XR only**: the faces items show inside an immersive session, where DOM is not composited |
| WebXR on visionOS Safari | immersive-vr, gaze-and-pinch (`transient-pointer`), hand tracking; no immersive-ar. Safari 27 adds `<model>` everywhere and website environments | Shipping [doc] | Target of phase 4. Android XR Chrome also has immersive-ar |
| WICG HTML-in-Canvas | Real DOM as GPU textures, still interactive | Chromium only; dates conflict (see v1 §2.2) | **Watch.** Plug it into the room projection behind feature detection, which kb's research already planned |
| React Flow / xyflow 12.12 | Node-and-port editor UX; no execution engine | MIT; removing the attribution badge is asked to be Pro-only | **Borrow ideas** (port handles, connection validation, edge routing). kb's edges already route and bind |
| Rete.js 2 | Separate dataflow and control-flow engines | MIT; engine last released 2024-12 | **Borrow the split**: queries are dataflow (push); commands and model steps are control flow (pull) |
| Observable Runtime 6 / Notebook Kit | Named reactive variables, async and generator values, invalidation | ISC | **Borrow the semantics** for the live scheduler (topological re-run, cancel what an invalidated input started) |
| Signals (TC39 Stage 1; alien-signals, Preact) | Fine-grained reactivity | Stage 1 [doc] | Not needed for the model; kb's UI keeps what it uses |
| Excalidraw 0.18 | A flat element array; no custom-shape API | MIT | No |
| AFFiNE / BlockSuite | Edgeless canvas on Yjs | Mixed licences; heavy | No |
| Natto.dev, folkjs, Ink & Switch (Embark, Potluck, Patchwork) | Canvas JavaScript dataflow; HTML-as-canvas with propagators; malleable documents | Research | **Borrow ideas.** Folk's "programs talk only through a shared fact base" already maps onto kb's datalog, as kb's research noted |

**Conclusion.** Nothing combines a flat canvas, 3D, live typed sources and a
dataflow run under a licence we can ship. kb has the base, so we build the
rest on it, adopting three's `CSS3DRenderer` now and uikit with WebXR later.

## 3. Model

In kb terms, this needs these additions; everything else exists:

- view items (an item standing for a view node draws the view);
- **one component execution contract** with typed JSON ports, used by both
  `canvas.run` and the live scheduler;
- a change feed on read actions, owned by the existing subscription hub;
- the `room` projection and its contract;
- renderers for media, PDF and HTML files, plus the faces of §6.1;
- restored approval enforcement before any command (§3.5).

### 3.1 Scene

```ts
// The scene is a kb canvas document (DESIGN.md → Canvas documents), unchanged:
// a #canvas node, its document in sys.f.canvas, one page per concierge session.
type CanvasItem = {                 // kb's existing item record (doc.ts), abbreviated
  id: string; type: "kb-node" | "text" | "group" | "shape" | "file" | "path" | "link";
  x: number; y: number; width: number; height: number;   // the floor plan = the flat canvas
  z?: number; depth?: number; rotation?: Rotation;        // kb's 3D extras, already round-tripped
  nodeId?: NodeId;                  // the item stands for a node — here, a view node
  locked?: boolean; billboard?: boolean; link?: Link;
};
// The room projection bends the page's plane into a cylinder around the viewer.
// The floor plan becomes the wall: x → around (azimuth = (x − x0) / R), y → up the wall,
// and kb's elevation z → off the wall, toward the axis. distance = R − z, with z ≤ R − nearLimit.
// R is derived per page so the page's extent spans at most θmax (default 240°): nothing wraps.
type RoomCamera = { projection: "room"; thetaMax: number; nearLimit: number; yaw: number; pitch: number; fov: number };
```

- **The geometry is kb's, read with the plane standing up.** kb's floor plan
  is x/y and its elevation is z; `place`, `arrange` and snapping work on that
  surface [doc].
  - The room keeps all of it and changes only where the surface is.
    "On top of" means in front of it, toward the viewer. Layers stand out
    from the wall by their value. Frames, groups and rotations are what they
    are on the plane.
  - **Flat needs no change:** it is kb's top view, exactly as today (it
    shows elevation as kb already does, not as a new scale).
- **The room projection contract** joins `CANVAS_PROJECTIONS` and states:
  - **Domain:** x within the page's extent, mapped to at most `thetaMax`. A
    page wider than that gets a larger radius, so distant items never meet
    across a seam.
  - **The near limit:** the projection clamps elevation so that the distance
    R − z stays at or above `nearLimit`. The clamp is **display-only**:
    stored z never changes, and `describe` and lint report a clamped item.
  - **The radius:** R is derived from the page's extent and `thetaMax`. It
    is recomputed only when the extent outgrows the current R, never during
    a gesture (it is frozen from pointer-down to pointer-up), and a change
    animates.
  - **Inverse picking and dragging:** a ray hits the cylinder (or an item's
    own panel) and gives back x and y; z stays unless the gesture is a push
    or a pull.
  - **Orientation and size:** each item is a flat panel tangent to the
    cylinder at its centre, facing the axis, at its width and height. Items
    wider than 20° of arc are drawn as bent strips (later).
  - **Rotations and nested groups:**
    - Group and membership transforms compose on the plane first, as kb does
      today. Each item's composed box is then projected as its own tangent
      panel; children are not bent separately.
    - A rotation about the plane's normal is the panel's roll.
    - Rotations about in-plane axes tilt the panel relative to its tangent
      frame, as they tilt it relative to the floor in kb's tabletop view.
  - **The shared suite:** pick, select, focus, and "a move in one projection
    shows in the other".
- **What changes in kb:** a `room` value beside `2d-ortho` and
  `3d-perspective` in the view node's camera, plus that contract. The
  tabletop 3D view stays as it is.

### 3.2 Components are view nodes

```ts
// An item whose nodeId is a view node draws that view (generative-UI mode A, DESIGN.md → View nodes).
// Stored as node fields, read and written through the view key's existing config.read/write;
// no new top-level storage. Shown here as the decoded settings.
type ViewSettings = {
  "sys.f.view": ViewOptionId;          // which component: record.list, record.card, timeline, code.view …
  settings: Decoded<ViewKey["params"]>; // includes bindings and look (kb's tokens: tone, density, emphasis; never raw CSS)
};
// One component execution contract, used by canvas.run and the live scheduler alike.
type Component = {
  ports: { inputs: Record<PortName, JsonSchema>; outputs: Record<PortName, JsonSchema> };
  perform: "query" | "transform" | "view" | "instruction" | "command"; // how it runs (§3.4)
  // Outputs are stored as today (the node's output field), now JSON, typed by its output port.
};
// A view key may declare the component it is; a headless component (query, transform) has no view.
```

**The catalog is kb's view catalog** (`ViewKeyPoint`), and it is published in
`kb_manifest`. The components are generic over records, with no bb-specific
widgets in core:

- `record.list`, `record.card`, `record.detail`, `record.table`
- `board` (kanban)
- `timeline`
- `graph` (kb's graph renderers)
- `chart` (Vega-Lite, kb's planned chart view)
- `markdown`
- `image`
- `stat`
- `diff`
- `command` (§3.5)
- `code.view` for generated UI

A source family may contribute a *presentation* for its record type: bb's
thread record gets the status dot, the PR chip and the latest reply. That is
one view key per record type, not a second catalog.

### 3.3 Bindings and the source contract

```ts
type Binding =
  | { action: ActionId; input: Json; mode: "live" | "once" | { pollMs: number } }   // a query
  | { from: { item: ItemId; port: PortName } }                                       // a wire
  | { value: Json; at: string };                                                     // static (an agent's own words, timestamped)

// The source contract is kb's ActionDefinition plus one optional member.
type ReadAction = ActionDefinition & {
  mode: { kind: "read"; outsideRoot?: true };
  feed?: ChangeFeed;   // new: what makes this read's answer stale
};
type ChangeFeed = {
  // The subscription hub calls subscribe once per distinct (action, input) that something binds live.
  subscribe(input: Json, stale: () => void): Unsubscribe;
  coalesceMs?: number; // bursts become one re-read
};
```

- **Feeds are owned by the existing subscription hub, not a new one.** Every
  adapter joins one shared suite: cancellation, reconnect with a fresh
  snapshot, deduplication of equal (action, input) pairs, and no stale answer
  after a newer one.
- **Live reads generalise what kb already does for datalog.** kb's server
  re-runs a `rows` subscription when the transaction tail moves and pushes
  the answer over `/ws` [doc].
  - A live binding is the same thing for any read action: the hub keys the
    subscription by action and input, re-invokes the action when its feed
    fires, and pushes the answer only if it changed.
  - The reads of the core kb family use the transaction tail as their feed.
- **Static and once** are the same call with no feed. A static value is just
  data on the view node.
- **Commands** are write actions (§3.5).
- **Every surface sees the same thing:** a binding is a call a person could
  make with `kb call`, the MCP server, or `kb_call` from a bb thread.

### 3.4 Data flow: typed ports, push and pull

- **Wires already exist.** In `ext.canvas.run`, an edge between two items
  standing for nodes carries the output of one into the other [doc]. Today
  that output is **text**, stored on the node, and a run happens only when
  asked. v2 extends that one contract rather than adding a second engine:
  - **Types:** an edge from port to port is allowed only when the output's
    JSON Schema fits the input's. `connect` and the agent are refused with
    the mismatch named.
  - **JSON values,** typed by ports, stored where outputs are stored today.
  - **A live mode of the same run:** one engine, one performer per
    component, one output model. The pure engine orders components upstream
    first. A live change re-runs only the downstream cone of what changed, and
    cancels runs its old input started (Observable's invalidation). An
    explicit run and a live update produce the same receipts.
- **Push and pull** (Rete's dataflow/control-flow split):

  | Component | Runs when | Example |
  |---|---|---|
  | query (read action) | its feed fires (live), at open (once), or on an interval | bb threads where open |
  | transform (a script, or a pure built-in: filter, sort, group, pick, join) | an input changes | not idle, or needs me |
  | view | an input changes (it only renders) | list, detail |
  | instruction (`ext.agent.complete`) | **only on run** (a press, "run it", or the agent) | "summarise these threads" |
  | command (write action) | **only on confirm** | tell thread, merge PR |

- **A loop** stays bounded by `rounds` (at most 8), as in `canvas.run` today.
  A live loop with no instruction in it is refused at connect time, because
  it would run forever.

### 3.5 Commands

```ts
type CommandView = { "sys.f.view": "command"; params: { action: ActionId; input: Json /* may use {from} */ } };
```

A command item shows exactly what it will do: the action, the resolved input,
and the target named in words. It runs through the invoke core.

- **Prerequisite: enforcement.** kb's "Current stance" today is that the
  governance family contributes no guard, so every call runs whatever its
  mode declares [doc, DESIGN.md → Action registry]. Command items stay
  disabled until a guard is restored for **every write action a command item
  can invoke**.
  Once it is:
  - A person's press is allowed.
  - An agent's call asks.
- **A voice "yes" approves one pending action, not "what is on screen".**
  - Showing a command creates a pending approval:
    `{actionId, inputDigest, revision, expiresAt (≈ 20 s), used: false}`.
  - The concierge reads it out. A "yes" transcribed while it is pending, and
    unchanged, resolves exactly that record, once.
  - If the input or the revision changed in the meantime (a live update
    re-resolved it), or the record expired, the "yes" approves nothing and
    the concierge asks again.
  - The receipt records the actor `voice` and the digest.
- Commands never run from a live update.

### 3.6 Anything is an item

The owner will put a lot here; bb threads are one source with one
presentation. **Every kind of content is an existing kb canvas item type, or
an item standing for a node whose view draws it. No content type gets a
storage shape of its own** (Rule 1: "if a feature needs its own storage shape,
the model is wrong").

| Content | Item record | Renderer | Heavy? |
|---|---|---|---|
| Note, sticky, heading | `text`, or an item standing for a node (exists) | exists (kb's text surface) | no |
| A kb node, a kb view (outline, table, graph, chart) | an item standing for the node or the view node | the view exists; drawing a view inside a canvas item is new | sometimes (graph) |
| A bb thread, task, PR, lane, automation | an item standing for a view node bound to `@kb/ext-bb` | new (record views) | no |
| Image | `file` (exists) | exists for eligible kb asset images only [doc, `doc.ts`] | sometimes |
| Video, audio, PDF, markdown | `file` (exists) whose source is a kb asset or a bb file | **new** media and document renderers | yes |
| An HTML file, or an artifact from a thread | `file` (exists) | **new**: an HTML document renderer in an opaque-origin sandboxed frame with no network (isolation, not sanitising); its own contract, phase 3 | yes |
| Generated UI | an item standing for a `code.view` node (exists) | exists: kb's sandbox draws allowlisted element data and **forbids arbitrary HTML** and navigation attributes [doc] | yes |
| A website | `link` (exists) with `embed: true` | **new**: a third-party frame, or a link card (§6.1) | **yes** |
| Shapes, arrows, ink | `shape`, `path`, edges (exist) | exists | no |
| A 3D model (later) | an item with depth (volume) bound to a `.glb` asset | new (room projection; `<model>` in Safari) | yes |

So the record exists for every row. Several renderers do not, and §9 phases
them.

A new kind of content is a new view key, plus at most a presentation for a
record type, contributed by its family. The renderer, presets, wires,
`describe` and undo then work for it unchanged.

## 4. Data sources

| Source | kb family | Reads (queries) | Live feed | Commands | Where it runs, and auth | Phase |
|---|---|---|---|---|---|---|
| **kb** | core | `graph.query` (datalog), `node.get`, the view's subject | the transaction tail (exists) | `node.*`, `ext.canvas.*` | kb's server | MVP (exists) |
| **bb** | `@kb/ext-bb` (new) | threads (list, get, timeline tail, output), projects, environments (git status, diff), hosts, PR status (bb's `github-pr-status` plugin), tasks, automations, lanes (through bb's plugin RPC) | bb's realtime events (`thread:changed`, `environment:changed`, `host:changed`, `project:changed` [doc]) into **an in-memory cache, so a read is a memory lookup** | `thread.tell`, `spawn`, `stop`, `archive`, `task.update` (all asking, once enforcement is restored) | Inside kb's server, against bb's HTTP API and realtime socket, with a token the kb bb plugin provisions (§8) | MVP |
| **GitHub** | `@kb/ext-github` | PRs, checks, reviews, issues | poll every 30–60 s while visible; webhooks later | merge, comment, request review (approval required) | kb's server, with a token through kb's secret pointer | 2 (bb already covers most PR facts) |
| **Files and artifacts** | `@kb/ext-bb` files and kb locations | a file (markdown, image, HTML artifact), thread storage, workspace files on any bb machine (bb's `files.read`), kb assets | poll while visible, or a file watcher where kb runs | none | as above | 2 |
| **Google Calendar** | the routines family (kb routines → Google Calendar design, @thread:thr_iuy8ys3ck8) | occurrences and agenda as kb nodes, so they are datalog | the transaction tail, as that design's sync writes nodes | the routine's own actions | kb ui on shared-server; scope `calendar.app.created` | 3 |
| **HTTP/JSON** | `@kb/ext-http` | GET a URL, select with a JSON Pointer | poll | none (POST would be a write with approval required) | **An allowlist of hosts per source node, empty by default** | 3 |
| **static** | core | a literal on the view node, timestamped | none | none | — | MVP |
| **agent** | the agent family | `ext.agent.complete` as an instruction component | — (pull only) | — | the selected provider | 3 (already in `canvas.run`) |

**Why bb's data comes through kb, not through the frame.**

- A bb source as a kb family works everywhere kb works: in kb ui alone, in
  `kb mcp`, in a saved canvas opened next week, and on the phone.
- Passing bb data into the framed page from the bb plugin would make a canvas
  that renders only inside bb, and would be a second source path beside kb's
  actions.
- The cost is a bb token in kb. It is a pointer to a secret file, like the
  calendar design's.

## 5. Layout presets and item kinds

**Item kinds** (visionOS words, as kb item presets in `presets.ts`, never new
storage shapes):

- **Window:** a flat card. The default.
- **Volume:** an item with depth that bounds a 3D view: a 3D graph in a box,
  or a `<model>` later.
- **Ornament:** an item attached to another item's edge that moves with it:
  the orb dock, a card's toolbar, a command's confirm bar. It is kb's
  membership plus an anchor.

**Layouts** (`ext.canvas.arrange` modes; pure functions over the set they
are given):

| Preset | What it does | Flat | Room | Exists in kb |
|---|---|---|---|---|
| row, column, grid | Lines or a grid | as is | lines and grids on the wall | yes |
| ring | Around a centre | a circle | a circle on the wall | yes |
| stack | Overlapped, newest in front (a deck) | offset cascade | receding in depth | yes |
| layers | Height follows a value | vertical bands | heights | yes |
| align, distribute | Tidy a selection | as is | as is | yes |
| **arc** | Side by side around the viewer, spaced by width (visionOS) | a row | an arc at radius R | new |
| **focus+context** | The conversation's subject in front, the rest receding to both sides | subject large in the centre, others small around it | subject near, others far | new |
| **board** (kanban) | Columns by a field; cards stacked | columns | columns on the wall | new (it reads a field) |
| **timeline** | Along time, in lanes by a field | horizontal axis | an arc as the axis | new |
| **force** | Connected items pull together | kb's force layout | the same, with depth | new (kb has force renderers) |
| **tree** / **radial** | By parent or edges, top-down or around a hub | tree | tree on the wall, hub in front | new |
| **shelf** | Minimised items along the bottom (Stage Manager) | a bottom strip | a low arc | new |

- **A preset arranges once.** It writes positions through `transformItem`, the
  path a person's drag takes, so it is one undo step.
- **A frame may keep a preset live** (`layout` on the group): new members
  arrange themselves, and a member a person moves becomes `pinned` and is
  skipped.
- **The agent never computes coordinates.** It says `place … near/on/in` or
  `arrange … as board by status`. Voice can do the same ("make it a board").
- **On a phone, the default is `column`,** with the conversation's subject
  first. Wires collapse into port labels, and the column order carries the
  flow (see the phone screenshot).

## 6. Renderers

| Projection | How | Status |
|---|---|---|
| **Flat** (default) | kb's DOM canvas. Items standing for view nodes render their view inside the card; edges are kb's bound edges, with port anchors. Elevation shows as kb already shows it | exists, plus view items and port anchors |
| **Room** (spatial) | kb's three.js WebGPU stage draws the room, floor, light, edges (as lines in 3D) and far items (as rasterised textures, kb's LOD path). **Near items are real DOM in a `CSS3DRenderer` layer** that shares the camera, so they stay sharp, accessible and interactive. With HTML-in-Canvas, they become depth-correct textures (`HTMLTexture`) | new projection on the existing stage |
| **XR** (headset) | WebXR immersive-vr. DOM is not composited there [doc], so each catalog component that is shown in XR needs a GPU "face" (uikit: card, list, stat, text); the rest show as their snapshot texture | phase 4 |
| **Phone** | Flat, `column` preset, camera fit, no glass blur, one heavy view at a time, the orb in the bottom call bar | flat plus a preset |

- **The CSS3D layer's limit:** it always draws above the GPU layer, so it
  cannot be occluded. The rule that keeps this honest is that only items
  nearer than the GPU content are DOM, and everything behind them is a
  texture. The kb projection contract (`CANVAS_PROJECTIONS`) gains the
  `room` projection and holds it to the same suite: pick, select, focus, and
  "a move in one projection shows in the other".
- **bb's own components (`ThreadChat`, bb's diff) cannot run inside kb's
  page.** The bb record views show title, status, PR, the latest reply and
  the diff from bb's API. **"Open in bb"** opens the real thread beside the
  canvas. This trades v1's embedded `ThreadChat` for one engine (open
  question 4).

### 6.1 Many heavy items: level of detail, culling, memory

**Each view key declares a cost class and three faces.** A face is a way of
drawing the item, and the renderer picks one per item per frame:

| Face | What it is | When |
|---|---|---|
| **live** | Fully interactive: a frame running, a video playing, a code view executing, a big graph simulating | Focused, selected, or near and large on screen, **within the live budget** |
| **snapshot** | A cached image of the item as last seen; a click makes it live | Visible but not live |
| **glyph** | Icon, title and status dot | Under about 48 px on screen, or in the room's far field |
| **none** | Unmounted; the snapshot is kept in the cache | Off screen |

- **The live budget** (defaults, all settings):

  | Live at once | Desktop | Phone |
  |---|---|---|
  | third-party frames | 4 | 2 |
  | playing videos | 2 | 1 |
  | running code views | 6 | 3 |
  | heavy graphs | 2 | 1 |

  **Counts are what is enforced.** When a slot is needed, the item least
  recently focused is demoted to its snapshot.
  - Media pauses when demoted.
  - A frame is torn down, and only its URL is kept: a cross-origin frame's
    scroll position and form state cannot be read, so they are **lost, and
    the card says so** ("reloads when opened").
  - **Demotion releases only what the renderer owns:** the frame, the media
    element, the sandbox worker drawing a code view, its timers and DOM. A
    contract test checks that a demoted face holds none of them.
  - **Live subscriptions belong to execution, not to faces.** The flow
    scheduler (§3.4) owns every live binding, and keeps it while any active
    consumer needs it:
    - a visible view;
    - a live downstream component;
    - a pending command.

    So hiding or demoting a source card never freezes what it feeds. A
    binding with no consumer pauses; when one returns, it resumes with a
    fresh snapshot.
- **Culling uses a spatial index,** so each frame costs work for what is
  visible, not for everything on the page. kb's `describe` already indexes
  neighbours with a grid of squares; the renderer uses the same grid (or an
  R-tree, `rbush`, MIT) over item boxes and asks it for the viewport.
  - In the room projection, the query is the camera frustum turned into
    plane coordinates: an x range (azimuth, padded for perspective) and a
    y band, widened by elevation, since near items cover more of the
    view.
  - Because the domain never wraps (§3.1), it is a single interval; the
    index answers it, and an exact frustum test then filters the few
    candidates.
- **Memory is advisory.** A page cannot cap a browser's memory or measure a
  cross-origin frame's.
  - The renderer keeps an estimate per face and demotes early when the
    estimate passes about 300 MB on a desktop (120 MB on a phone), or when
    the browser reports memory pressure where it can.
  - The counts above are the guarantee.
  - The snapshot cache holds at most 512 px a side, least-recently-used,
    about 64 MB in memory. Persisted snapshots are kb assets with an owner
    (the item's node) and are **evicted with it, or after 30 days unseen**.
- **Where snapshots come from:**
  - **Our own views:** the view's own snapshot. kb's sandbox already keeps
    a code view's snapshot as of the render. Where HTML-in-Canvas exists,
    the snapshot is `drawElementImage` of the live face.
  - **Third-party sites:** a page cannot paint a cross-origin frame into an
    image; HTML-in-Canvas forbids it by design [doc]. So, in order:
    1. the site's Open Graph image, which is cheap;
    2. a capture by a server-side headless browser on the kb host. It is
       queued, `nice`d, at most one at a time, and cached by URL per day.
       The person can refresh it.
  - **Each snapshot carries its provenance:** source (Open Graph,
    server capture, the live face), time, and "signed out". A server capture
    is not the person's authenticated view of the site, and the card says
    so.
- **Third-party frames:**
  - **Header checks are advisory.** When a website item is created,
    `@kb/ext-http` fetches its headers once. A site that sends
    `X-Frame-Options: DENY|SAMEORIGIN`, or a CSP `frame-ancestors` that does
    not include kb's origin, is recorded as `embeddable: no` and shown as a
    **link card with the snapshot and "Open"**.
  - Redirects, cookies and per-request responses can differ from what the
    server saw, and some browsers fire `load` even for a refused frame. So a
    site recorded as embeddable may still render blank. The card keeps a
    **"Show as card"** switch that the person (or the agent, when told) can
    flip, and the choice is stored.
  - A frame that is allowed gets:
    - `sandbox="allow-scripts allow-same-origin allow-forms allow-popups"`
      (its own origin, not kb's);
    - `referrerpolicy="no-referrer"` and `loading="lazy"`;
    - no `allow` for camera, microphone or geolocation.
  - HTML files run in the HTML document renderer (opaque origin, no
    network), and generated UI runs in kb's sandbox. Neither gets kb's
    origin.

## 7. Speed

### 7.1 Targets

| Moment | Target (from the end of speech) | Why this number |
|---|---|---|
| First visible reaction: the ghost card placed where it will land | **≤ 300 ms after the final transcript; ≤ 0.8 s after the end of speech** | A gap in human turn-taking is about 200 ms [secondary: Stivers et al., PNAS 2009]. 100 ms reads as instant and 1 s keeps flow (Nielsen). The voice replies in that range, so the canvas must not lag behind it |
| A common ask populated (show, detail, connect, arrange, focus, undo) | **≤ 1 s** | The same flow limit, and these asks need no model |
| A canvas ask the grammar misses ("put the reboot one next to opencode and make it big") | **≤ 1.5 s** | One fast model call with structured output |
| An open-ended ask ("what did the reboots thread conclude, and what should I do?") | **Ghost ≤ 0.8 s, then progressive.** The text streams into the placed card | It needs the concierge thread, about 20–30 s today |

### 7.2 Three paths

```
speech ends ─► GPT-Live final transcript ─► concierge plugin server ─┬─ P0 reflex: grammar + handles + recency → kb canvas ops   (no model)
                                                                      ├─ P1 fast: small model, canvas vocabulary only → ops       (~1 s)
                                                                      └─ P2 deep: concierge bb thread (Claude) → fills the ghost  (20–30 s)
voice reply ◄── the voice model's own delegation of the same turn (ask_concierge) is answered by the server from the turn record
```

- **The turn record is how the three paths stay exclusive.**
  - Each final user transcript gets a turn id at the server, when the host
    signal arrives (`host.ts` emits final transcripts [doc]).
  - P0 tries it. On a parse, P0 **claims** the turn (`handled: P0`, with the
    ops and a one-line result).
  - The voice model independently delegates the same utterance through the
    backing Codex agent to `ask_concierge` (concierge README, step 4). That
    call reaches the same server, which matches it to the newest turn
    (within a window, by transcript similarity, since the delegation carries
    the model's paraphrase and no turn id):
    - **claimed by P0:** answer at once with the one-line result, so the
      voice says it and nothing is relayed;
    - **not claimed:** place a ghost now ("Looking into it…"), mark the turn
      `handled: P2`, and relay to the concierge thread as today.
  - A second delegation for a turn already handled is answered from the
    record (duplicate suppression).
  - **Ordering is unverified.** The transcript may arrive after the
    delegation starts. Phase 1 logs both timestamps for every turn.
    - If the delegation can win, the server waits up to 150 ms for the
      transcript before it relays.
    - A transcript that arrives after the relay **inherits P2 ownership** and
      never runs P0.
  - **Matching is a heuristic.** Similarity cannot prove that two texts are
    the same turn. When a delegation matches no recent turn above the
    threshold, or matches two, it is treated as unclaimed and goes to P2.
    The worst case is a slow answer, never a command or canvas op performed
    twice.
- **P0, the reflex.**
  - **Input.** The final user transcript from the turn record.
  - **Routing.** A grammar over the canvas verbs and the scene's handles
    (numbers, letters, "this", "that", "the voice one" by title fuzz)
    produces ops: `place`, `arrange`, `connect`, `camera`, select,
    `remove`, `undo`, and switching between flat and room.
  - **Writing.** The ops go to kb as one `ext.canvas.tx.apply`, over kb ui's
    owner-only Unix socket (the path `kb_call` uses).
  - **Showing.** The page applies them optimistically, and kb's push
    confirms them.
  - **Telling the voice:** through the answer to its own delegation, above.
    No `appendText` is sent, since an appended text item could start
    another response [unverified]; this way there is nothing to suppress.
- **P1, the fast model, used only when P0 has no parse.** Two options, in
  order:
  1. The concierge's **backing Codex thread** gets the canvas ops as
     `dynamicTools`, answered by the host like `ask_concierge` today. The
     voice model already delegates to it. This needs no new key; its latency
     is [unverified], to be measured first.
  2. A direct call from the plugin server to a small fast model, with
     structured output constrained to the ops schema and the screen state
     (handles) as context. It is used only if option 1 exceeds 1.5 s.
- **P2, the deep path.** Asked as today, through `ask_concierge` to the
  concierge thread. The server placed the ghost when it relayed the turn.
  The thread fills it through `kb_call` (`node.update` of the view node's
  static binding or a markdown setting), and streamed edits show as they
  land.

### 7.3 What makes it fast

- **The model emits ops, never values or HTML,** for every common ask: a
  view key, a binding and a relation. Data comes from the cache, so an op is
  a few hundred bytes.
- **The cache is live, in memory, and kept current by events.** `@kb/ext-bb`
  holds threads, projects, environments and hosts in memory, updated from
  bb's realtime events.
  - On shared-server, a cold `bb thread list --json` (77 threads) takes
    **234 ms** and a `bb thread get` **277 ms**, of which spawning the
    process is about 46 ms [measured].
  - A cache answers both from memory, in well under a millisecond
    [estimate]. The prototype's figure of under 0.1 ms comes from a static
    7-row array, so it does not show that.
- **Optimistic placement.** The ghost renders before kb confirms the write,
  and a refusal rolls it back with a toast. Undo is one step.
- **Prefetch and speculation.**
  - When a list is shown, the next likely views resolve in the background:
    the detail sources of its top rows, and the record views' code chunks.
  - At canvas open, the catalog's view chunks for the common components load
    before the first ask.
- **Streaming.** P1 and P2 ops are applied one by one as their tool calls
  finish (as tldraw's agent applies an action once it has streamed).
- **The generated-UI path is explicitly slow.** A `code.view` placeholder
  shows at once. The model's code streams into the sandbox (QuickJS or a
  Worker, kb's engines), and the view swaps in when it first draws. Its
  budget is seconds, and it is never on the common path.

### 7.4 The budget, step by step

| Step | Expected | How measured |
|---|---|---|
| End of speech → final transcript at the plugin server | 200–600 ms [estimate; it depends on GPT-Live's turn detection] | Phase 1: timestamp the host signal against the audio level dropping to silence in the page |
| Grammar routing (parse plus resolving handles) | **0–0.8 ms** (median 0, p95 0.8) [measured: local prototype callback timing] | `performance.now` around the router, n = 20 per ask |
| Ops → kb commit → push to the page | 10–40 ms [estimate: a local socket and one canvas transaction] | Phase 1: kb's action receipt timing plus the `/ws` push timestamp |
| Ops applied → ghost frame callback (optimistic) | **33–54 ms median, p95 66.2 ms** in the room projection; 33 ms flat [measured: local prototype callback timing] | The second `requestAnimationFrame` callback after applying ops, in a real-time headless Chrome 154 (software rendering). This is a frame callback, not proof that pixels were presented. The helper also falls back to a 100 ms timer, which these values did not reach |
| Data lookup | **< 0.1 ms** [measured over the prototype's 7-row static array; not representative of a real cache] | `performance.now` around the resolve |
| Populated frame callback, **cumulative** (includes the ghost row) | **66–101 ms median, p95 125.3 ms** [measured: local prototype callback timing] | As above; from the same synthetic start |
| **P0 total, end of speech → populated** | **≈ 0.3–0.8 s** [estimate; **unvalidated**] | Phase 1 end to end, two ways. (1) A screen recording with the microphone track, on the owner's laptop and phone: from the end of the speech waveform to the first video frame where the card appears, read frame by frame. (2) In a scripted headless run, a Chrome performance trace (`devtools.timeline`), from the router's `performance.mark` to the next `DrawFrame` that commits the change |
| P1 (backing Codex dynamic tool or small model) | 0.6–1.5 s [estimate] | Phase 2: timed per call, logged with the receipt |
| P2 (concierge thread) | 20–30 s today [owner-observed]; first content streams earlier | Already logged by the concierge's call log |

The prototype's `?measure=1&n=20` runs the four common asks 20 times from an
empty scene. The clock starts at a synthetic call standing for the final
transcript, so there is no transcription, host signal, socket, kb transaction,
subscription or real view in these numbers. It reports the median and p95 for
each stage (cumulative from that start):

| Ask | Ghost (spatial) | Full (spatial) | Full (flat) |
|---|---|---|---|
| show my open threads | 33.2 / 40.4 | 66.5 / 70.5 | 66.6 / 67.1 |
| detail number 2 | 54 / 66.2 | 101 / 125.3 | 66.5 / 67.5 |
| connect 2 and 3 | — | 46.6 / 57 | 33.1 / 34 |
| arrange as focus | — | 45.5 / 58.7 | 33.1 / 33.8 |

Each cell is median / p95 in ms. These are local callback timings on a
server with software rendering. In that synthetic setting, the client-side
work took two to six frames. **They say nothing about a phone, about the
real kb canvas** (which renders more per card), **or about presentation**.
Phase 1 measures all of it end to end.

### 7.5 Keeping live data cheap

- **Today:** kb's page re-asks **every watched query whenever the replica's
  generation moves**, that is, on any write anywhere [doc,
  `packages/kit/ui-sdk/src/lib/replica-queries.ts` on `main`]. A canvas with
  50 live cards would re-run 50 datalog queries for each keystroke an agent
  commits elsewhere in the graph. The server's `rows` subscriptions need the
  same check.
- **Plan, in TypeScript, as a kb core change with a contract property:**
  1. **Each query derives a conservative read set** from kb's query IR
     (`@kb/query` `ir.ts`).
     - The read set is the **attributes** its patterns read, optionally
       narrowed to an attribute and constant **value** pair. For example,
       `[?n :node/id "x"]` depends on any datom of `:node/id` with value
       `"x"`, whether asserted or retracted.
     - The read set never narrows to "the entities the last answer found".
       An insert, a delete, or a change that moves an entity into or out of
       a join must still invalidate.
     - Rules, `reach`, `children` and pull widen it to their attributes. A
       clause the IR passes through as `raw` makes it *everything*.
  2. **Each transaction carries its write set:** the attribute (and value)
     of every datom it asserted **or retracted**, from the transaction tail.
  3. **A watched query is asked again only when the two intersect.**
     Otherwise its answer moves to the new generation unchanged. These still
     cause a full re-ask, as now:
     - a temporal expiry (`holdsUntilMs`);
     - a change to a saved query a view references;
     - a replica reset;
     - a gap in the tail's history.
  4. **The property, in the shared suite, is differential.** For random
     transaction sequences, the filtered strategy's answers equal
     unconditional re-computation at every generation, over the page's
     replica and the server's hub alike.
  - **Watched queries are already deduplicated** by EDN and generation, so
    identical cards share one query. The cost the filter removes is
    *distinct* queries re-run by writes that cannot affect them.
  5. **Non-kb sources:** bb's events name an entity kind and id, so the bb
     cache invalidates the bindings whose input names that id, or whose list
     covers that kind. Ids alone do not guarantee freshness: on **reconnect**
     the adapter takes a fresh snapshot and re-resolves everything it serves,
     and the adapter suite checks that (§3.3).
  6. **Coalescing:** re-runs are batched per animation frame, and an answer
     is pushed only if it changed (as now).
- **Measure before going further.** A phase 1 benchmark runs 50 and 200 live
  cards under a write storm (an agent editing 10 nodes a second) and records
  re-runs and milliseconds, before and after.
  - True incremental view maintenance (differential, for the hot query
    shapes, still in TypeScript) comes only if that benchmark shows
    dependency filtering is not enough.
  - **No Rust or WASM in this plan** unless a profile shows a compute hotspot
    that marshalling does not dominate. Chatty, row-returning calls across
    the WASM↔JS boundary would spend the gain on serialisation.

## 8. Where the code lives

| Piece | Home | Notes |
|---|---|---|
| The scene model, presets (arc, focus, board, timeline, tree, radial, shelf), the room mapping and its contract, the component execution contract (typed ports, the live mode of `canvas.run`) | kb `@kb/canvas` (pure, `scope:shared`) | Extends `arrange.ts`, `flow.ts`, `camera.ts` |
| Flat and room projections, port anchors, the `CSS3DRenderer` layer | kb `@kb/canvas-ui` | Joins `CANVAS_PROJECTIONS` and its contract suite |
| View items, generic record views (a view key may name the component it is) | kb `@kb/views` and families | The catalog stays one |
| Live reads (a `feed` on read actions, the subscription hub generalised from `rows`) | kb core | **The only core change.** It is mechanism, which belongs in core |
| bb source (an in-memory cache fed by bb's realtime events, read actions, commands, record views) | kb `@kb/ext-bb` plus `@kb/bb` (shared) | A family like `code` or `canvas`; off when no bb is configured |
| GitHub and HTTP sources | kb `@kb/ext-github`, `@kb/ext-http` | Later phases |
| The concierge's canvas mode: an App panel tab on its page that frames kb's canvas page, a full-screen toggle, the orb as an ornament, and the session report so `kb_call` acts in that frame | dotfiles `assets/bb-plugins/voice-concierge` | Reuses the kb plugin's frame code, moved into a shared sibling folder (as `linked-items/` is shared today) |
| The reflex router (P0) and the fast path (P1) | dotfiles voice-concierge server | It owns the transcript stream; it writes to kb like `kb_call` |
| bb credentials for kb (URL and token) | dotfiles kb plugin: writes a secret file that kb points to | The calendar design's secret-pointer pattern |
| Agent tools | **none new.** The concierge thread gets the kb plugin's `kb_call`/`kb_screen`/`kb_manifest` selected | The canvas verbs are kb actions |

**Where I differ from the coordinator's sketch** (all of it otherwise
holds):

- **The bb source is a kb family, not data the bb plugin feeds through the
  frame.** A canvas should keep working outside bb.
- **The voice fast path stays in bb.** It needs the transcript stream, which
  only the concierge has. It talks to kb as one more caller.
- **The scene needs one new 3D projection (`room`), with its own contract,
  not a new geometry.** The flat canvas is then untouched.
- **Ports belong to components, not to views.** One execution contract
  serves `canvas.run` and the live mode, including headless components.

## 9. Phased plan

| Phase | Scope | Exit criterion | Size [estimate] |
|---|---|---|---|
| **0** | This doc and the prototype | The owner picks defaults | done |
| **1 · Voice canvas, flat** | kb: the component execution contract (typed JSON ports, a live mode of `canvas.run`); live reads with **dependency-aware invalidation** (§7.5) and its benchmark; LOD faces and viewport culling (§6.1); `@kb/ext-bb` (threads, thread, PR status, the cache); view items; record views (list, card, detail, stat); port declarations and the live scheduler for query, transform and view; presets arc, focus, board, column, stack. bb: the concierge's canvas mode (frame, full screen, orb ornament); the turn record, P0 router with handles and recency, and delegation matching; ghosts; timestamps for transcript arrival and delegation order; the session report; `kb_call` tools for the concierge thread | "Show my open threads", "detail number 2", "connect 2 and 3", "make it a board" and "undo" each land **≤ 1 s after the end of speech**, measured end to end on the owner's machine. A thread's status change updates its card with no turn. Saved as a canvas page | kb 6–8 days, bb 3 days |
| **2 · Room and commands** | kb's approval enforcement restored (the prerequisite for commands); the room projection with its contract and a CSS3D layer; websites (headers check, frames, snapshots) and media items; command items with spoken confirmation; P1 (backing Codex dynamic tools, measured); GitHub and files sources; presets timeline, tree, radial, shelf, force; prefetch; phone polish | Same asks in room mode within budget; "tell number three to stop" runs only after "yes" | 6–8 days |
| **3 · Generated and wider** | `code.view` items streamed into the canvas; instructions on demand in live flows; HTTP and calendar (through routines) sources; HTML-in-Canvas where available | A generated chart bound to live bb data, which a person can promote into the catalog | open |
| **4 · XR** | WebXR immersive-vr; uikit faces for card, list and stat; gaze and pinch as deixis | The same scene opens in a headset | open |

## 10. Prototype

`prototype-v2/canvas.html` (throwaway, static data) is in the design thread's
storage, with screenshots:

- `flat.png`
- `spatial-arc.png`
- `spatial-focus.png`
- `spatial-kanban.png`
- `phone-flat.png`
- `measurements.json`

It shows:

- one scene in both projections, where switching moves nothing;
- presets arc, focus, grid, stack and board, plus column on a phone;
- typed ports and wires (`bb.threads` query → filter → list → detail →
  command);
- the reflex router and its latency readout.

## 11. Open questions, each with my default

1. **The engine in kb, not a bb plugin?** *Default:* yes, as in §8, with the
   voice fast path and the frame in bb.
2. **How are scenes kept?** *Default:* one pinned `Concierge` canvas with a
   page per call, **kept until deleted**. There is no automatic pruning until
   node ownership, backlinks and shared-view cleanup are defined for pages.
   A manual "clear old sessions" removes only pages with no backlinks.
   "Save this" moves a page to its own canvas.
3. **Is every placed component a node?** *Default:* yes, a view node that is
   a child of the page's canvas node, removed with the page. Writing is
   cheap: one transaction for the node and its layout entry.
4. **bb's own `ThreadChat` inside the canvas?** *Default:* no. kb's record
   views show bb data, and "open in bb" shows the real thread beside the
   canvas. Revisit if the views feel thin.
5. **The default projection on a desktop?** *Default:* flat. Room is a
   toggle that each canvas remembers.
6. **Does a voice "yes" approve a command?** *Default:* yes, but only one
   pending approval: matched by action, input digest and revision, valid for
   about 20 s, used once, and recorded as actor `voice` (§3.5). This needs
   kb's approval enforcement restored first; until then, command items stay
   disabled.
7. **How do we implement P1?** *Default:* the backing Codex thread's dynamic
   tools first; a direct small-model call only if that is above 1.5 s.
8. **Model steps in live flows?** *Default:* never automatic; run on press,
   "run it", or by the agent. Queries and transforms are live.
9. **Calendar data?** *Default:* only through the routines family's nodes, so
   kb needs no extra Google scope.
10. **HTTP source hosts?** *Default:* none allowed until a source node names
    a host and a person approves it.
11. **A tldraw licence?** *Default:* no. Borrow its ideas; kb already
    covers what the owner used tldraw for.
12. **The live budget** (frames, videos, code views, memory)? *Default:*
    on a desktop, 4 frames, 2 videos, 6 code views and about 300 MB of live
    faces; half that on a phone. All are settings.
13. **Snapshots of third-party sites?** *Default:* the Open Graph image
    first; a server-side headless capture (queued, `nice`d, cached per day)
    only for sites with no image or when the person asks.
14. **Where does bb's token for kb live?** *Default:* a secret file written
    by the kb bb plugin, pointed to from kb's config, never committed.

## Sources

- kb (popemkt/kb `main`, `1740c95b`): `DESIGN.md` (sections Canvas
  documents → Run, View nodes, Code views, Action registry, Query layer,
  Sandbox, Screen state); `docs/research/2026-10-28-canvas-tldraw-parity.md`;
  `docs/brainstorms/2026-09-29-kb-genui-canvas-agents/`;
  `packages/extension/canvas/src/{arrange,place,presets,doc,view}.ts`;
  `AGENTS.md` (Rule 1, One contract).
- tldraw: https://tldraw.dev/community/license ; https://tldraw.dev/pricing ;
  https://tldraw.dev/blog/tldraw-sdk-5-0 ; https://tldraw.dev/starter-kits/overview ;
  computer: https://the-decoder.com/tldraw-unveils-experimental-natural-language-computer-powered-by-gemini-2-0/
- three.js CSS3DRenderer: https://threejs.org/docs/#examples/en/renderers/CSS3DRenderer ;
  drei Html: https://drei.docs.pmnd.rs/misc/html ; uikit: https://github.com/pmndrs/uikit
- WebXR on visionOS: https://webkit.org/blog/15162/introducing-natural-input-for-webxr-in-apple-vision-pro/ ;
  Safari 27: https://webkit.org/blog/18325/webkit-features-for-safari-27-0/ ;
  Android XR: https://developer.android.com/develop/xr/web
- React Flow: https://reactflow.dev/pro ; Rete: https://retejs.org ;
  Observable Notebook Kit: https://github.com/observablehq/notebook-kit ;
  TC39 Signals: https://github.com/tc39/proposal-signals ; folkjs: https://github.com/folk-js/folkjs
- Turn-taking: T. Stivers et al., "Universals and cultural variation in turn-taking in conversation", PNAS 106 (2009).
- Response-time limits: J. Nielsen, "Response Times: The 3 Important Limits" (NN/g).
- The concierge: `assets/bb-plugins/voice-concierge/README.md`; `docs/research/2026-11-01-bb-voice-concierge.md`.
- Routines and Google Calendar design: @thread:thr_iuy8ys3ck8.
