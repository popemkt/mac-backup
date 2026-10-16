# Canvas parity with tldraw offline

Plan of 2026-10-17. Nothing here is built. It builds on
[DESIGN.md → Canvas documents](../../../tools/kb/DESIGN.md#canvas-documents) and
→ Agent verbs, [DESIGN-UI.md → Canvas](../../../tools/kb/DESIGN-UI.md#canvas-i3),
the [3D workspace plan](../2026-10-02-kb-3d-workspace/README.md) and the
[genui roadmap](../2026-09-29-kb-genui-canvas-agents/README.md) step 7. It
restates none of them. It ranks first in the
[index](../2026-10-17-kb-overnight-plans.md). **Implementation starts after
O3–O5 land.** The step table marks which steps depend on the outline and graph
family cut.

## What the owner asked

> "make canvas feature parity with tldraw offline"

## What tldraw offline is, and how the owner uses it

- **What it is.** A local desktop whiteboard with no account and no server.
  Its native file is `.tldraw`, which holds the canvas, its pages, stored
  media and an embedded document script. Legacy `.tldr` opens as an import
  (https://github.com/tldraw/tldraw-offline). It is not open source.
- **Its scripting.** Per its blog:
  - "Execs" are one-off JavaScript;
  - "scripts" are saved in the file and "load whenever the file loads,
    allowing each tldraw file to operate as a little app of its own"
    (https://tldraw.dev/blog/tldraw-offline).
- **Its local API**, as the installed `tldraw-offline` skill
  (`~/.claude/skills/tldraw-offline/SKILL.md`) uses it:
  - a token-guarded HTTP server: `POST /api/search` with an `api` object,
    `POST /api/doc/:id/exec` with a live `editor` and `helpers`, and
    `script-workspace` for durable `script/main.js` and `config.js`;
  - helpers: `createArrowBetweenShapes`, `boxShapes`, `mermaid`, `getLints`
    (each exec answers `lints: {new, resolved}`), `getScreenshot`,
    `getComments`;
  - stable ids, and `meta` on shapes.
- **The owner's conventions** (`~/.claude/skills/tldraw-conventions`) are what
  parity has to serve:
  - every board carries **Agents** and **Audit log** pages;
  - colour goes by concept family, with a visual legend;
  - lines stay black unless the colour or dash carries meaning, for example
    "grey dashed = reference vs solid = ownership";
  - no decoration;
  - the **drill-down** pattern: an overview page, item pages named
    `Overview / Item`, and locked badge controls carrying
    `meta.drill = {to, focus?}`, handled by one board script. Its checks are
    "no dead badges", "a back badge for each page that drills in" and
    "every page reachable from the root".

## What tldraw's editor offers

Sources: https://tldraw.dev/sdk-features/default-shapes, `TLGeoShape.ts`
(https://raw.githubusercontent.com/tldraw/tldraw/main/packages/tlschema/src/shapes/TLGeoShape.ts),
https://tldraw.dev/sdk-features/styles, /pages, /groups, /shape-transforms,
/snapping, /bindings, /clipboard, /image-export, /history, /locked-shapes,
/store, and the tools and actions in `useTools.tsx` and `actions.tsx` in the
tldraw repository.

- **Shapes.**
  - `geo`, in 20 variants: rectangle, ellipse, triangle, diamond, pentagon,
    hexagon, octagon, star, rhombus, oval, trapezoid, cloud, arrows, x-box,
    check-box, heart and others.
  - `text`, `note`, `frame` (named, clips its children), `group`.
  - `draw`, `highlight`, `line` (points, spline).
  - `arrow` (`arc` or `elbow`, `bend`, label, nine arrowhead kinds).
  - `image`, `video`, `bookmark`, `embed`.
- **Styles.**
  - colour: 13 names, themable;
  - fill: none, semi, solid, pattern, fill, lined-fill;
  - dash: draw, solid, dashed, dotted, none;
  - size: s, m, l and xl;
  - font: draw, sans, serif, mono;
  - horizontal and vertical alignment.
- **Bindings.** An arrow binding record holds `terminal`, `normalizedAnchor`,
  `isPrecise` and `isExact`. A `BindingUtil` makes the arrow follow the shapes
  it binds.
- **Editing.**
  - pages: create, rename, duplicate, reorder, and move shapes to a page;
  - grouping;
  - align (seven ways), distribute, stack, pack, flip, rotate, and z-order
    with `[` and `]`;
  - object snapping (Ctrl held) and grid mode;
  - locking: `isLocked`, which selection, update and delete skip;
  - undo with history marks.
- **Tools.** select, hand, eraser, draw, highlight, text, note, frame,
  arrow, line, laser, geo.
- **Shortcuts.** ⌥A/H/D/W/S/V align, ⌥⇧H/V distribute, ⇧H/⇧V flip,
  ⇧L lock, ⌘⌥G frame the selection, ⇧1/⇧2/⇧0 zoom, ⌥←/→ change page.
- **Clipboard.** It carries shapes, bindings and assets across editors, with
  ids remapped.
- **Export.** `toImage` to png, jpeg, webp or svg, and `getSvgString`.
- **Licence.** The SDK is not open source. Production use needs a licence
  key, and a hobby key shows a watermark (https://tldraw.dev/sdk-features/license-key).

## What kb's canvas has today

`@kb/canvas`, `@kb/canvas-ui` and `@kb/ext-canvas`:

- **The document.**
  - A JSON Canvas 1.0 document (https://jsoncanvas.org/spec/1.0/) in
    `sys.f.canvas` on a `#canvas` node.
  - One write path, `ext.canvas.tx.apply`.
  - Unknown fields round-trip.
  - Typed extension fields: `nodeId`, `shape`, `z`, `depth`, `rotation`,
    `parent`, `billboard`, `file`, `kbLink`, `camera`.
- **Items.**
  - `text`, which also serves as the sticky;
  - `kb-node` cards that render live from the store;
  - `shape` (rect, ellipse, diamond, sphere, cone, plus the solid presets);
  - `file` pictures through `asset.upload`;
  - `group`, drawn as a frame.
- **Not drawn:** JSON Canvas `link` items. They round-trip unknown.
- **Interaction.**
  - a selection set, marquee, ⌘A, ⌘C as a canvas document, and pasting
    images;
  - undo: a ring of 30, which takes in the store's own edits;
  - a 4 px pointer slop;
  - snapping: magnetic 5 px alignment, surface, angle and grid, suspended
    with ⌘;
  - sticky tools;
  - Blender-style modal G/S/E/R with axes and typed values;
  - frames: membership, ⌘G and ⌘⇧G, entered by double-click, viewpoints,
    and present mode;
  - bring-to-front and send-to-back buttons;
  - Space to pan;
  - the item inspector;
  - 2D and 3D projections of one document, which tldraw does not have.
- **Edges are drawings** (INSPIRATIONS, after Logseq whiteboards).
  - They bind items by id and side, so they follow the items.
  - Each has a label, an arrowhead per end (none or arrow) and colours 1–6.
  - `connect` with `bind` sets a ref prop once.
- **Agent verbs.**
  - `ext.canvas.describe`, `place`, `arrange` (row, column, grid, ring, stack,
    layers), `connect`, `group`, `ungroup`, `promote` and `lint`;
  - every write answers `lints: {new, resolved}`, tldraw offline's own shape;
  - `ui.capture` for a screenshot.

Missing, by reading the code (none of these words occur in canvas sources):
lock, distribute, flip, eraser, laser, freehand, comments, image export. A
canvas's cards are **not references** either. `nodeMentions` (`@kb/query`
`index/datoms.ts`) reads only `[[id]]` tokens in string values, and an item's
`nodeId` is a JSON field inside the `sys.f.canvas` string. So backlinks never
show which canvases a node is on. One quirk: a `[[id]]` typed inside a text
item does count, because the whole document is one string value.

## Parity matrix

Cost: S is under a day, M a few days, L a week or more. "Copy?" says whether
parity is recommended at all.

| Feature | tldraw | kb today | Gap | Cost | Copy? |
|---|---|---|---|---|---|
| Dash style (items and edges) | draw, solid, dashed, dotted | none (the edge ghost is dashed) | `dash` field | S | yes: the owner's "dashed = reference" |
| Fill | six fills | one fill per colour | `fill`: none, semi, solid (pattern later) | S | yes |
| Colour | 13 names, themed | JSON Canvas 1–6 and hex | named palette onto kb tokens; label colour | S | yes, through tokens |
| Size | s, m, l, xl | fixed | `size` drives text and stroke | S | yes |
| Font | draw, sans, serif, mono | the theme's font | `font`: sans, serif, mono | S | no "draw" font |
| Text alignment | h and v align | partial | `align`, `valign` | S | yes |
| Geo variants | 20 | rect, ellipse, diamond (+3D solids) | triangle, hexagon, star, cloud, arrows, check-box | S per batch | yes, each with a 3D fill |
| Note | `note`, grows to fit | text item | grow to fit the text | S | yes |
| Frame | named, clips | group as frame, membership, viewpoints, present | clipping, ⌘⌥G | S | yes |
| Invisible group | `group` | groups are frames (decision 12) | — | — | no: one concept |
| Bound arrow anchor | `normalizedAnchor`, precise or imprecise | the nearest of four sides | anchor anywhere on the outline | M | yes |
| Arrow route | arc `bend`, elbow | straight or bezier between sides | `route`: straight, arc, elbow; `bend` | M | yes |
| Arrowheads | nine kinds | none or arrow | `fromHead`/`toHead` kinds | S | yes |
| Unbound arrow and line | free ends, points, spline | none: an edge needs two items | `path` item with points | M | yes |
| Freehand draw and highlight | `draw`, `highlight` | cut on purpose (simplicity rule) | `path` item, `freehand: true` | M | owner question 4 |
| Image | crop, flip | assets, at their aspect | crop, flip | S | later |
| Video | `video` | none | asset type and face | M | later |
| Bookmark | URL card | `link` round-trips, not drawn | draw `link` as a URL card, no unfurl fetch | S | yes |
| Embed | iframe | none | — | — | no (sandbox; DESIGN.md → Sandbox) |
| Multiple pages | page records, ⌥←/→ | one canvas per node; frames as viewpoints | pages as child canvas nodes and a page strip | M | yes, as nodes |
| Drill-down navigation | board script over `meta.drill` | a `kb-node` card already opens its node | cards of child canvases; back badges from references | S once pages and references exist | yes, natively |
| Locking | `isLocked`, ⇧L | none | `locked` field; selection, transforms and verbs skip it | S | yes |
| Align and distribute | seven aligns, distribute, stack, pack | `arrange` verb; no UI | `align`/`distribute` in `arrange.ts`; keys and toolbar | S–M | yes |
| Flip | ⇧H, ⇧V | none | flip in `transform.ts` | S | yes |
| Z-order keys | `[`, `]`, ⌥ for one step | buttons only | keys, one step | S | yes |
| Snapping | Ctrl to snap, grid mode | always magnetic, ⌘ to suspend; grid, surface, angle | — | — | no: kb's is richer |
| Hand tool | H | Space-drag | H as a tool | S | yes |
| Eraser | E | Delete | — | — | no: Delete does it |
| Laser | K | none | ephemeral pointer trail; pairs with present mode | S | later |
| Undo | marks, deep | ring of 30, takes in store edits | a deeper ring | S | yes |
| Copy and paste | `TLContent` across editors | canvas document JSON, images | text and SVG paste to items; remap ids | S | yes |
| Copy as PNG, export SVG/PNG | `toImage`, `getSvgString` | `ui.capture` (an open tab, a file path) | `ext.canvas.export`, with an SVG painter in the server entry | M | yes |
| `.tldr` import | native | none | records to items, bindings to edges | M | yes, import only |
| Comments | threads anchored to a shape, point, region or page | none | comment nodes anchored by canvas and item id | M | yes, as nodes |
| Diagram from structure | `helpers.mermaid` | none | `ext.canvas.diagram {query \| mermaid}` | M | yes |
| Lints | `getLints`, `new`/`resolved` | the same shape | `text-crosses-container` | S | yes |
| Screenshot | `getScreenshot` | `ui.capture` | an image block, not only a path (existing gap) | S | yes |
| JS exec against the live editor | `/exec` | none | — | — | no (below) |
| Board scripts, custom shapes | `main.js`, `config.js` | none | — | — | no (below) |
| 3D | none | both projections | — | — | kb ahead |

## What kb should deliberately not copy

The rule in INSPIRATIONS is "Simplicity beats fidelity". Where parity
conflicts with it, simplicity wins unless the owner overrides.

- **JS exec against a live editor, and board scripts.** kb's write path is
  actions, decided by the invoke core with approval policies. Arbitrary code
  against the editor would be a second write path that bypasses approval, and
  "code stored as data" is a stance kb refused (the Cordis survey,
  non-adoptions). Most of the owner's script use, which is drill navigation,
  needs no script in kb, because a card already opens its node. Behaviour
  that does need code belongs in a sandboxed code view
  ([DESIGN.md → Sandbox](../../../tools/kb/DESIGN.md#sandbox)), not inside
  the canvas.
- **Custom shapes from `config.js`.** A new kind of item is a typed field or
  type in `@kb/canvas`, so every surface, every lint and both projections
  know it.
- **A separate invisible group.** Decision 12 made groups and frames one
  concept.
- **The hand-drawn look** (the `draw` dash, the `draw` font). kb's look comes
  from design tokens (DESIGN-UI.md → Design systems).
- **Embeds.** An iframe of an outside page is an unsandboxed network surface.
- **Eraser.** Delete covers it.
- **Freehand drawing.** It was cut for the simplicity rule. Owner question 4,
  recommended: keep it cut, and add the `path` item for lines and unbound
  arrows only.
- **Agents and Audit log pages as canvas pages.** In kb a ledger is data: one
  `#agent-session` node per session (date, agent, session, a one-line what),
  with a ref to the canvas, shown in the canvas node's References. It is the
  same fact, and it is queryable.
- **tldraw's SDK inside kb.** It would bring a second store model beside
  nodes, and a licence key for production use.

## Data-model consequences

**JSON Canvas extension fields cover styles and geometry, with no 7b.** Each
new field is typed in `doc.ts`, as `z`, `depth` and `rotation` are: absent
means the default, the default is written as absent, and a value kb cannot
read round-trips until kb writes that field.

- On items: `style: {fill?, dash?, size?, font?, align?, valign?, opacity?}`
  and `locked?`.
- On edges: `dash?`, `route?`, `bend?`, `fromAnchor?`/`toAnchor?` (`{x, y}`
  normalised, with JSON Canvas `fromSide`/`toSide` kept as their coarse
  form), `fromHead?`/`toHead?`.
- New item types: `path` (`points`, `closed?`), and drawn `link` items.

Other JSON Canvas readers ignore the extension fields, so an exported document
stays valid JSON Canvas.

**Pages are nodes: a board's children.** A board is a `#canvas` node, and its
pages are child `#canvas` nodes, each with its own document:

- the page list is the children's order (sibling ranks);
- a page's name is its node text, and the breadcrumb is the outline path,
  which is exactly the drill-down pattern's `Overview / Item` naming;
- a drill badge is a `kb-node` card showing a child canvas, and opening it is
  the existing gesture;
- moving items between pages is cut on one and paste on the other.

That needs no format change. It is "everything is a node", and the outline
lists a board's pages for free.

I am not recommending pages inside one document, the way tldraw keeps page
records in one store. That would make a page an unaddressable sub-thing of
one prop.

**Pages as view nodes is the 7a/7b question.** Roadmap step 7 makes a canvas
a view type, and `GAP [[01M3S5DD5W4B3BSZMA6DE8ZVP8]]` moves the camera onto
that view's settings. Under 7b, items are nodes, and a page is a view node:
a layout keyed by node id over a set of nodes. A board's pages would then be
its host's views. The pane switcher already lists a host's views.

**Canvas references.** Back badges, the "every page reachable" check and
"which canvases show this node" all need a canvas's `nodeId`s to be
references. There are two ways (owner question 1):

- **(a) A core reference-carrier seam.** Families declare how a prop's value
  carries references, and the datom build emits `:node/mentions` from them.
  The canvas family declares `sys.f.canvas` (item `nodeId`s and `kbLink`s).
  The build stays the one place, and core names no feature. This is the
  roadmap's "mentions are derived at load" without 7b.
- **(b) 7b.** Items become nodes, and their references are ordinary ref
  props.

Recommended: (a) now. Parity needs references, not items as nodes. It lands
next to the
[family-contributions plan](../2026-10-17-kb-family-contributions/README.md)'s
derived `:node/owner`, the same posture of a datom derived at build.

**Revisiting 7b.** Parity raises its value: an item outliner, the node
inspector instead of the item inspector, styles as fields, comments on items.
None of the steps below needs it. Comments anchor by `{canvas node, item id}`
in a comment node's props, because item ids are stable within a document.

My recommendation, not a decision: keep deferring 7b, and decide it when the
first feature arrives that needs an item to carry fields of its own.
Comments do not; per-item tags would.

## The agent and scripting surface

| Need | tldraw offline | kb |
|---|---|---|
| Read the board | `api.getShapes`, `getBindings` | `ext.canvas.describe`: relations at three levels of detail, the focus, lints, the camera |
| Change the board | JS against `editor` | relational verbs and `tx.apply`, through the invoke core, with approval policies |
| Connect | `createArrowBetweenShapes` | `ext.canvas.connect`, with `bind` to set a ref prop |
| Box a set | `boxShapes` | `ext.canvas.group` |
| Lay out | `alignShapes`, `stackShapes`, `distributeShapes` | `ext.canvas.arrange`; align and distribute added here |
| A diagram from structure | `helpers.mermaid` | **new:** `ext.canvas.diagram {query \| mermaid}`. A datalog query or a graph perspective gives nodes and relations; these become cards and bound edges (`kbLink`) laid out by `arrange`. Mermaid is a second parser into the same shape |
| Lints | `getLints`, `new`/`resolved` | the same shape; `text-crosses-container` added |
| See it | `getScreenshot` (path) | `ui.capture` (path, open tab); export added |
| Comments | `getComments`, reply, resolve | **new:** `#comment` nodes, with `comment.canvas` (ref) and `comment.item` (text) |
| Durable behaviour | `script/main.js`, `config.js` | not adopted: native navigation, or a sandboxed code view |
| Trust | a digest checked against `script/` and pre-trusted | the sandbox's digest trust (`.kb/trust.json`) for code views |

## Steps

Each step is one commit. Restructure steps leave behaviour unchanged. The
"O3/O4" column says whether a step waits for the outline or graph family cut
itself, beyond the start condition that O3–O5 have landed.

| Step | What | Kind | Size | O3/O4 |
|---|---|---|---|---|
| P0 | This plan; queue nodes | docs | S | no |
| P1 | One `styleOf(item)` reader in `@kb/canvas`, collecting today's colour reads (`canvas-color.ts`, shape colour). Behaviour unchanged | restructure | S | no |
| P2 | `dash`, `fill`, `size`, `font`, `align`, `opacity`, named palette through tokens; inspector rows; 3D faces honour them | add | M | no |
| P3 | Edge anchors anywhere on the outline, `route` arc and elbow, `bend`, arrowhead kinds, edge `dash`; `connect` takes them | add | M | no |
| P4 | The `path` item: line and unbound arrow tools; both projections | add | M | no |
| P5 | `locked`; align, distribute and flip in `arrange.ts` and `transform.ts`; z-order keys; H as the hand tool; the shortcut table | add | M | no |
| P6 | The core reference-carrier seam (restructure: `:node/mentions` reads carriers through one table; text tokens and ref props become its first two entries, behaviour unchanged) | restructure | M | no; it touches `@kb/query` beside plan C3 |
| P7 | The canvas family declares `sys.f.canvas` as a carrier: cards and `kbLink`s become references | add | S | no |
| P8 | Pages: a board's child canvases; a page strip in `canvas-ui`; ⌥←/→; "new page"; drill cards; back badges from References; a lint for dead or unreachable pages | add | M | O3: the References and outline display of pages are the outline family's |
| P9 | Geo variants, in batches: triangle, hexagon, star, cloud, arrows, check-box, each with a 3D fill | add | S×n | no |
| P10 | `link` items drawn as URL cards; frame clipping; notes grow to fit | add | S | no |
| P11 | `ext.canvas.export {svg \| png \| json-canvas}`, with the SVG painter in the server entry ("a painter belongs to the view that paints with it") | add | M | no |
| P12 | `.tldr` import: geo, text, note, frame, arrow with bindings, image; one canvas per tldraw page, under a board | add | M | no |
| P13 | `ext.canvas.diagram {query \| mermaid}` | add | M | O4: it reads the graph family's `edgesOf` (trace plan T0) |
| P14 | Comments as `#comment` nodes anchored to an item; a canvas pin and a thread panel; `describe` lists them | add | M | O3 for the outline's display |
| P15 | 7a: the camera and layout onto the canvas view node (closes `GAP [[01M3S5DD5W4B3BSZMA6DE8ZVP8]]`) | restructure | M | O2 is landed; no |
| P16 | Laser in present mode; a deeper undo ring; text and SVG paste | add | S | no |
| — | 7b (items as nodes): decided separately (owner question 1) | — | L | O3 |

Order by the owner's use: P1–P3 (legend and dash semantics, bound arrows) →
P6–P8 (pages and drill-down) → P5 → P11–P12 (export, bringing tldraw boards
in) → P13 → P14 → the rest.

## Questions for the owner

1. **Canvas references now through a reference-carrier seam, with 7b still
   deferred**, against doing 7b for parity. *Recommended: the seam now, and
   7b deferred.* Parity needs references, not items as nodes.
2. **Pages are child `#canvas` nodes of a board.** *Recommended: yes.* Page
   records inside one document would be unaddressable.
3. **Parity in what it does, not in its look.** There is no hand-drawn dash or
   font, and the styles map onto kb's tokens. *Recommended: yes.*
4. **Freehand draw and highlight**, which were cut for simplicity: keep them
   cut, with lines and unbound arrows added. *Recommended: keep them cut.*
5. **No JS exec or board scripts.** Behaviour comes from native navigation or
   sandboxed code views. *Recommended: yes.*
6. **Bring the existing tldraw boards in by `.tldr` import,** with no export
   back. *Recommended: import only.*
7. **The ledger as `#agent-session` nodes** linked to the canvas, rather than
   Agents and Audit log pages. *Recommended: nodes.*

## Non-adoptions

- **tldraw's SDK, its store, or `.tldraw` (zip and SQLite) as a format.**
- **Arbitrary JS against the editor; board scripts; `config.js` custom
  shapes, tools or overlays.**
- **Embeds; the eraser; the hand-drawn style; a group that is not a frame.**
- **Page records inside one canvas document.**
- **LAN sharing of a board.** kb's tabs already share one store live over
  `/ws`.

## P1–P5: what landed

Branch `worktree-agent-ac8eaa87f14da65c0`, built on `868221d1`. Each step is
a restructure commit followed by a feature commit, except where noted.

| Step | Commits | What it is |
|---|---|---|
| P1 | `37ffc6ab` refactor | One `styleOf` reader for every colour any renderer paints. |
| P2 | `ca472c40` feat | An item's looks (`style`: fill, dash, size, font, align, valign, opacity), a named palette, and one `itemPaint` that both projections draw. |
| P3 | `fa32e8cc` refactor, `1949ded2` fix, `7f8bc3c1` feat | An edge's route is one `@kb/canvas` reading (`edgeRoute`). Every field round-trips through one table (`fields.ts`). Edges gain anchors anywhere on the outline, `straight`, `arc` and `elbow` routes with `bend`, heads at both ends, and line looks. |
| P4 | `1ae11764` feat | A `path` item, made by the line and arrow tools, drawn in both projections from one `itemOutline`. |
| P5 | `00299c41` refactor, `a5ede707` feat, `d7613c06` refactor, `bfcc8c32` feat | One shortcut table. Align, distribute, flip and order. H for the hand, and a `?` sheet. One `withFlag`, then `locked`. |

**Fields** (DESIGN.md, the canvas field table):
- item `style`
- edge `fromAnchor`/`toAnchor`, `route`, `bend`, `fromHead`/`toHead` and `style` (dash, size and opacity)
- the `path` item's `points`, `closed`, `fromHead` and `toHead`
- item `locked`

Each one is read and written through the field tables. Each keeps a value kb cannot read until kb writes that field.

**Agent.** It reaches all of this through the existing verbs:
- `place` makes items in looks, and lines or arrows from points.
- `connect` takes anchors, sides, route, bend, heads and looks.
- `arrange` aligns, distributes, orders or flips.
- `describe` reports looks, heads, routes and `locked`.
- The verbs that change named items refuse one that is locked.

**Contracts.** `canvas-look.contract.test.tsx` holds both projections to one model for:
- item looks
- edge route, line and heads
- line points and heads

**Gaps (minted by the coordinator):**
- GAP [[01M53H6YF9J97SFD9Y44V3NETE]]: a path is picked by its box, not by its stroke.
- GAP [[01M53H6Z5WQACGQ8ZR14HX5EDT]]: a path's points are set by the format or `place`. They have no handles to drag.
- GAP [[01M53H6ZWR6F960M40021EF9SW]]: the 3D gizmo still shows over a locked selection, though it moves nothing.
- Decision, not a gap: the inspector still edits a locked item field by field, as `tx.apply` does. Locked holds the item against acts that take it, not against explicit edits.
- Decision, not a gap: an edge's dash lives in its `style.dash`, the same field an item's does. It is not a top-level edge field.
- Process note: P4's restructure (`itemOutline` as the single outline answer) landed inside its feature commit rather than as a commit of its own.
- The shortcut sheet lists the table. The ⌘K palette does not list canvas shortcuts.

## P1–P5 review (GPT-6.1 Sol, 2026-10-17)

Open; queued as todo 01M53HTFM3G5P0ZGS3TTY26NNP. No blockers. Each finding names the file and line it was read at, on `59d2a062`.

### Majors

1. doc.ts:544,555 writes `extra` after known fields, so a stale unread key overwrites an edit (edge color:5 set to "1" in UI writes back 5). Callers: item-style-rows.tsx:204-207, edge-inspector.tsx:25-30, canvas-page.tsx:455, canvas-edge-link.ts:95,116-121, promote.ts:44-47. Fix: the record wins — known fields written after extra, or a written key always leaves extra; prove with a round-trip property over the field tables.
2. doc.ts:362-373, 436-465: text/label/shape/file counted as read by every kind, so a link's label is dropped, shape:"hexagon" becomes "rect", width:"w" becomes 240; records that fail parse are removed (417-419, 451), and every verb rewrites the doc, so an unrelated place deletes them. Fix: each kind keeps only keys it read, rest to extra; an unparseable record passes through opaque (or the write is refused). Unknown values must round-trip (DESIGN.md canvas section).
3. Lock vs inspector: item-inspector.tsx:213,217 leave Height/Depth/Rotation live on a locked item; editItem (membership.ts:175-189) moves members. The hint promises nothing drags/turns. Decide one rule and make code + hint + DESIGN.md agree (recommended: geometry rows read-only while locked; non-geometry fields still editable, matching your decision that explicit edits pass).
4. Flip doesn't negate `bend`: arrange.ts:339-342 mirrors ends via mirroredEnd (edges.ts:176-185) but arcs bow left of travel (edges.ts:226-231), default bend chord/5 → wrong side after flip. Negate arc bend (absent → -chord/5 written) and elbow bend along flipped axis; test.
5. 2D/3D divergence in fills/inks/washes: WASH 0.14 in canvas-card-face.ts:156 vs 14 in canvas-dom-paint.ts:19; groundOf/fillCss/wordsInk duplicated; uncoloured solid fill over(ink,0.9) in 3D vs full fg in DOM; uncoloured edge lerp(face,ink,0.4) in 3D (canvas-scene-edges.ts:215) vs foreground/35 in DOM (canvas-edge-layer.tsx:262). DrawnLook (projection-probes.ts:53-64) has no colour/fill. Fix: amounts live once in canvas-style.ts, both painters resolve them, contract asserts colour + ink.
6. 3D standing labels ignore size/align/opacity (canvas-scene-labels.ts:113-124,170-180 via paintLabel canvas-card-face.ts:676-697). Label paint takes itemPaint(...).words + opacity; look contract asserts it.

### Minors

7. Elbow head invisible when corner == endpoint (edges.ts:262-264, headOnLine 496-499): use nearest point distinct from tip.
8. Heads mean different things on edges (toHead kind + toEnd worn, edges.ts:397-400) vs paths (presence = worn, paths.ts:93-98): one end-plus-head reading.
9. ext-canvas verbs.ts input too loose: ColorSchema (28-33) accepts ""/any string; nodeId (301) no min(1), makeItem allows file:"" (presets.ts:165-169); make.line.points (346) no max; points unvalidated into paths.ts:63, presets.ts:194, withLine; bend (570) written for curve/straight. One shared points + colour validator in doc.ts used by verb schema and withLine.
10. describe.ts:215 gives a path only its kind; no points/closed/heads, no bend/anchors for edges. Report in the same shape make.line / connect take.
11. verbs.ts:430-435 headOrNone(x) ?? null after undefined guard, connectionLook restates head mapping: one headPatch.
12. Head ink: canvas-item-outline.tsx:45 full fg in 2D vs canvas-card-face.ts:588 line colour/60% ink in 3D; fold into 5.
13. canvas-keymap.ts:420,422,437 match a/c/d under ⌘ without checking shift → ⌘⇧C/⌘⇧D claimed. shift:false + keymap test.
14. ext.canvas.promote (verbs.ts:238-250) skips requireItems → rewrites a locked card. Decide (recommended: promote is an explicit edit, allowed; state it) or refuse.
15. deleteSelected (membership.ts:124,146; canvas-selection.ts:179-185) deletes a free frame's locked members through carriedBy; DESIGN.md says lock holds back delete. Decide + state (recommended: a locked member is not deleted with its frame — it is released to the canvas — or the frame delete is refused naming it; pick and test).
16. arrange.ts:283-285 align/distribute snap even when nothing moves; distributeSlots (172-176) uses greatest centre not greatest max → uneven gaps; distribute <3 items reports success; arrange ignores inapplicable params silently (verbs.ts:417-446) → refuse them.
17. Contract suites (canvas-projection.contract.test.tsx, canvas-look.contract.test.tsx) have no locked/flip/order cases; add them.

