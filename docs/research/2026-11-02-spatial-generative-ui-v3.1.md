# A spatial, generative canvas for the voice concierge (v3.1 addendum)

Date: 2026-11-03. Design only. An addendum to the
[v3 delta](2026-11-02-spatial-generative-ui-v3.md), answering four concerns
of the owner's. v3 holds except where §0 says otherwise. Claim tags as in
v3; bb facts are from the Plugin SDK guide shipped with the running bb
[doc].

## 0. What changes from v3

| v3 | v3.1 |
|---|---|
| A space is a folder per space; the space plugin and the concierge's second mode open it | **A space belongs to a bb thread** (§1). The thread's agent drives it, on any provider, and the thread's history is the conversation. The concierge is one such thread |
| Storage: a folder per space with git (§7.3) | Keyed by thread: `spaces/<threadId>/` under the plugin's data directory, indexed in the plugin's database, with a pointer in the thread's plugin metadata (§1.2) |
| No motion spec | Motion and material **tokens**, applied by the item shell, so every component gets them (§2) |
| A chain is items and wires | **A chain can be one unit** with three display modes (§3) |
| Components: built-in skills, unspecified | **bb's shadcn registry inside the space frame**, bb host components as ring 0 panes, and a spatial skin (§4) |

## 1. A space is a plugin surface bound to a thread

The owner's instinct holds, and bb supports it directly. A thread already
integrates with the rest of bb (projects, environments, PRs, tasks,
notifications), and it carries the conversation.

### 1.1 The shape

- **Opening a space.**
  - A space opens as a **thread panel tab**: a `threadPanelAction`
    "Space" whose component receives `{threadId}` [doc].
  - It can go full screen (v3 §1.3). On a thread with no space, opening the
    tab creates one.
- **The thread's agent drives it, on any provider.**
  - `space_run` and `space_describe` are plugin agent tools, and every call
    carries the caller's `threadId` [doc]. Each tool acts on **that
    thread's space**, never on another's.
  - `contributeInstructions` adds the skill index and a one-line summary of
    the space, and only to threads that have one.
- **The thread's history is the conversation.**
  - The space keeps no chat of its own. Its history is its transaction
    log, and each transaction names the turn that caused it.
  - So "why is this card here?" is answered by the thread.
- **The voice concierge is just a thread with a space.** Nothing in the
  space plugin knows about voice.

### 1.2 Defaults

| Question | Default | Why |
|---|---|---|
| One space per thread, or several? | **One per thread, with pages.** v3's scene already has pages; a second space is a fork (below) | One place to look. Tools need no space id. Pages carry "another view of the same work" |
| Where does the state live? | Under the plugin's data directory, beside its `data.db` [unverified that a plugin may keep a folder there; otherwise everything goes in the database]: `spaces/<threadId>/` (scene, skills, assets, the git history, the transaction log), indexed in the plugin's SQLite database. The thread's **plugin metadata** holds only a pointer `{space: {id, rev, panel}}` (the namespace is capped at 256 KiB [doc]) | Keyed by thread, owned by the plugin, and small on the thread record |
| Can another thread see it? | **Read-only**, by reference: `space_describe {threadId}` from another thread, and a `ref {source: "bb", id: <thread>}` card in another space. Only the owning thread writes | One writer per space; no locking |
| Forking | **The thread fork forks the space** at its current revision. Its git history is branched into `spaces/<newThreadId>/`. The plugin's own "Fork with space" action seeds the fork's metadata [doc: explicit forks may seed plugin metadata; plain forks never inherit it]. **A plain bb fork** is detected on `thread.created` through its `sourceThreadId` [doc]; its panel offers "Bring the space from the source thread". | The fork starts where you were, without copying a space you didn't want |
| Archive | On `thread.archived` [doc], the space **freezes**: rules stop, live bindings and their subscriptions are released, workers and frames are torn down, and the data is kept. Opening it shows its last snapshot, read-only. `thread.unarchived` resumes it with fresh reads | An archived thread costs nothing, and comes back intact |
| Delete | On `thread.deleted`, the space moves to the plugin's trash and is removed after 7 days. "Export space" saves a copy first | Recoverable for a week |
| Missed events | At start-up, the plugin reconciles: spaces whose thread is archived or deleted are frozen or trashed. Events that arrive while it is unloaded are not replayed [doc] | |

### 1.3 Voice on any thread (DOT-3), merged

DOT-3's design:

- a mic in every thread header;
- a "Talking to: <thread>" chip;
- instructions go to that thread as `[voice]` messages;
- status questions are answered by the concierge.

It merges as follows:

