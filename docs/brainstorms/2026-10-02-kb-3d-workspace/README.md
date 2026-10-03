# kb: a 3D brainstorming workspace

Plan of 2026-10-02, for the owner's ask: "not a 3D canvas but a 3D
workspace, with tools to brainstorm in 3D with flat or 3D objects,
Blender-ish with predefined objects, a tldraw-like experience". The evidence
is in [research.md](research.md), cited as §a–§g, and this file does not
restate it. It builds on the decisions in
[2026-09-29 README](../2026-09-29-kb-genui-canvas-agents/README.md), cited
as D1–D13, and on the code that step 8 merged. Once the owner signs it off,
this file is the home of these decisions.

**In one paragraph.** kb already has most of what a 3D workspace needs:
one canvas document, one camera model in which 2D is the same camera held
face-on and orthographic, a 3D scene on the scene kit, and a projection
contract suite ([§a](research.md#a-what-kb-has-today-fileline),
[§e](research.md#e-2d-3d-switching-evidence)). What it lacks is volume:
every item is a flat card on a plane. The plan adds volume in the smallest
form that fits the existing model. Every item becomes a box: its footprint,
its height `z`, a new `depth`, and a new `rotation`. Its `shape` says what
fills the box. Its meaning is a `nodeId` that any item may carry. That last
split is what makes the step-7 deferral safe: later, "promote to node" just
sets a field, with no rewrite. Interaction is tldraw's grammar (sticky
tools, click to select, handles) plus Blender's precision (a gizmo, modal
G/S/E, axis constraints, typed numbers, view presets). All of it is built
on vanilla three, the scene kit and one three addon, `TransformControls`.

## Decisions

### Workspace shape

1. **One switchable workspace, not separate 2D and 3D types.** A canvas is
   one document. 2D and 3D are two projections of it, and 3D tools work in
   the same document as 2D ones (D6: "2D and 3D are the same layout seen
   through a different camera").
   - Why: this is already built and proven (`CANVAS_PROJECTIONS`, the
     handover, the contract suite, [§e](research.md#e-2d-3d-switching-evidence)).
     Splitting the types would fork the item model, the tools and the agent
     verbs for every feature after this one. ShapesXR, Spline Hana and
     Freeform all mix flat cards and solids in one scene
     ([§b](research.md#b-prior-art-products), takeaway 1).
   - What switching costs: each new shape needs a 2D footprint as well as a
     3D mesh. That is one small table entry per shape (decision 6), not a
     second editor.
   - **Escape hatch:** if keeping the two renderers in parity gets
     expensive, drop the DOM renderer for 3D-heavy canvases. "2D" then
     becomes the 3D scene's top orthographic view, which is C23's option A
     (C23 §4.3). The data does not change, because both renderers read one
     document. If mixing the two confuses people, a canvas simply opens in
     3D (`camera.projection`), and 2D stays available as its top-down
     editing view.
   - Visualisations that are better in 3D *and* derive from the graph
     (force3d, layers by a field) stay graph renderers. The workspace is the
     placed layout. Agents bridge the two with `arrange` (decision 16).

2. **The canvas plane is the floor and z is up.** 2D is the top view, as in
   Blender's numpad 7. The 3D orbit becomes a turntable that yaws about z,
   with pitch running from 0 (top) to π/2 (level with the floor).
   - Why: today yaw turns about the canvas's y axis, which treats the plane
     as a wall (`canvas-camera.ts` `frameOf`). Pitch is also clamped at
     1.35 rad, so a front view is impossible. Shelves, pillars, stacking
     and "place on" all need an up direction. LLMs place objects well
     relative to other objects on a floor
     ([§f](research.md#f-agent-notes-brief), SceneActBench layout 84.1).
   - The data does not change: `z` already means "toward the viewer", which
     in a top view is up. Only `frameOf`, `orbitView` and `MAX_PITCH` move,
     and the projection contract proves the result. Saved poses are view
     state and are reset. **Owner question 1.**
   - Built in step 1, with two changes made in the doing. The vertical drag
     now follows Blender and three's `OrbitControls`: dragging down tips the
     view toward the top. Saved poses are not reset; they are read under the
     new model, with pitch clamped into 0..π/2. The 3D projection has two
     lenses, perspective and orthographic (decision 9's numpad 5), so a
     `pose` carries the lens as `fov`. A pose without one is seen in
     perspective.

### Object model

3. **Look and meaning are separate fields on every item.** `type`/`shape`
   say what an item looks like. `nodeId` says what it means, and it moves
   from the `kb-node` type onto every item (`doc.ts` `CanvasNodeBase`).
   - A card is a `kb-node` item, which is the stored name for a text card
     showing its node. A box can show a node too. A sticky is a text item
     with no node.
   - **Promote to node** is the `ext.canvas.promote` action. It creates a
     node from the item's text (with no parent, per D6), sets `nodeId` and
     drops the item's own text. Node first, then layout, as D6 orders it;
     an orphan node is harmless.
   - This respects the owner's deferral: nothing becomes a node unless
     someone promotes it. It also keeps D6's door open. Step 7b is then a
     *policy* (promote at creation) plus moving the layout onto the view
     node. It is not a format rewrite.
   - A drawn edge between two items that both carry nodes can bind a ref
     prop through the existing `kbLink`, whatever the items look like.

4. **Every item is a box, and its shape fills it.** These are typed fields
   in `@kb/canvas`, not an `extra` bag. D6 already names the layout entry as
   "node id plus transform (x, y, z, size, rotation, style)". The bolt-on
   that research §e warns about would be untyped extras.

   | Field | Meaning | Status |
   |---|---|---|
   | `x, y, width, height` | footprint, top-left, canvas units | exists |
   | `z` | height of the base above the floor; absent is 0 | exists; meaning restated, data unchanged |
   | `depth` | extent upward from `z`; absent or 0 is flat | new |
   | `rotation` | `{x, y, z}` in degrees about the box centre, in one fixed order that `@kb/canvas` owns | new |
   | `shape` | `rect`→box, `ellipse`→cylinder, `diamond`→prism, plus new `sphere`, `cone`, `arrow`. When flat, each draws its outline | widened |
   | `nodeId` | meaning, on any item (decision 3) | widened |
   | `parent` | the group or frame it belongs to (decision 12) | new |
   | `billboard` | in 3D, the face turns to the camera (labels) | new |
   | `file` | `assets/…` image (a JSON Canvas `file` item, typed at last) | typed |

   - Transforms are stored in world coordinates. A group transform rewrites
     its members, so agents and the 2D view read plain numbers with no
     matrix stack.
   - Paint order in 2D, and the `paintPlanes` tie-break, use the top
     surface (`z + depth`) and then document order.

5. **Predefined objects are presets over that one record, not kinds.** A
   `CANVAS_PRESETS` table maps each tool to a partial item. The per-tool
   branches in `placeWithTool` fold into it. A tool makes the same item in
   either projection.

   | Group | Preset | Item it makes |
   |---|---|---|
   | flat | sticky · label · card · frame · image | text (colour) · text (no fill, `billboard`) · `kb-node` · group · file |
   | flat | rect · ellipse · diamond · arrow | shape, `depth` 0 |
   | solid | box · pillar · sphere · cone | shape rect / ellipse (tall) / sphere / cone, `depth` > 0 |
   | solid | slab (shelf) · wall (board) | thin rect raised on `z` · thin rect rotated 90° about x, so stickies can go on it |
   | link | connector | an edge (decision 13) |

   The step from flat to 3D is **extrude** (`E`), which sets `depth` on any
   item: a sticky becomes a block and a rect becomes a box. That is Spline
   Hana's "lift into 3D" ([§e](research.md#e-2d-3d-switching-evidence)) as a
   field edit.

6. **One shape table, split at the three boundary.** A pure `CANVAS_SHAPES`
   in shared code gives, per shape, its 2D outline, its hit volume and its
   edge anchors. A mesh-builder record in the `components/canvas/3d` zone
   is typed `{[K in CanvasShapeKind]: …}`, so tsc rejects a shape that has
   no mesh. Both sides use unit geometry scaled per item, with
   `InstancedMesh` when counts demand it.

7. **Storage and formats.**
   - The layout stays where it is: JSON Canvas with kb's typed fields in
     `sys.f.canvas`, written only through `ext.canvas.tx.apply` (D6; DESIGN.md
     → Canvas documents gets the new rows).
   - The camera stays on the document, and gap `01M3S5DD5W4B3BSZMA6DE8ZVP8`
     stays open. View presets are computed, not stored. **Saved viewpoints
     are frames**: "go to frame" and present mode step through them, so no
     camera list is added to the document.
   - **JSON Canvas export** is the 2D projection. It writes spec types only,
     turns cards into text with the node's text, and keeps kb fields as
     extra keys. Import is today's parser.
   - **GLB export** uses `GLTFExporter` in the 3D chunk, with
     `extras.kb = {canvasId, itemId, nodeId}` on each mesh.
   - **GLB import** creates a `model` item pointing at an asset uploaded with
     `asset.upload`. Its hit volume is its bounding box, and a missing asset
     draws a placeholder box. Primitives are always parameter records, never
     meshes ([§d](research.md#d-library-comparison), Object formats).

### Interaction

8. **Picking is the camera model's, and it is analytic.** `CanvasHitItem`
   grows from a rectangle on a plane into the item's oriented box.
   `hitTest` tests the ray against the box exactly, and against ellipsoids
   and cylinders exactly. Cone, prism and arrow use their box in v1.
   - Depth 0 is today's rectangle, so the restructure is proven by the
     current contract suite.
   - Built in step 2: `CanvasHitItem` is a box with an optional `depth`, and
     `hitTest` enters it with one slab test that a flat box also passes. The
     document has no `depth` yet (step 3), so every item is still flat. The
     exact ellipsoid and cylinder tests come with those shapes.
   - There is no three `Raycaster` and no BVH. Picking stays pure and
     GPU-free in tests. `three-mesh-bvh` waits for GLB models.

9. **Tools and keys: tldraw's grammar, Blender's precision, one meaning per
   key.**

   | Key | Does | Note |
   |---|---|---|
   | V/1 T/2 R/3 O,C/4 D/5 N/6 | select, sticky/text, rect, ellipse, diamond, card | unchanged |
   | F/7 | frame tool | **G freed** (G and F both pick the group tool today) |
   | B/8 | solid tool, with a picker that remembers the last solid (box, pillar, sphere, cone, slab, wall) | tldraw's geo-tool pattern |
   | A/9 | connector: drag from item to item; from empty space it makes a free arrow shape | |
   | G · S · E | modal grab · scale · extrude, with the selection under the mouse and no button held | Blender |
   | inside a modal: R / G / S | switch to rotate / grab / scale | R is free inside a modal |
   | inside a modal: X Y Z, ⇧X ⇧Y ⇧Z | constrain to an axis (press again for local), or to a plane | |
   | inside a modal: digits . - ⌫ | typed value | the modal's chord map comes first, so digits do not pick tools |
   | inside a modal: ↵ or click · Esc or right-click | confirm · cancel | |
   | ⇧1 · ⇧2 · numpad . | fit all · frame selected · frame selected | ⇧1 exists; ⇧2 is tldraw's |
   | numpad 7/1/3 (⌃ for the opposite side) · numpad 5 | top / front / right view · perspective or orthographic | |
   | `` ` `` | view menu: top, front, right, back, left, persp/ortho, 2D, fit, frame | for keyboards without a numpad |
   | ⌘G · ⌘⇧G | group · ungroup | |
   | ⌘Z ⌘⇧Z ⌘A ⌘D ⌫ arrows | as today | |

   - Built in step 1: the numpad views, numpad 5, ⇧2, numpad `.` and the
     `` ` `` menu, from one table that the menu reads too. The "perspective"
     view is named **oblique**, so it is not confused with the perspective
     lens. The menu also holds the oblique view and 2D/3D. Numpad keys match
     by physical key, so the top-row digits keep their tools and numpad `.`
     with NumLock off frames instead of deleting.
   - **R stays rect** (tldraw, already shipped). Rotate is G then R, the
     gizmo ring, or the 2D rotate handle. **Owner question 3.**
   - In 3D, a press-drag on empty space keeps orbiting, as shipped.
     Shift-drag on empty space is a screen-space marquee. **Owner
     question 4.**

10. **Transform: one pointer owner, two handles.**
    - A drag moves an item on its own horizontal plane, as today.
      **Alt-drag is the Z constraint**, the same code path as modal Z. The
      current special-case lift is deleted, not kept beside it
      ([§c](research.md#c-blender--dcc-conventions-adopt-vs-skip), axis
      constraint).
    - In 3D, the gizmo appears on the selection. It shows the last kind of
      transform used, which the selection toolbar can switch between Move,
      Rotate and Scale. A toolbar toggle switches between global and local
      space.
    - The pivot is the centre of the selection's bounding box. Individual
      origins come later.
    - In 2D, the corner resize handles exist already. A tldraw-style rotate
      handle sets `rotation.z`, and `E` with a vertical mouse move sets
      `depth`, shown as a badge.
    - Every handle feeds the canvas pointer reducer. A preview never writes,
      and a release is one history step and one `tx.apply`.

11. **Snapping: one module, three axes.** `lib/canvas-snap.ts` grows from
    x/y alignment into:
    - alignment on all three axes (`SNAP_TOL` 5 px);
    - a grid of 20 units (the dot grid) under constrained moves;
    - **surface snap**: when the dragged item passes over a solid's top
      face, its `z` snaps to that face, which is how stacking works;
    - rotation in steps of 15°;
    - scale to grid multiples.

    Holding ⌘ suspends snapping. `TransformControls`' own snapping stays
    off, so snapping has one owner.

    Step 2 built the first bullet: one rule over three axes, and an Alt-lift
    snaps to the heights other items stand at. The grid, surface, rotation
    and scale snaps come with the steps that make them mean something.

12. **Groups and frames are one concept.** A group is a `group` item, drawn
    as a frame, and its members say so with `parent`.
    - Dropping an item inside a frame's footprint sets `parent`, and moving
      the frame moves its members. That closes DESIGN-UI's unshipped "group
      cards translating their children".
    - Double-click enters a group, and Esc exits it. This is ShapesXR's
      re-openable group ([§b](research.md#b-prior-art-products), takeaway 2).
    - Blender's split between collections and parenting is skipped
      ([§c](research.md#c-blender--dcc-conventions-adopt-vs-skip)).

13. **Connectors in 3D.** Edges keep their current model.
    - On a solid, the anchors are its four side faces and its top face. When
      `fromSide`/`toSide` is absent, the anchor is the nearest surface point.
    - Edges are lines with cone arrowheads, and their labels are billboards.
      All are real meshes, so they occlude correctly.
    - An arrow either binds a ref once or stays a drawing (D6, Logseq rule).

14. **Selection, camera, text and undo.**
    - **Selection.** A click picks the nearest hit. Clicking the same spot
      again, without moving, picks the next item behind it, which reaches
      buried items. Esc steps out in order: modal, group, selection, tool.
    - **Camera.** Turntable orbit, pan with the right or middle button or
      Space, wheel to pan, and pinch or ⌘-wheel to zoom at the cursor.
      Double-click on empty space re-centres the focus there, TheBrain-style
      ([§b](research.md#b-prior-art-products), takeaway 5). Every jump is a
      rig flight (`lerpView`), and reduced motion lands at once.
    - **View widget.** A clickable SVG axis widget sits in the corner. It is
      computed from the camera frame, so no second scene is needed, and in
      2D it shows "top".
    - **Ground cues.** Lifted items cast the soft shadow that cards already
      cast, and selected items show a thin stem down to the floor. This is
      what makes depth readable on a flat screen.
    - **Text.** Faces stay `CanvasTexture`s painted by `canvas-card-face`, on
      the top face (or the front, for a wall). Double-click on a text item
      flies the camera face-on to it, overlays the existing DOM card editor
      on the projected rectangle, and flies back on commit. This works in
      every browser, which a hardware-keyboard VR tool cannot claim
      ([§b](research.md#b-prior-art-products), takeaway 3). Labels on
      spheres and pillars are billboards.
    - **Undo.** One ring (`canvas-history`) serves both projections. A drag,
      a gizmo drag, a modal transform and an extrude are one step each. The
      camera is never in history (as today).

### Libraries

15. **Vanilla three on the scene kit, plus one addon.**

    | Need | Choice | Why |
    |---|---|---|
    | renderer | scene kit, `three/webgpu` + TSL | already exists, contract-tested, runs headless (`fake-gpu.ts`) |
    | R3F / drei | **no** | A second scene model (JSX) beside the kit's imperative layers. v10 and v11 are alpha ([§d](research.md#d-library-comparison)). Revisit only if in-world UI grows to dozens of declarative panels *and* R3F v10 is stable |
    | gizmo | **`TransformControls`** (three addon) | Built without a `domElement`, so it adds no listeners. kb's gesture layer feeds its public `pointerHover/Down/Move/Up` (checked in the installed source; the API dates from r169). It moves a proxy `Object3D`, and a bridge module converts that motion to canvas space (y flipped) and hands it to the pointer reducer. kb owns the pointer, so the gizmo never competes with orbiting. Risk: its classic materials under WebGPU (the forum reports it works); fallback: a small custom gizmo on `hitTest`. `@pmndrs/handle`: no (XR-oriented, adds the pointer-events and zustand dependencies) |
    | camera | kb's camera model | OrbitControls or camera-controls would be a second camera model (Rule 1) |
    | picking | analytic, in `canvas-camera` | decision 8 |
    | geometry | three Box/Sphere/Cylinder/Cone/Extrude geometries | |
    | materials | solids use the rig's matcap finish (shaded without lights); faces stay unlit | card faces stay their token colours |
    | text | `CanvasTexture` faces and sprite billboards | troika is WebGL-only. three-text is 52.7 MB unpacked and young. `HTMLTexture` is a Chrome origin trial (DESIGN-UI already decided to stay on this path) |
    | formats | `GLTFExporter` / `GLTFLoader` | |

    **three r180 → r186** is its own chore commit (step 0), done before the
    first addon import (step 4), so new three code is written once against
    the target version. No feature waits for `HTMLTexture`. Done
    2026-10-03: the catalog pins `three` ^0.186.1 and `@types/three`
    ^0.186.0, and a fresh install resolves exactly those.

### Agents

16. **Relational verbs over the one write path, and the same functions the
    UI calls.** Each verb is a pure `(doc, input) → doc` in `@kb/canvas`,
    exposed as an `ext.canvas.*` action with its declared mode (D3) and
    written through `tx.apply`. The UI's own tools call the same functions,
    so an agent and a human cannot drift. These are C23 §4.4's actions,
    pulled out of step 7, because none of them needs items to be nodes.

    | Action | Mode | Does |
    |---|---|---|
    | `ext.canvas.describe` | read | Returns items (kind, label or node text, bounding box min/max, rotation, parent, nodeId) and relations: `on`, `in`, `linked`, and `near`, given as a side in plain words (left, right, north, south, above, below). Also the camera, and the visible set and selection from the screen state. Focus, blurry and peripheral detail as in C23 §4.4 |
    | `ext.canvas.place` | write | Creates or moves items by `{near, side, gap}`, `{on}`, `{in}` or plain coordinates. The server resolves positions, snaps them and nudges items out of overlap |
    | `ext.canvas.arrange` | write | Lays out ids as a row, column, grid, ring or stack, or as **layers**, where `z` follows a field's value: a 3D view of the graph that agents never place by hand |
    | `ext.canvas.connect` · `group` · `ungroup` · `promote` | write | an optional `bind` reuses `kbLink`; for promote see decision 3 |
    | `ext.canvas.lint` | read | Every write's receipt also carries `lints: {new, resolved}`. v1 lints: intersecting solids, an edge with a missing end, a card whose node is gone, a member outside its frame |
    | `ui.capture` | read | An open tab renders the canvas from a named view (a preset or a pose) to PNG without moving the user's camera; 2D is the scene's top orthographic view. It fails plainly when no tab is open |
    | `ui.navigate` | write | gains a camera target (item ids or a preset), so an agent can *show* the person something |

    - `CanvasScreenSchema` gains `projection` and `pose`. Today it carries
      only a 2D viewport. Built in step 1: the `pose` replaces the viewport,
      because the 2D view is that same camera from the top. The visible
      items are the ones the showing camera draws, through either lens.
    - There is no code execution against the canvas until step 9's sandbox.
      Blender MCP's `execute_code` is mode C territory
      ([§f](research.md#f-agent-notes-brief)).

## Build order

S is about a day, M a few days, L a week or more. A *restructure* step
changes no behaviour, and the tests that already pass prove it.

| # | Step | Kind | Size | Unblocks | Risk |
|---|---|---|---|---|---|
| 0 | three r180 → r186, fixing node_modules drift | chore | S–M | 4 | TSL churn in lab and force3d; proven by the scene contract and render specs |
| 1 | **Ground camera:** turntable about z, pitch 0..π/2, presets, view menu, axis widget, ⇧2 frame selected, `pose` in screen state | change + add | M | 3 | Changes how the shipped orbit feels (Q1). Saved poses are reset |
| 2 | **Item model:** `nodeId` on every item, `CANVAS_PRESETS` replaces the tool branches, `hitTest`/`paintPlanes` over item boxes, `canvas-snap` on three axes | restructure | S–M | 3, 8 | none new; proven by the current suites |
| 3 | **Solids:** `depth`, new shapes, `CANVAS_SHAPES` and mesh builders, 2D footprints, matcap, shadows and stems, B tool and solid presets, extrude in the inspector, surface snap | add | M | M1 | parity of footprints in the projection contract |
| — | **Milestone 1, "blocks on a desk":** make stickies, cards, boxes, pillars, spheres and shelves; drag, lift and stack them; extrude a sticky into a block; flip between 2D and 3D; top, front and side views | | | | |
| 4 | **Rotation and gizmo:** `rotation`, the `TransformControls` bridge, local/global space, the 2D rotate handle, 15° snap | add | M–L | 5 | the gizmo on WebGPU; correctness of the y-flip bridge |
| 5 | **Modal G/S/E:** constraints, typed values, Alt-lift folded into the Z constraint | restructure + add | M | — | ordering of the keymap state machine |
| 6 | **Groups and frames:** `parent`, ⌘G, enter and exit, frames move their members, frames as viewpoints and present mode | add | M | — | |
| 7 | **Text and media in 3D:** face-on editing, billboards, image items (paste or drop through `asset.upload`) | add | M | M2 | fit of the overlay on rotated faces |
| — | **Milestone 2, "tldraw-grade 3D board"** | | | | |
| 8 | **Agent verbs:** describe, place, arrange, connect, group, promote, lints diff, `ui.capture`, the camera target on `ui.navigate` | add | M–L | M3 | relational resolution quality; can run in parallel after 3 |
| 9 | **3D connectors:** anchors on solids, A tool, arrowheads, label billboards | add | S–M | — | |
| 10 | **Formats:** JSON Canvas export, GLB export, GLB import as `model` | add | M | — | GLB assets are backup-owned, so they are not in git |

Later and unscheduled: 7a (layout and camera onto the canvas view node,
closing `01M3S5DD5W4B3BSZMA6DE8ZVP8`), 7b (items become nodes, Q2),
an `HTMLTexture` enhancement, culling and a texture budget (closing
`01M3S5DDC3JYX8871YMJ7C6PAN`), agent presence, and local view (isolate the
selection).

**Gaps these steps will mint:**
- The item inspector is a canvas widget, not kb's node inspector (until 7b).
- There is no outliner (until 7b).
- 2D draws a tilted solid's top face, not its true silhouette.
- A canvas with GLB models is not portable through git alone.
- `ui.capture` needs an open tab.

## Owner answers (2026-10-02)

1. **Floor**, as Blender and other 3D software do it: z up, a ground grid,
   the orbit a turntable about z. The tool is for visualizing and arranging
   ideas, not for modelling: no mesh editing, sculpting or edit mode.
2. **Accept the step-7 cost for now:** no outliner, the shape inspector
   gains transform fields, both are gaps. Decide 7b after Milestone 2; 7a is
   scheduled after step 8.
3. **R stays rect.** G, S and E are the modals, and R switches to rotate
   inside one.
4. **Empty-space drag in 3D orbits.** Shift-drag is the marquee.

## Questions for the owner (as asked)

1. **Floor or wall?** Recommended: floor. The canvas plane is the ground,
   z is up, and the 3D orbit becomes a turntable about z. This changes how
   the shipped 3D orbit feels and resets saved poses. The alternative keeps
   the wall, where front and side views and "stack on" do not mean much.
2. **What the step-7 deferral costs.** Without items as nodes, the Blender
   outliner and the properties panel cannot be kb's outline and node
   inspector, which is what "everything is a node" asks for. The choices:
   - (a) v1 ships no outliner, extends the existing shape inspector with
     transform fields, and records both as gaps;
   - (b) do 7b before step 6.

   Recommended: (a) now, and decide 7b after you have used Milestone 2.
   Also: is 7a, which only moves the layout and camera onto the view node
   with no item becoming a node, inside the deferral? Recommended: no, so
   schedule it after step 8.
3. **R: rect (tldraw) or rotate (Blender)?** Recommended: R stays rect,
   with G, S and E as the modals and R switching to rotate inside one. A key
   whose meaning depends on whether something is selected breaks
   tldraw-style "select, then press R to draw".
4. **Drag on empty space in 3D: orbit (as shipped) or marquee?**
   Recommended: keep orbit, because it works on a trackpad without a middle
   button, and use Shift-drag for the marquee.