- **Any thread can grow both a mic and a space panel.** They are
  independent: a thread may have either, both, or neither.
- **There is still one voice session per person** (the concierge's GPT-Live
  session). What changes is its **target thread**, shown by the chip.
- **The v2 speed paths follow the target:**
  - **P0** applies its ops to the **target thread's space**, through the
    space plugin's RPC;
  - **P1** composes for that space;
  - **P2 is the target thread itself**: the instruction lands there as a
    `[voice]` message, and that thread's own agent, on whatever provider,
    calls `space_run`.
- **The turn record** (v2 §7.2) is keyed by `(voice session, target
  thread)`. Switching the target ends the turn that was open.
- **Approval** (v3 §5) uses the target thread's space. A spoken "yes"
  counts only for a command proposed from the person's utterance to that
  thread.
- **The concierge thread** is the default target. It is a thread like any
  other, with its own space.

## 2. Motion and material

The goal is the feel of visionOS:

- things have mass, and respond at once;
- they never jump, and can always be interrupted;
- depth means something.

All of it is **design tokens**, read through v3's `look` port. Components
never animate themselves. **The item shell does,** and ring 1 draws that
shell around every item (including ring 3 frames). Every component,
generated ones included, gets this for free.

### 2.1 Tokens

```ts
type MotionTokens = {
  spring: {                         // critically damped or slightly under; all interruptible
    snappy:  { stiffness: 520; damping: 40; mass: 1 };   // hover, press, toggles
    move:    { stiffness: 300; damping: 32; mass: 1 };   // presets, drags released, chains unfolding
    camera:  { stiffness: 140; damping: 26; mass: 1 };   // camera flights; also capped at 600 ms
    ambient: { stiffness: 60;  damping: 18; mass: 1 };   // parallax, focus glow
  };
  stagger: 18;                      // ms between items of one preset move, at most 12 items staggered
  press:   { scale: 0.97 };
  hover:   { lift: 6; scale: 1.015; shadow: "elev-2" };  // lift in px of elevation (room: toward the viewer)
};
type MaterialTokens = {
  glass:  { blur: 24; tint: "card/0.62"; edge: "foreground/0.10"; specular: 0.08; innerShadow: "elev-0" };
  glassLite: { tint: "card/0.88"; edge: "foreground/0.10" };          // no blur: the budget fallback and the phone
  depth:  { layers: [0, 8, 24, 64]; parallax: 0.04; shadowPerLayer: ["elev-0", "elev-1", "elev-2", "elev-3"] };
  focus:  { glow: "primary/0.18"; radius: 160 };          // follows the pointer across the focused panel
};
```

Colour names are bb's theme tokens (`card`, `foreground`, `primary`), so
custom palettes keep working (§4). The numbers are starting values, tuned in
phase 2 [estimate].

### 2.2 Behaviour

- **Springs, not durations.** Every motion is a spring from the current
  position *and velocity* to a target.
  - A new target retargets the running spring. Nothing restarts, so a
    second "arrange as grid" mid-flight just bends the path.
  - A drag hands its release velocity to the `move` spring.
- **Hover lift.** The panel under the pointer rises by `hover.lift` and
  gains a shadow, with `snappy`. Press dips it to `press.scale`.
- **Focus follows the pointer.** A soft glow (`focus.glow`) tracks the
  pointer across the focused panel, like visionOS's gaze highlight, and the
  panel's edge brightens. This needs no gaze data. On touch it is off.
- **Depth and parallax.**
  - Items sit on depth layers (`depth.layers`): content, raised, ornament,
    modal.
  - In room mode the pointer (or head pose, later in XR) shifts the camera
    slightly (`depth.parallax`), so the layers separate.
  - In flat mode the depth layers show only as shadow.
- **Ornaments** (visionOS's attached toolbars) are child items anchored to
  a parent's edge, a layer above it.
  - They follow the parent with `snappy`, so they trail by a frame or two
    and settle.
  - They appear only on the focused item.
- **Camera transitions.**
  - A fly-to uses the `camera` spring, capped at 600 ms, with yaw before
    pitch, and it keeps the horizon level.
  - When the target is behind the viewer, the camera turns, never cuts.
  - Switching between flat and room morphs every item along the cylinder
    mapping (v2 §3.1) with `move`.
- **Glass.**
  - Panels are glass (`glass`): background blur, a tint drawn from the
    theme, a 1 px edge and a faint specular gradient.
  - Blur is expensive, so at most **8 glass panes blur at once**: the
    focused item, its neighbours and ornaments. All others draw
    `glassLite`, which has no blur.
- **Websites move in sync.** Website frames live in ring 0 (v3 §5), so ring
  0 runs **the same spring solver from the same targets and start time**.
  If phase 2 measures more than 1 px of drift, a website shows its snapshot
  face while it moves, and goes live when it settles.

### 2.3 Budgets

- **60 fps on the owner's laptop, during a 30-item preset move,** with
  fewer than 1 % of frames dropped. 120 Hz where the display offers it.
- **Only compositor properties animate:** `transform`, `opacity`, and
  `filter` on at most 8 glass panes. Layout never animates.
- **Per frame:** at most 4 ms of main-thread work during motion, which
  leaves room for v2's reflex path.
- **Measured in phase 1,** from a Chrome performance trace (frame
  timings), on the laptop and on the phone.

### 2.4 Phone and reduced motion

- **Phone:**
  - the single-column preset (v2), with no parallax and no hover;
  - press feedback;
  - `glassLite` only (no blur);
  - sheets for ornaments;
  - camera transitions become a scroll to the item;
  - a 120 Hz target where supported.
- **`prefers-reduced-motion`:**
  - every spring becomes a 120 ms crossfade, or an instant change for
    positions;
  - no parallax, focus glow or ornament trailing;
  - camera flights become a cut with a crossfade;
  - presets apply at once, with no stagger.

  The same tokens carry the reduced values, so no component checks for
  reduced motion itself.

## 3. Showing the compute chain, or only part of it

Yes. The scene already has groups (frames) and typed wires (v2 §3.4), so a
chain is **a group with a role**.

```ts
type Chain = GroupItem & {
  role: "chain";
  display: "output" | "pinned" | "expanded";
  pinned: ItemId[];                 // steps kept visible in "pinned"
  ports: { inputs: BoundaryPort[]; outputs: BoundaryPort[] };   // derived: the wires crossing its edge
};
```

**Display modes:**

- **`output`:**
  - Only the chain's output view or views show.
  - A **chain chip** ornament on the output shows the step count, live
    status (fresh, running, stale, error) and the last run time.
- **`pinned`:**
  - The output, plus the steps you chose.
  - The other steps collapse to small glyphs on a rail between them, so
    the order is still visible.
- **`expanded`:**
  - Every step, with its wires.
  - In flat mode the chain unfolds as a left-to-right pipeline beside the
    output.
  - **In room mode it unfolds into depth:** the steps stack *behind* the
    output on receding depth layers, offset so each is visible, and the
    output stays in front. Collapsing folds them back.

**Visibility never changes execution.** Hidden steps keep running. Their
subscriptions belong to the flow scheduler, not to faces (v2 §6.1).

**Toggling, per chain:**

- **by click:** the chain chip's menu, or click a rail glyph to pin that
  step;
- **by voice,** as built-in P0 intents:
  - "show the steps";
  - "just the output";
  - "pin the filter";
  - "hide that step";
  - "expand chain two".

**Making chains:**

- A `space_run` that composes a query → transform → view → command
  sequence creates it as a chain. Its display defaults to `output`, and
  the agent may choose another.
- A person can select connected items and say "group as chain". The
  selection must be one connected subgraph, or it is refused with the gap
  named.
- Ungrouping keeps the items and wires.
- **A chain can be saved as a skill** (kind `recipe`, with its boundary
  ports). It joins the library (v3 §4.2), and P1 or P0 can then compose
  the whole chain by name.

**Inspecting a step** opens its detail as an ornament:

- its input and output (the first rows), typed by its ports;
- its last run time;
- its error.

This works in any display mode.

## 4. The component library and the look

**Recommendation: the owner's lean, adjusted to the rings.**

1. **bb's shadcn registry, vendored into the space frame.**
   - What bb's SDK ships for plugin UI is **vendored shadcn source**: the
     `@bb` registry has about 46 stock items (button, card, dialog, table,
     command, chart, form, …), generated from bb's own component source and
     pinned to the running bb's release [doc].
   - So "shadcn" and "bb's own components" are one choice. Using the
     registry gives consistency with bb by construction.
   - **Two caveats from v3's rings:**
     - **The frame has its own bundle.** A plugin's normal app bundle
       relies on runtime shims for React and Radix's overlay packages. The
       space frame is a separate document, so its bundle includes its own
       React and Radix.
     - **Icons.** The registry's `icon` wraps the host's
       `experimental_Icon`, which cannot run in an opaque frame. The frame
       bundles `lucide` instead. Open question 4 covers bb's own glyphs.
2. **bb's host components become ring 0 panes.**
   - `ThreadChat`, `experimental_Diff`, `experimental_SourceCode` and
     `Markdown` are capabilities, not a UI kit, and render only in bb's
     React [doc].
   - They appear in a space the way websites do (v3 §5): ring 0 draws them
     over the item's rect, in sync with the same springs.
   - They are built-in skills: `bb.chat` (another thread's chat in your
     space), `bb.diff` and `bb.source`.
   - Markdown inside ordinary cards uses a renderer bundled in the frame,
     since panes cost more than cards.
3. **The spatial skin** is the item shell of §2: glass, depth, hover,
   focus, ornaments and motion. It wraps every component. **Components are
   flat shadcn inside, and spatial outside.**
4. **The look follows bb's theme, live.**
   - bb's Tailwind compiles against the host's CSS variables [doc]. Ring 0
     reads the computed variables from bb's document and sends them over
     the `look` port, and ring 1 sets them on its root.
   - Custom palettes and dark mode then match bb exactly, and the frame
     defines no colours of its own.
5. **Every component is a catalog entry:** a built-in skill (`SKILL.md`,
   ports, intents, `mount → {update, dispose}`; v3 §3.2, §4.2).
   - **The first set:**
     - `record.list`, `record.card`, `record.detail`, `record.table`;
     - `board`;
     - `stat`;
     - `chart` (the registry's chart);
     - `markdown`;
     - `image`;
     - `command`;
     - `chain` (§3).
   - **Then the bb record presentations:** `thread.card` and `pr.chip`.
6. **Generated UI uses the same library.** Ring 3's shell bundles the same
   components and skin, exposed to generated code as a fixed module map.
   - An agent's component composes `Card`, `Table` and `Button` rather than
     writing raw HTML, so it looks native.
   - Raw HTML stays possible.
7. **kb's look arrives later** through the kb host's `look` (v3 phase 3).
   It means kb's tokens behind the same names, not a second library.

## 5. Phases

| v3 phase | Adds |
|---|---|
| 1a spike | Theme tokens over the port into the opaque frame; the frame's own bundle (React, Radix, the `@bb` components); spring and blur cost on the laptop and phone |
| 1b | The thread binding (§1): the panel action, keyed storage, the metadata pointer, the archive, delete and fork handlers, start-up reconciliation. Tools scoped by `threadId`. Item shell with the `snappy` and `move` springs, hover and press. `glassLite`. Chains in `output` and `expanded` modes, flat. The library's first set. The 60 fps budget, measured by hand from a trace |
| 2 | DOT-3's mic on any thread, retargeting P0, P1 and P2. Glass with blur and the 8-pane budget. Parallax, focus glow, ornaments, camera flights, the room morph. Chains in `pinned` mode and unfolding in depth. `bb.chat`, `bb.diff` and `bb.source` panes. Saving a chain as a recipe skill |

## 6. Open questions, each with my default

1. **May a thread have several spaces?** *Default:* no: one, with pages. A
   fork makes another.
2. **Does a plain bb fork copy the space?** *Default:* no. It offers "Bring
   the space"; "Fork with space" copies it.
3. **What happens to a deleted thread's space?** *Default:* the trash for 7
   days.
4. **bb's own glyphs inside the frame?** *Default:* `lucide` in phase 1.
   Later, ring 0 sends the SVGs of the glyphs a space uses over the `look`
   port.
5. **Blur on the phone?** *Default:* off (`glassLite`).
6. **What does a new chain show?** *Default:* `output`, with the chain chip.
7. **Can a voice switch targets mid-turn?** *Default:* no. The switch ends
   the open turn, and the next utterance goes to the new target.

## Sources

- **bb Plugin SDK guide**, as shipped with the running bb:
  - `frontend-core-slots.md`: `threadPanelAction`, file openers and
    thread storage;
  - `frontend-hooks-and-ui.md`: vendored shadcn, the `@bb` registry,
    runtime shims, icon and theme tokens;
  - `frontend-components.md`: `ThreadChat`, `Diff`, `SourceCode`,
    `Markdown` and `VoiceInputTextarea`;
  - `backend-sdk.md`: thread plugin metadata, `threads.fork` seeds, thread
    trees and the `sourceThreadId` filter;
  - `backend-events.md`: `thread.archived`, `thread.unarchived`,
    `thread.deleted`, and no replay of missed events;
  - `backend-foundation.md`: `bb.storage`;
  - `backend-cli-agents.md`: the tool context's `threadId` and
    `contributeInstructions`.
- **DOT-3** (bb task): voice on any thread, the night shift's design and
  its comments.
- **visionOS:** Apple's Human Interface Guidelines (materials, depth,
  ornaments, the hover effect, motion), https://developer.apple.com/design/human-interface-guidelines/designing-for-visionos
