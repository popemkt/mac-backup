# A spatial, generative canvas for the voice concierge (v3.1 addendum)

Date: 2026-11-03. Design only. An addendum to the
[v3 delta](2026-11-02-spatial-generative-ui-v3.md), answering the owner's
concerns and their follow-up replies. v3 holds except where §0 says
otherwise.

Claim tags are as in v3:

- **bb facts** come from the Plugin SDK guide shipped with the running bb
  [doc].
- **Ecosystem facts** come from a survey a GPT-6.1 Sol thread made today
  from primary sources (npm manifests, published licences, official docs)
  [doc, survey].

## 0. What changes from v3

| v3 | v3.1 |
|---|---|
| A space is a folder per space; the space plugin and the concierge's second mode open it | **A space belongs to a bb thread** (§1). The thread's agent drives it, on any provider, and the thread's history is the conversation. The concierge is one such thread |
| The scene is one forked `CanvasDoc`; git gets one commit per transaction | **A typed record store** like tldraw's (`@tldraw/store`, MIT), with document, session and presence scopes, migrations, and diffs (§2). The durable log holds one diff per transaction. Git gets squashed snapshots, one record per line |
| The fork cuts `svg.ts` and `tldraw.ts` (v3 §3.1) | **Both are kept:** SVG export and `.tldr` import are workspace features (§3) |
| Compute is the headline | **A workspace first, at tldraw's level** (§3). Compute layers on top |
| No motion spec | Motion and depth **tokens**, applied by the item shell (§4). No glass: depth comes from elevation and the spatial feel from motion |
| A chain is items and wires | **A chain can be one unit** with three display modes (§5) |
| Components unspecified; the first draft used bb's registry in the core | **A host-neutral core library:** Base UI primitives, shadcn-style components we own, Tailwind v4 tokens, and a zod catalog. bb's components appear only in the bb shell (§6) |
| Agent scripts are plain JS (v3 §4.1) | **TypeScript only** (§7). `.js` is refused, and a full typecheck runs on save or promote |
| Ports are JSON Schema (v2 §3.4) | **Ports are zod schemas:** one declaration gives the run-time check, the static type (`z.infer`) and the wire schema. A wire is checked statically in authored code and structurally when drawn. A mismatch is refused with a reason, or offered an adapter. Generic ports are supported (§7.2) |
| Rings decide where code runs (v3 §5) | **Three code tiers, copying kb's** (§7.3): built core, closure-bundled skills trusted by digest, and live agent code that is stripped and run in **QuickJS** when untrusted or a **Worker** when trusted, both from kb's engines. **Rules must be trusted before they run,** which is stricter than v3 §4.1 |
| Ring 0 draws only websites and approval chrome (v3 §5) | Ring 0 also draws **host panes** (`bb.chat`, `bb.diff`, `bb.source`). A chat pane is a timeline by default. Only the person can write in it, after explicitly activating it, and its target thread is fixed (§6) |

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
  - The space keeps no chat of its own. Its history is its diff log, and
    each diff names the turn that caused it.
  - So "why is this card here?" is answered by the thread.
- **The voice concierge is just a thread with a space.** Nothing in the
  space plugin knows about voice.

### 1.2 Defaults

| Question | Default | Why |
|---|---|---|
| One space per thread, or several? | **One per thread, with pages.** A second space is a fork (below) | One place to look. Tools need no space id. Pages carry "another view of the same work" |
| Where does the state live? | In the space's record store (§2), persisted under the plugin's data directory, beside its `data.db` [unverified that a plugin may keep a folder there; otherwise everything goes in the database], in `spaces/<threadId>/` (the diff log, snapshots in git, assets, skills). The thread's **plugin metadata** holds only a pointer `{space: {id, rev, panel}}` (the namespace is capped at 256 KiB [doc]) | Keyed by thread, owned by the plugin, and small on the thread record |
| Can another thread see it? | **Read-only**, by reference: `space_describe {threadId}` from another thread, and a `ref {source: "bb", id: <thread>}` card in another space. Only the owning thread's space accepts writes, and its writers (that thread's agent, the person, rules, voice) all go through v3's revision-checked commit queue | One owner per space; races are resolved by the queue, not by locks |
| Forking | **Only the plugin's "Fork with space" copies a space.** It calls `threads.fork` with a metadata seed [doc: explicit forks may seed plugin metadata; plain forks never inherit it]. **A plain bb fork copies nothing:** it is detected on `thread.created` through its `sourceThreadId` [doc], and its panel offers "Bring the space from the source thread", which runs the same copy (§1.3) | The fork starts where you were, and nobody gets a space they didn't ask for |
| Archive | On `thread.archived` [doc], the space **freezes** (§1.3). Opening it shows its last snapshot, read-only | An archived thread costs nothing, and comes back intact |
| Delete | On `thread.deleted`, the space moves to the plugin's trash and is removed after 7 days. "Export space" saves a copy first | Recoverable for a week |
| Missed events | Events that arrive while the plugin is unloaded are not replayed [doc]. At start-up, the plugin reconciles: spaces whose thread is archived or deleted are frozen or trashed | |

### 1.3 Lifecycle, forks and authority

- **Each space has a lifecycle state and an epoch,** both persisted:
  `active`, `frozen` (the thread is archived) or `deleted`.
  - A lifecycle transition is serialised with the space's commit queue,
    and bumps the epoch.
  - **Every commit, proposal and approval carries the epoch it was made
    under, and is refused if the epoch has moved.**
  - When a command is about to execute, its thread's state is checked
    again.
- **Freezing** (`thread.archived`):
  - voids every pending approval;
  - cancels queued and in-flight runs (their commits will be refused by
    epoch);
  - stops rules and releases subscriptions;
  - tears down workers, frames and host panes.

  A command that already executed stays executed; its receipt says so.
- **Unfreezing** (`thread.unarchived`) starts a new epoch with fresh reads.
  No earlier run or approval comes back.
- **Deleting** does what freezing does, then moves the space to the trash.
- **At start-up,** the handlers are registered first, then every space is
  reconciled against its thread's state, and only then are writes enabled.
  The handlers are idempotent, since events and reconciliation can overlap
  [doc].
- **The copy that forking does** is a plugin operation, idempotent per
  `(source, log offset, destination)`:
  1. **Pin a committed log offset,** not git's HEAD, which lags (§2.4).
  2. **Materialise the records at that offset** into
     `spaces/<newThreadId>/`, with the exact set of assets and skills they
     reference. The destination is marked `initializing`, so a crash leaves
     something recoverable.
  3. **Publish the metadata pointer only when the copy is ready.**
  - **History comes along as history.** Authority starts fresh: no
    pending approvals, ports, runs or deduplication state. Rules are copied
    but start their own runs.
  - **Forking from an earlier message uses checkpoints.**
    - When each user message arrives, the bb host records the message id
      and the log offset at that moment. This happens for every message,
      including turns that write nothing.
    - A fork from that message copies the log up to that offset, in order,
      every actor's writes included.
    - A late result from an earlier turn falls after the offset, so it is
      not copied.

### 1.4 Voice on any thread (DOT-3), merged

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
- **Every dispatch gets an immutable identity:** `(sessionId,
  targetThreadId, turnId, targetEpoch)`.
  - `targetEpoch` changes on every target switch, so A → B → A does not
    alias.
  - Every P0, P1 and P2 result, receipt and approval carries that identity.
    **Nothing reads "the current target" when it completes.**
- **On a target switch:**
  - Pending voice approvals are voided.
  - Work already dispatched **finishes against its original target, and
    is never rebound.**
  - A P2 answer is read aloud only if the target has not changed;
    otherwise it becomes a notification for that thread.
- **Approval** follows v3 §5 exactly: a spoken "yes" approves only a P0 or
  P1 proposal made from the person's utterance under the same dispatch
  identity. A P2 or guest proposal needs a press.
- **The concierge thread** is the default target. It is a thread like any
  other, with its own space.

## 2. Storage: a record store like tldraw's

**Recommendation: adopt `@tldraw/store`, with `@tldraw/state` and
`@tldraw/utils`, pinned at 5.6.0.**

- **The licence allows it.** Each of the three published packages carries
  its own MIT licence, separate from the tldraw SDK's licence, which covers
  `tldraw`, `@tldraw/editor` and sync [doc, survey].
- **It is the model the owner asked for, already built and tested:**
  - records and scopes;
  - migrations;
  - diffs that squash and reverse;
  - listeners filtered by source and scope;
  - side effects.
- **We build the rest:**
  - history and undo (tldraw's `HistoryManager` is in the editor);
  - the commit queue and later sync (a store is not a sync service);
  - the agent's diff API.
- **Risks, and the fallback:**
  - The bundle size is unmeasured: the published packages total 3.5 MB
    unpacked, with source and maps, plus some lodash helpers [doc,
    survey]. Phase 1a measures the minified and gzipped size in the ring 1
    bundle, against a budget of 40 KB gzipped [estimate].
  - If it fails that budget, or upstream churns, we write our own store
    with **the same record, diff and migration shapes**, so the switch
    stays local.
- **Rule 1:** this is the only store in space. kb's node store stays kb's,
  and the kb host maps between them (§2.5).

### 2.1 Records

```ts
// Document scope: saved, logged, synced later.
type DocumentRecord =
  | { typeName: "document"; id: "document:space"; name: string; pins: SkillPin[] }
  | { typeName: "page"; id: PageId; name: string; index: IndexKey }                    // fractional index for order
  | { typeName: "item"; id: ItemId; parentId: PageId | ItemId; index: IndexKey; kind: ItemKind;
      x: number; y: number; z: number; w: number; h: number; rotation: Rotation; locked: boolean;
      style: Style; props: Json /* per kind; a component's are its skill's, migrated by its sequence */; link?: Link }
  | { typeName: "edge"; id: EdgeId; pageId: PageId; kind: "arrow" | "wire";
      from: End; to: End; route: Route; head: Heads; label?: string }                   // End = {item, anchor | port} | {point}
  | { typeName: "binding"; id: BindingId; item: ItemId; port: PortName; source: Binding } // v2 §3.3 data bindings
  | { typeName: "chain"; id: ChainId; group: ItemId; display: Display; pinned: ItemId[]; exports: Exports } // §5
  | { typeName: "rule"; id: RuleId; trigger: Trigger; script: AssetRef; enabled: boolean }  // v3 §4.1
  | { typeName: "asset"; id: AssetId; mime: string; src: AssetRef; w?: number; h?: number };
type ItemKind = "text" | "note" | "shape" | "path" | "frame" | "group" | "image" | "video" | "file"
              | "bookmark" | "website" | "ref" | "component" | "pane";

// Session scope: per device, never logged or synced.
type SessionRecord =
  | { typeName: "camera"; id: `camera:${PageId}:${"flat" | "room"}`; pose: CameraPose }
  | { typeName: "instance"; id: "instance:local"; pageId: PageId; projection: "flat" | "room";
      selection: ItemId[]; focus?: ItemId; editing?: ItemId; chainDisplay: Record<ChainId, Display> };

// Presence scope: shared, never stored.
type PresenceRecord =
  | { typeName: "pointer"; id: `pointer:${DeviceId}`; page: PageId; point: Point; selection: ItemId[] }
  | { typeName: "agent"; id: `agent:${ThreadId}`; runId: RunId; phase: "reading" | "writing";
      items: ItemId[] }; // drawn by the item shell as "the agent is here"
```

- **The fork's arrow model is kept:** an edge's ends hold their own
  bindings, as kb's do. tldraw's separate binding records would mean
  rewriting the fork's edge code for no gain. Data bindings, which tldraw
  has no counterpart for, are their own records.
- **Display modes:**
  - a chain's `display` is its **document default**: what a new device
    shows;
  - `instance.chainDisplay` is a **per-device override**, as the owner
    asked ("session: camera, selection, display modes").
- **Scene ops stay pure.** The forked verbs (place, arrange, connect and
  the rest) read the records of a page, and return the records they
  change. The store turns that into a diff, so the fork's code barely
  changes.
- **Side effects** (the store's before/after create, change and delete
  handlers) keep structure whole, inside the same transaction:
  - deleting an item deletes its edges, bindings and chain membership;
  - a locked item refuses changes;
  - a frame's members move with it.

### 2.2 Changes are diffs

```ts
type RecordsDiff = { added: Record<Id, R>; updated: Record<Id, [from: R, to: R]>; removed: Record<Id, R> };  // tldraw's shape
type Transaction = { diff: RecordsDiff /* document scope only */; rev: Rev; expectedRev: Rev; epoch: Epoch;
                     actor: Actor; runId: RunId; dispatch?: DispatchId; turn?: TurnId };
```

- **Every change is a diff.** Every writer produces one:
  - a drag;
  - a `space_run` script;
  - a P0 op;
  - a rule;
  - an undo.

  It is committed as one transaction through v3's queue (expected
  revision, epoch, idempotency per run).
- **An interaction is one diff.**
  - While you drag, ring 1 applies the changes optimistically, and only
    session and presence records change.
  - On release, the drag's diffs are squashed (`squashRecordDiffs`) and
    committed once.
  - If the commit is refused, ring 1 reverses its local diff.
- **Undo reverses a transaction's diff** (`reverseRecordsDiff`) and commits
  that as a new transaction.
  - It applies only to records still equal to that transaction's `to`
    values.
  - Records changed since are skipped and named ("X was changed since; its
    move is not undone").
  - Redo is the same in the other direction. The undo unit stays v3's: one
    transaction.
- **The agent reads and writes diffs.**
  - `space_describe({since: rev})` returns the squashed diff since `rev`,
    summarised by the forked `describe`, so the agent sees what the person
    changed.
  - In a `space_run` script, `space.records.put / update / remove` work
    beside the verbs. Both become one diff.
- **Listeners filter by source and scope,** as tldraw's do. Ring 1 renders
  remote changes, and does not re-send them.

### 2.3 Schema and migrations

- **The schema is a set of migration sequences** (`createMigrationSequence`
  [doc, survey]):
  - `space.core` for the record types;
  - one `skill:<name>` sequence for each component whose props are stored,
    depending on core.
- **A snapshot** is `{schema, records}`. Opening a space migrates it up.
- **Up migrations only.** A space written by a newer runtime opens
  read-only, with "update space".
- **Skill pins** (v3 §4.2) say which version of a skill wrote an item's
  props. A skill update ships its migration, so pinned items move forward
  only when the person accepts the update.

### 2.4 Persistence and sync

- **The durable diff log is the source of truth** (v3 §4.3: appended and
  `fsync`ed before anything is visible).
- **Snapshots go to the space's git folder.**
  - A snapshot is `records.jsonl`, one record per line, sorted by id, so
    git diffs line by line.
  - It is written every 200 transactions, or when the space goes idle.
  - Git commits at most every 2 s, squashing. This changes v3's "one
    commit per transaction"; the log still has one entry per transaction.
- **Scopes decide what persists:**
  - document records are logged and snapshotted;
  - session records are kept by ring 0 per device, keyed by space;
  - presence is broadcast and never stored.
- **Sync, later:**
  - The bb host is already authoritative: clients send diffs with a base
    revision, and the server refuses or rebases them. That is the shape
    tldraw's sync uses.
  - So a second device later means a second client of the same queue.
    Document records sync, presence broadcasts, and session stays local.

### 2.5 Mapping onto kb's canvas

| Space record | kb (`CanvasDoc`, JSON Canvas 1.0 with kb fields) |
|---|---|
| `page` | A canvas node per page, under the board (kb models pages as nodes) |
| `item` of kind text, shape, path, frame, group, file, bookmark | The matching JSON Canvas node and kb item kind |
| `item` of kind `ref {source: "kb"}` | `kb-node` |
| `edge` (arrow) | A JSON Canvas edge, with kb's anchors, routes and heads |
| `asset` | A kb asset path |
| `camera` (session) | Only the default camera, in kb's camera node props |
| `binding`, `chain`, `rule`, and `item` of kind component, website or pane | The lossless sidecar of v3 §3.3; kb shows fallback cards |
| `presence` | Nothing |

- **Writing to kb:**
  - The kb host turns a diff into kb writes: a whole-document `tx.apply`
    today, or kb's planned by-id `ext.canvas.edit` (its parity plan, slice
    B) once that lands.
  - Diffs map onto edit operations one by one.
- **Taken from tldraw:**
  - records with typed ids;
  - the three scopes;
  - `RecordsDiff`, with squash and reverse;
  - listener filters;
  - side effects;
  - migration sequences and snapshots;
  - fractional index keys.
- **Not taken from tldraw:**
  - the editor and shape utils (the SDK licence; the kb fork is our editor);
  - `HistoryManager` (our undo is the server's transactions);
  - the sync server (the commit queue already plays that part);
  - tldraw's own shape schema (our record types are ours; the `.tldr`
    importer maps theirs).

## 3. A workspace first, at tldraw's level

The owner: "Compute is just one of the things. It must act as a workspace
above all, no less than tldraw."

So phase 1b builds the workspace before any compute. The fork already gives
most of it: kb's canvas was built toward tldraw parity, and its own study
maps tldraw's agent API member by member [doc, kb
`docs/research/2026-10-28-canvas-tldraw-parity.md`].

| tldraw (5.x) | The kb fork gives | Missing, and where it lands |
|---|---|---|
| Select, marquee, multi-select | `canvas-selection`, `card-pointer` | — |
| Hand, pan, zoom | Camera and rig, `canvas-zoom-menu`, touch | — |
| Draw (freehand), highlight | `path` items with stroke styles | — |
| Eraser | — | Build: a path-hit eraser (1b) |
| Laser | `canvas-laser` | — |
| Geo shapes | 14 kinds: rect, ellipse, diamond, triangle, hexagon, star, cloud, four arrows, check box, sphere, cone | — |
| Line | `path` items | — |
| Arrows with bindings | Bound edges with anchors, routes, heads and labels | **The half-bound arrow** (one end free; kb has a gap for it) (1b) |
| Text | Text items | **Rich text per span** (kb's formatted text came from its outline, which is cut). **Auto-size** text (1b). Editor: Tiptap [default, open question 5] |
| Sticky note | — (a toned text card) | A `note` kind (1b) |
| Frames, nesting | Frames that nest; members move with them | — |
| Group, ungroup | `group`, `ungroup` | — |
| Align, distribute, stack | `arrange` (row, column, grid, ring, stack, layers, align, distribute) | — |
| Snap | `snap.ts` | — |
| Rotate, resize | Rotation, gizmo, resize handles, transform guides | — |
| Z-order | `z`, layers | Bring forward and send back as named actions (1b) |
| Lock | `locked` | — |
| Duplicate | — | Build (1b) |
| Copy, cut, paste | Paste of text, SVG, images and canvas documents (`canvas-paste`) | **Copy and cut of a selection as records with schema** (re-identified on paste, as tldraw's content does); copy as SVG or PNG (1b) |
| Undo, redo | A snapshot ring buffer | Replaced by diff-based undo (§2.2) (1b) |
| Keyboard shortcuts, a shortcuts sheet | `canvas-keymap`, `canvas-shortcuts-sheet` | — |
| Pages | Pages (as kb nodes) | Rewritten as `page` records (1b) |
| Images, video | Image cards, `canvas-media` | Asset records and an upload path (1b) |
| Bookmarks | Link cards | — |
| Embeds | — (kb chose not to adopt them) | **Website items in ring 0** (v3 §5), with exact approved URLs (2) |
| Export SVG, JSON | `svg.ts`, `stringifyCanvasDoc` | **Kept in the fork** (v3 cut `svg.ts`; this restores it). The JSON export becomes the record snapshot (1b) |
| Export PNG | — (kb's gap: no rasteriser under Bun) | In the browser: rasterise the SVG on a canvas (1b) |
| Import `.tldr` / `.tldraw` | `tldraw.ts` (a pure lowering) | **Kept in the fork**, retargeted to records (2) |
| Comments | kb's comments (cut: they are kb nodes) | Later, as records |
| Multiplayer, cursors, following | — | Presence records now (the agent's focus); devices later (§2.4) |

**Compute layers on top:**

- bindings;
- chains (§5);
- rules;
- components.

These are record kinds and item kinds in the same store. They never get a
second editor.

## 4. Motion and depth

The goal is the feel of visionOS:

- things have mass, and respond at once;
- they never jump, and can always be interrupted;
- depth means something.

**The owner dropped glass.** So surfaces stay clean shadcn neutral:

- **depth comes from elevation:** shadow, plus distance from the wall in
  room mode;
- **the spatial feel comes from motion:** springs, scale and depth.

All of it is **design tokens**, read through v3's `look` port. Components
never animate themselves. **The item shell does,** and ring 1 draws that
shell around every item (including ring 3 frames). Every component,
generated ones included, gets this for free.

### 4.1 Tokens

```ts
type MotionTokens = {
  spring: {                         // critically damped or slightly under; all interruptible
    snappy:  { stiffness: 520; damping: 40; mass: 1 };   // hover, press, toggles
    move:    { stiffness: 300; damping: 32; mass: 1 };   // presets, drags released, chains unfolding
    camera:  { stiffness: 140; damping: 26; mass: 1 };   // camera flights; also capped at 600 ms
    ambient: { stiffness: 60;  damping: 18; mass: 1 };   // parallax
  };
  stagger: 18;                      // ms between items of one preset move, at most 12 items staggered
  press:   { scale: 0.97 };
  hover:   { elevate: 1; scale: 1.015 };                  // one elevation step up
};
type DepthTokens = {
  elevation: [                      // shadcn-neutral shadows; in room mode each step is also distance from the wall
    { shadow: "none";                                   z: 0  },
    { shadow: "0 1px 2px oklch(0 0 0 / 0.06)";          z: 4  },
    { shadow: "0 4px 12px oklch(0 0 0 / 0.08)";         z: 12 },
    { shadow: "0 12px 32px oklch(0 0 0 / 0.12)";        z: 32 },
    { shadow: "0 24px 64px oklch(0 0 0 / 0.16)";        z: 64 },  // modal
  ];
  layers: { content: 0; raised: 1; ornament: 2; focus: 3; modal: 4 };   // elevation steps
  parallax: 0.04;
  ring: "var(--ring)";                                  // the focus ring, shadcn's token
};
```

The numbers are starting values, tuned in phase 2 [estimate]. Dark themes
take the same steps with darker shadows and a 1 px `--border` edge, since
shadows read poorly on dark backgrounds.

### 4.2 Behaviour

- **Springs, not durations.** Every motion is a spring from the current
  position *and velocity* to a target.
  - A new target retargets the running spring. Nothing restarts, so a
    second "arrange as grid" mid-flight just bends the path.
  - A drag hands its release velocity to the `move` spring.
- **Hover lifts one elevation step** with `snappy`. Press dips the panel to
  `press.scale`.
- **Focus follows the pointer.** After 120 ms of dwell, the item under the
  pointer takes focus: one more elevation step and the `--ring` outline.
  Keyboard and voice actions ("make this bigger") apply to it. On touch,
  focus follows taps.
- **Depth and parallax.**
  - Items sit on the elevation layers: content, raised, ornament, focus,
    modal.
  - In room mode, layers are real distance from the wall, and the pointer
    (or head pose, later in XR) shifts the camera slightly (`parallax`), so
    the layers separate.
  - In flat mode, depth shows only as shadow.
- **Ornaments** (visionOS's attached toolbars) are child items anchored to
  a parent's edge, on the ornament layer.
  - They follow the parent with `snappy`, so they trail by a frame or two
    and settle.
  - They appear only on the focused item.
- **Camera transitions.**
  - A fly-to uses the `camera` spring, capped at 600 ms, with yaw before
    pitch, and it keeps the horizon level.
  - When the target is behind the viewer, the camera turns, never cuts.
  - Switching between flat and room morphs every item along the cylinder
    mapping (v2 §3.1) with `move`.
- **Ring 0 panes move in sync** (websites and host panes).
  - **Ring 1's animation state is authoritative.** On every retarget it
    sends a versioned state: position, velocity, target, camera, and a
    timestamp on a shared timeline (wall-clock milliseconds, converted from
    each frame's `performance.timeOrigin`).
  - Ring 0 integrates the same spring from that state.
  - **A pane takes no input while it moves.** It goes live once both sides
    agree on its settled rect.
  - If a state message is lost, the pane is hidden or backgrounded, or its
    drift is detected at runtime, it shows its snapshot face until it
    resyncs, keeping its focus and scroll position.

### 4.3 Budgets

- **60 fps on the owner's laptop, during a 30-item preset move,** with
  fewer than 1 % of frames dropped. 120 Hz where the display offers it.
- **What may animate:** `transform` and `opacity`. Layout never animates.
  - Each elevation step is a pre-rendered shadow layer, and a step change
    cross-fades the two layers' opacity.
  - No surface needs a blur, which removes v3.1's most expensive and least
    predictable cost.
- **DOM springs run on the compositor.** A spring becomes Web Animations
  keyframes with a `linear()` easing sampled from it. A retarget computes
  new keyframes from the current position and velocity.
  - This covers DOM items only.
  - The room's camera and the GPU stage run on the stage's own frame loop
    (`@space/stage`).
- **Per frame:** at most 4 ms of main-thread work during motion. That
  leaves room for v2's reflex path.
- **P0's first visible change never waits for motion.** The ghost appears
  at its target at once and settles from there.
- **The shell's motion is enforced; components' own motion is
  cooperative.** Overlays (Base UI's portals) are portalled into each
  face's own root, so they stay inside its shell and its reduced-motion
  setting.
- **Measured in phase 1** from Chrome performance traces (presented frames,
  not just rAF), on the laptop and on the phone, at 60 and 120 Hz, with
  real panes. Also measured: time from input to the visible change, rapid
  retargeting, background and resume, and reduced motion.

### 4.4 Phone and reduced motion

- **Phone:**
  - the single-column preset (v2), with no parallax and no hover;
  - press feedback;
  - at most two elevation steps;
  - sheets for ornaments;
  - camera transitions become a scroll to the item;
  - a 120 Hz target where supported.
- **`prefers-reduced-motion`:**
  - every spring becomes a 120 ms crossfade, or an instant change for
    positions;
  - no parallax or ornament trailing;
  - camera flights become a cut with a crossfade;
  - presets apply at once, with no stagger.

  The same tokens carry the reduced values, so no component checks for
  reduced motion itself.

## 5. Showing the compute chain, or only part of it

Yes. The scene has groups (frames) and typed wires (v2 §3.4), so a chain is
**a group with a role**: a `chain` record (§2.1) beside its group item.

```ts
type Chain = {
  group: ItemId;
  display: "output" | "pinned" | "expanded";   // the document default; a device may override it (§2.1)
  pinned: ItemId[];                            // steps kept visible in "pinned"
  exports: { inputs: ExportedPort[]; outputs: ExportedPort[] };
};
type ExportedPort = { id: PortId /* stable */; inner: { item: ItemId; port: PortName }; schema: JsonSchema };
```

- **The interface is declared, not derived.**
  - **Outputs** are the sinks the chain exports, whether or not anything
    outside consumes them. An isolated query → transform → view chain
    exports its view.
  - **Inputs** are the inner inputs that are left unbound or wired from
    outside.
  - Port ids are stable, so rewiring inside keeps the outside wires.
- **Graphs, not only pipes.**
  - Fan-in, fan-out and several sinks are allowed. In `output` mode the
    chain shows every exported sink.
  - **Cycles are refused,** as v2 refuses live loops.
  - A chain inside a chain is a component like any other.
  - Steps are ordered by a deterministic topological sort (ties broken by
    item id), which the rail, pipeline and depth layouts all follow.
- **Commands inside a chain stay dormant proposals** (v3 §5). Hidden steps
  keep running, but a hidden command never runs because of that.
- **Grouping, ungrouping and any rewiring of exports** happen in one
  transaction, with type checking.

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
    output on receding elevation layers, offset so each is visible, and the
    output stays in front. Collapsing folds them back.

**The unfolded positions are projection geometry, not scene edits.**

- They are derived per projection from stable item ids. The steps'
  records never change, so collapsing restores exactly what was there.
- Hit-testing uses the animated geometry that ring 1 holds.
- The depth stack stays within the room's near limit (v2 §3.1).
- Nested and large chains are in the room and LOD contract suites.

**Visibility never changes execution.**

- Hidden steps keep running. Their subscriptions belong to the flow
  scheduler, not to faces (v2 §6.1).
- Their faces are demoted to glyphs, which releases their frames and panes.

**Toggling, per chain:**

- **by click:** the chain chip's menu, or click a rail glyph to pin that
  step;
- **by voice,** as built-in P0 intents:
  - "show the steps";
  - "just the output";
  - "pin the filter";
  - "hide that step";
  - "expand chain two".

  A toggle changes this device's session override. "Make that the
  default" commits the document default.

**Making chains:**

- A `space_run` that composes a query → transform → view → command
  sequence creates it as a chain. Its display defaults to `output`.
- A person can select connected items and say "group as chain". The
  selection must be one connected subgraph, or it is refused with the gap
  named.
- Ungrouping keeps the items and wires.
- **A chain can be saved as a skill** (kind `recipe`, with its exported
  ports).
  - **It is a draft first** (v3 §4.2), in the draft namespace, on the slow
    path.
  - **Promotion reviews the whole dependency closure:** every component it
    uses must be reviewed and pinned, and its bounded expansion is checked.
  - Private refs and command targets become parameters, and its required
    sources are declared.
  - Instantiating it gives fresh record ids, and its commands still need
    approval at each use.

**Inspecting a step** opens its detail as an ornament, in any display mode:

- its input and output (the first rows), typed by its ports;
- its last run time;
- its error.

## 6. The component library and the look

### 6.1 What the generative-UI world uses

The survey's finding: **three decisions are separate everywhere**:

- how UI is delivered;
- the schema the model composes against;
- the visual implementation.

No shared primitive library has won [doc, survey].

| Ecosystem | Model-facing catalog | Visual implementation |
|---|---|---|
| **A2UI** (0.9.1 current; 1.0 candidate) | Catalogs that the client declares, in **JSON Schema 2020-12**. The basic catalog has 18 components (Text, Image, Row, Column, List, Card, Tabs, Modal, Button, TextField, …) | Whatever each renderer uses (React, Lit, Angular stable; Flutter, SwiftUI alpha) |
| **AG-UI / CopilotKit** | AG-UI is the event protocol (zod in its TypeScript core). CopilotKit registers tool UI with `useRenderTool({parameters: z.object(…)})`. A 70-component standard catalog targeting A2UI 1.0 shipped on 2026-10-29 | `@copilotkit/react-ui` is built on **Headless UI**, with its own CSS variables |
| **Vercel AI SDK** (7.x) | None mandated. Tool parts render client components. RSC `streamUI` is not the recommended path | Bring your own |
| **json-render** (0.21) | `defineCatalog` with **zod** props and actions, kept apart from a per-platform **registry** of implementations. Specs are a flat element map, with bindings and streamed patches | Its optional shadcn package is built on **Radix** |
| **Thesys** (now OpenUI) | `defineComponent` / `createLibrary` with zod | Radix-based. The C1 SDK's licence restricts redistribution; OpenUI's react-ui is MIT |
| **MCP Apps** (ext-apps 2.0) | None. It is delivery: `ui://` resources in a sandboxed iframe, JSON-RPC over `postMessage` | Bring your own |
| **OpenAI Apps SDK UI** | None (a curated kit) | Radix and Tailwind 4 |
| **assistant-ui** | zod-described tool UI | Radix, plus **Base UI** in its current install |

**The common ground** is a catalog authored in zod, carried on the wire as
JSON Schema, and composed from a renderer-specific registry.

### 6.2 Recommendation

The owner's lean, confirmed by the survey, with one addition.

1. **No bb components in the core.** The core (`@space/ui`) is
   host-neutral.
   - bb's components live **only in the bb shell**, which is ring 0's
     panel chrome, approval chrome and host panes.
   - The kb host will have its own shell.
2. **Primitives: Base UI** (`@base-ui/react` 1.9.0).
   - It is MIT, stable since 1.0 on 2025-12-11, and maintained by MUI's
     Base UI team (whose background includes creators of Radix and Floating
     UI) [doc, survey].
   - For a greenfield catalog it is the better bet. Radix is maintained
     too, but Base UI is where shadcn's new work goes.
3. **Components: shadcn's Base UI variant, copied in and owned.**
   - shadcn officially supports Base UI: `shadcn create`, December 2025;
     today `npx shadcn@latest init --base base` [doc, survey].
   - We generate the set once, own the source in `@space/ui`, and update
     it deliberately.
   - Covered: accordion, dialog and sheet, checkbox, radio and switch,
     select and combobox, menus, popover, tabs, slider, tooltip, scroll
     area, and the plain card, table and typography.
4. **Tokens: Tailwind v4 with shadcn's semantic CSS variables**
   (`--background`, `--foreground`, `--card`, `--primary`, `--muted`,
   `--border`, `--ring`, `--radius`; the neutral palette in OKLCH; `.dark`).
   - The CSS is compiled **ahead of time** into the ring 1 bundle
     (`@tailwindcss/vite`), so there is no compiler at runtime. That means
     complete class names in source, and `@source inline(…)` for variant
     sets.
   - **Hosts map their theme onto these names.** bb's plugin UI uses the
     same shadcn semantic tokens [doc], so the bb host's mapping is close
     to identity. The kb host maps kb's tokens later.
5. **Catalog: zod for authoring, JSON Schema on the wire.**
   - Each catalog entry declares props, events/actions and slots in zod,
     emitted as JSON Schema 2020-12. That is the same schema as v2's ports
     and as A2UI's catalogs.
   - **We borrow json-render's split:**
     - the catalog holds the schemas and actions;
     - the registry holds the implementations per renderer (React in ring
       1 now; a three.js/uikit renderer for XR later).
   - We don't adopt json-render's spec tree as the scene format. The scene
     is records (§2). A card's internal layout may use a json-render-style
     spec later.
6. **The addition: A2UI at the edge.** Both sides are JSON Schema catalogs,
   so the cost is small:
   - we **export our catalog as an A2UI catalog**;
   - we **accept A2UI surfaces as an item kind**.

   Then an agent that already speaks A2UI (CopilotKit's standard catalog,
   Google's tools) can render into a space without learning ours (phase
   2).
7. **Generated UI (ring 3) uses the same library:** the same `@space/ui`
   bundle and precompiled CSS, as a fixed module map.
   - Generated code is limited to the precompiled utility vocabulary plus
     token CSS variables, since a class invented after compilation does not
     exist [doc, survey].
   - Raw HTML stays possible.
8. **Icons:** `lucide` (MIT) in the core. A host may map its own glyphs.
9. **bb's host components** (`ThreadChat`, `experimental_Diff`,
   `experimental_SourceCode`) are ring 0 **host panes**, in the bb shell
   only.
   - **A chat pane is a timeline** (`variant="timeline"`) by default.
   - The host fixes its target thread and draws that thread's name in its
     own label. A guest cannot pass any props.
   - **"Reply here" is a person-only activation** in ring 0's chrome. It
     opens an interactive pane whose target cannot change while it is open.
   - Anything a guest wants sent or stopped on another thread is a
     proposal (v3 §5).
   - At most **2 live host panes** at once; others show snapshots.
10. **The first catalog set:**
    - `record.list`, `record.card`, `record.detail`, `record.table`;
    - `board`;
    - `stat`;
    - `chart`;
    - `markdown`;
    - `image`;
    - `command`;
    - `chain`.

    Then come the bb host's record presentations, `thread.card` and
    `pr.chip`. Those are bb-host skills, not core.

### 6.3 The look

- **Default: shadcn's clean neutral look,** as it comes.
  - Surfaces are flat, with radius from `--radius`, a 1 px `--border`, and
    shadows from the elevation scale (§4.1).
  - Depth is elevation and distance; the spatial feel is motion. Nothing
    is translucent.
- **One alternative, for room mode only: "atmosphere".**
  - Items far from the focus fade slightly toward `--background` (opacity
    only), and unfocused items dim a little.
  - **Why it could earn its place:** on a curved wall seen in depth,
    shadows read weakly, and the eye needs a cue to find the focus among
    many panels. Distance fade is how depth reads in the real world, and it
    costs only opacity.
  - It keeps every surface neutral, and it is off under
    `prefers-reduced-transparency`.
  - *Default:* off. The owner tries it in phase 2.

## 7. TypeScript only, typed ports, and three code tiers

### 7.1 The policy: TypeScript only

- **Every source is `.ts` or `.tsx`:**
  - core;
  - the bb plugin;
  - skills;
  - space plugins;
  - recipes;
  - rules;
  - `space_run` scripts;
  - generated components.

  Saving a skill **refuses `.js` sources**, and the compiler runs with
  `allowJs: false`. Only `.d.ts`, `.json`, `.md` and assets may sit beside
  them.
- **Plain JS is valid loose TS, so the check on save is what enforces
  types:**
  - `strict` (with `noImplicitAny`) and `erasableSyntaxOnly`;
  - **no explicit `any`**: one walk of the syntax tree for `AnyKeyword`
    refuses it, with its line. `unknown` is the escape hatch.
- **A `space_run` script is TypeScript too,** but it is not typechecked
  when it runs (§7.6). Its types serve the model, and its runtime errors go
  back as in v3.

### 7.2 Typed ports: one zod declaration, both checks

Every card, data source and compute node declares its inputs and outputs
as **zod schemas**. Its TypeScript types come from them (`z.infer`), so one
declaration is both the runtime check and the static type.

```ts
const Thread = z.object({ id: z.string(), title: z.string(), status: z.enum(["active", "idle", "failed"]) });

export const ports = definePorts({
  inputs:  { rows: z.array(Thread) },
  outputs: { selected: z.string() },
});
type Inputs = PortTypes<typeof ports>["inputs"];       // { rows: { id: string; title: string; status: "active" | "idle" | "failed" }[] }

// Generic ports: a type parameter, bound when the wire is drawn.
export const first = defineGeneric((T) => ({
  inputs:  { items: z.array(T) },
  outputs: { item: T.optional() },
}));                                                   // T[] → T | undefined
```

- **On the wire,** a port's schema is JSON Schema 2020-12 (zod's
  `toJSONSchema`). That is the same form as v2's ports and §6.2's catalog.
  A type parameter is written `{"$typeVar": "T"}`.
- **A wire is allowed only when the output's type fits the input's.** It
  is checked in two places:
  - **Statically, for authored code.** The SDK types `connect<T>(from:
    Out<T>, to: In<T>)`, so a skill or recipe that wires a mismatch fails
    its typecheck on save (§7.6).
  - **At run time, when a wire is drawn,** by a person, P0, P1 or a
    script. The `connect` op checks the two JSON Schemas inside the
    transaction. A refusal fails the op; in a script, it fails the whole
    run, and the reason goes to the agent.
- **The run-time check is structural, and conservative.**
  - It covers a defined subset of keywords: `type`, `properties`,
    `required`, `additionalProperties`, `items`, `prefixItems`, `enum`,
    `const`, `anyOf`/`oneOf`, nullable types, and `$typeVar`.
  - It has three answers:
    - **fits:** the wire is drawn;
    - **does not fit:** the wire is refused, **with the reason** as a JSON
      pointer path and the two types, for example `rows: array of Thread
      given, Thread expected`;
    - **cannot tell** (keywords outside the subset): the wire is drawn
      only with a **validating adapter**, where the input port's zod schema
      checks every value. A failing value marks the wire as an error, and
      the downstream keeps its last good value.
  - **Generics unify** at connect time. Wiring `Thread[]` into
    `first.items` binds `T = Thread`, so `first.item` is a `Thread`
    downstream.
- **Adapters are offered.**
  - When a wire is refused, `connect` searches the catalog's adapters for
    one, or a chain of at most two, that bridges the types:
    - `first: T[] → T`;
    - `wrap: T → T[]`;
    - `pick<K>: T → T[K]`;
    - `map(pick)`;
    - `count: T[] → number`;
    - `toText: T → string`.
  - The adapters are ordinary generic components.
  - By voice: "connect 2 and 3" → "That gives a list of threads, and it
    takes one thread. Use the first one?"
- **zod still guards run time,** since stripped types vanish and data from
  sources and guests is untrusted:
  - a component's props are validated on mount and on every update;
  - a value crossing a wire is validated by the input port;
  - a source's answer is validated where it enters.

### 7.3 Three code tiers, copying kb's model

kb already has this model, and its two engines. Space reuses them rather
than rebuilding them [doc, kb `DESIGN.md` → Sandbox → Engines, Trust,
Limits; `packages/app/runtime/src/extension-closure.ts`;
`packages/infrastructure/sandbox-{quickjs,worker}`].

| Tier | What | How it is built | Who trusts it | Where it runs |
|---|---|---|---|---|
| **a · core and the bb plugin** | `@space/*` and the bb host and shell | TS, built by bb on install (`bb plugin build`) | The repo's review | Rings 0, 0′ and 1 |
| **b · installed skills and space plugins** | A TS package: its components, transforms, rules, recipes | **Bundled into one closure,** as kb's extension closure is. Host modules (`@space/sdk`, `@space/ui`, `react`, `zod`) are left for the runtime to provide, and the bundle is refused if it mentions a way to load code it does not hold (kb's `LOADS_CODE` list: `import()` of a non-literal, `eval`, `Function`, `Worker`, and the rest) | **The owner, by its digest** (SHA-256 of exactly the closure's bytes and its grant), per machine. This is v3's "promotion" | Trusted components in ring 1. Its scripts and rules in the **Worker** engine (ring 2) |
| **c · live agent code** | `space_run` scripts, draft components, draft rules | **Types stripped** with sucrase on the plugin server (§7.4); drafts are bundled too, so they have a digest | Nobody yet | **QuickJS-wasm** when untrusted, the **Worker** engine once its digest is trusted. Draft components render in ring 3 |

- **The engines are kb's.**
  - `@kb/sandbox-quickjs` and `@kb/sandbox-worker` sit behind one engine
    port and one capability API.
  - Limits per turn: 500 ms and a 32 MB heap in QuickJS; 5 s in a Worker
    [doc].
  - Space forks them with `@kb/sandbox` (v3 §3.1).
- **QuickJS runs inside a blob Worker** in ring 2, never on the frame's main
  thread.
  - That is the fix kb names for its own gap (QuickJS on the frame's main
    thread can hold it for 500 ms). Space starts with it.
  - The Worker gives a kill switch; QuickJS gives the memory cap.
- **Code that runs on its own must be trusted first.** kb's rule is that
  a script never runs untrusted, because nobody is watching it [doc]. So
  **a rule is enabled only once its digest is trusted.**
  - This is stricter than v3 §4.1, where draft rules ran within budgets.
  - A `space_run` script runs untrusted in QuickJS, because it runs once,
    inside a turn someone asked for.
- **Trust changes the engine and its limits, never the capabilities.** A
  trusted run has the same API, the same grant and the same command gate
  (v3 §5) [doc, kb's model].
- **Digests depend on the bundler.** A closure built by esbuild on the bb
  host and by `Bun.build` on the kb host has different bytes, so it is
  trusted separately on each host, as kb's trust is already per machine.
  Both bundlers pass one closure contract suite, so they refuse the same
  things.

### 7.4 Where bundling and stripping run, and what they cost

- **Both run on the plugin server,** where every script and skill
  arrives.
  - **Never in the page.** esbuild-wasm is 12 MB to load into a frame, and
    a digest must be computed by the host over exactly what runs, never by
    the guest.
  - The kb host uses `Bun.build`, as kb's closure already does.
- **Bundling** (tier b, and drafts in tier c) uses **native esbuild** on
  the plugin server. If bb's plugin install cannot take esbuild's native
  binary [unverified], it falls back to **esbuild-wasm** on the same server.
  It runs only on save, promote and install, never on the reaction path.
- **Stripping** (tier c) uses **sucrase**:
  - It is pure JS, and it keeps line numbers [measured: both samples kept
    their line counts]. So a runtime error points at the line the agent
    wrote.
  - Node's built-in `module.stripTypeScriptTypes` was as fast, but it is
    still experimental on Node 24. It can take over behind the same
    stripper contract later.
- **Only erasable syntax** (TypeScript's `erasableSyntaxOnly`): no enums,
  runtime namespaces, parameter properties or decorators. Stripping is then
  purely removing types, and any conforming stripper gives the same
  JavaScript.

**Measured today on shared-server.** The setup: Node 24.20, 16 cores, a
load average of about 4.8, `nice` 15, `process.hrtime`. Each figure is the
median, with p95 in brackets. The harnesses and samples are in the design
thread's storage (`v3/`).

| Step | Warm | One-time |
|---|---|---|
| sucrase strip, a 15-line `space_run` script | **0.12 ms** (0.46) | 31 ms to load; 7.9 ms for the first call |
| sucrase strip, a 49-line component | 0.54 ms (0.98) | — |
| Node 24 `stripTypeScriptTypes`, the same two | 0.11 ms, 0.30 ms | 39 ms for the first call; experimental |
| **QuickJS-wasm: a fresh 32 MB runtime, then run the stripped script against a stub API (7 ops)** | **0.59 ms** (1.02) | 17.7 ms to start the module; 13 ms for the first run |
| **Bundle a skill closure** (2 files, host modules left out) with native esbuild | **8.9 ms** (10.6) | 6 ms to start; 19.5 ms for the first build |
| The same with esbuild-wasm, on the server | 70 ms (86) | 414 ms for the first build |
| SHA-256 digest of that closure | < 0.5 ms | — |
| **Full typecheck**: API typings + script + component, `strict`, lib es2022 + dom | **164 ms** (221), reusing the program | 357 ms cold |
| For comparison: TS `transpileModule`; esbuild-wasm `transform` | 1.5 ms; 3.4 ms | 181 ms to load; 17 ms to start |
| sucrase bundled for a browser | 201 KB minified, 46.5 KB gzipped | (why it stays on the server) |

**So the fast path is untouched:**

- P0 and P1 run no code (v3 §4.3).
- **A P2 script costs about 1–2 ms** in strip plus QuickJS, against P2's
  20–30 s.
- Bundling and typechecking happen only on save, promote and install,
  where 10–400 ms is invisible.
- The QuickJS module starts once, inside a prewarmed worker. These are
  Node figures; the browser's QuickJS in a worker is the same wasm, and
  phase 1a measures it there.

### 7.5 Typings for the model

- **`space-api.d.ts`** is generated from the core's own TypeScript source,
  so it cannot drift from the API. It covers:
  - the `space` proxy;
  - the record types (§2.1);
  - the ops;
  - `definePorts`;
  - `propose`.
- **Per-space declarations are generated too:**
  - each granted source's input and output types, from its port schemas;
  - each catalog component's ports (`z.infer`).

  The model then writes `space.source("bb.threads", …)` and gets a typed
  `Thread[]` back.
- **How the model receives them:**
  - a condensed form in `contributeInstructions`, only for threads with a
    space (about 1.5k tokens [estimate]);
  - the full form through `space_describe({types: true})`.

### 7.6 A full typecheck, only on save or promote

- **When:** a skill, space plugin, rule or recipe is saved or promoted.
- **How:**
  - a TypeScript 5.9 program with `strict`, `erasableSyntaxOnly`,
    `allowJs: false`, `noEmit` and `skipLibCheck`, the API typings and the
    space's declarations, plus the `any` walk (§7.1);
  - in a worker thread on the plugin server;
  - the program is reused between checks, so a check takes about 160 ms
    warm.
- **Errors go back for self-repair** as `file:line message`, for example
  (measured): `bad.ts:1 Type '"nowhere"' is not assignable to type 'Near |
  undefined'.`
  - A skill with errors is saved as a draft marked `typecheck: failed`.
    **It cannot be promoted**, so its digest is never offered for trust.
- **Promotion typechecks the whole dependency closure** (§5's recipes),
  against the pinned versions.
- **Mismatched wires in authored code fail here,** through `connect<T>`
  (§7.2).

## 8. Phases

| v3 phase | Adds |
|---|---|
| 1a spike | <ul><li>The record store in the opaque frame, with its gzipped size measured against 40 KB</li><li>Theme tokens over the port</li><li>The frame's own bundle (React, Base UI, `@space/ui`, the compiled Tailwind CSS)</li><li>Spring cost on the laptop and phone</li></ul> |
| 1b-i · workspace | <ul><li>The thread binding (§1): panel action, keyed storage, the metadata pointer, lifecycle handlers, start-up reconciliation</li><li>The record store with scopes, side effects and migrations; the diff log; snapshots in git; diff-based undo</li><li>**Workspace parity (§3):** the fork's tools and verbs on records, plus eraser, half-bound arrow, rich and auto-size text, note, duplicate, z-order actions, copy and cut as records, copy as SVG/PNG, assets and upload, export SVG/PNG/JSON</li><li>Item shell with springs, hover, press and elevation</li><li>Base UI, `@space/ui` and the zod catalog</li></ul> |
| 1b-ii · compute | <ul><li>Tools scoped by `threadId`</li><li>TypeScript only (§7): sucrase on the server, typed zod ports with the structural wire check and generics, the three code tiers on kb's forked engines (QuickJS in a blob Worker), closure bundling with esbuild and trust by digest, the generated typings, typechecks on save, the stripper and closure contract suites</li><li>Bindings, sources, the scheduler</li><li>Chains in `output` and `expanded` modes, flat</li><li>The first catalog set</li><li>The 60 fps budget, measured by hand from a trace</li></ul> |
| 2 | <ul><li>DOT-3's mic on any thread</li><li>Parallax, focus by dwell, ornaments, camera flights, the room morph, "atmosphere" to try</li><li>Chains in `pinned` mode and unfolding in depth</li><li>Recipes</li><li>Host panes</li><li>Website items</li><li>The `.tldr` import on records</li><li>A2UI catalog export and A2UI surfaces</li></ul> |

## 9. Open questions, each with my default

1. **Adopt `@tldraw/store`, or write our own store?** *Default:* adopt it,
   pinned, if it fits 40 KB gzipped in 1a. Otherwise write our own, with
   the same shapes.
2. **May a thread have several spaces?** *Default:* no: one, with pages. A
   fork makes another.
3. **Does a plain bb fork copy the space?** *Default:* no. It offers "Bring
   the space"; "Fork with space" copies it.
4. **What happens to a deleted thread's space?** *Default:* the trash for 7
   days.
5. **Which rich text editor?** *Default:* Tiptap (MIT core, as tldraw
   uses), with marks limited to bold, italic, code, link and lists.
6. **A2UI interop?** *Default:* export our catalog and accept A2UI surfaces
   in phase 2.
7. **The "atmosphere" look?** *Default:* off; the owner tries it in phase 2.
8. **What does a new chain show?** *Default:* `output`, with the chain chip.
9. **Can a voice switch targets mid-turn?** *Default:* no. The switch ends
   the open turn, and the next utterance goes to the new target.
10. **Which TypeScript stripper?** *Default:* sucrase. Node's built-in
    stripper can take over behind the same contract once it is no longer
    experimental.
11. **Typecheck `space_run` scripts as well?** *Default:* no: only on save
    or promote, as the owner asked. A `space_check` tool can be added if
    runtime errors prove too costly for the agent.
12. **Native esbuild or esbuild-wasm on the bb host?** *Default:* native,
    if bb's plugin install accepts esbuild's platform binary (checked in
    1a). Otherwise wasm (70 ms warm), since it runs only on save.
13. **What may a wire do when compatibility cannot be told?** *Default:*
    it is drawn with a validating adapter, never silently.

## Sources

- **bb Plugin SDK guide**, as shipped with the running bb:
  - `frontend-core-slots.md`: `threadPanelAction`;
  - `frontend-hooks-and-ui.md`: vendored shadcn, runtime shims and theme
    tokens;
  - `frontend-components.md`: `ThreadChat`, `Diff` and `SourceCode`;
  - `backend-sdk.md`: plugin metadata, `threads.fork` seeds and
    `sourceThreadId`;
  - `backend-events.md`: the thread lifecycle events, with no replay;
  - `backend-foundation.md`: `bb.storage`;
  - `backend-cli-agents.md`: the tool context's `threadId`.
- **The component and store survey** (GPT-6.1 Sol, 2026-11-03), in the
  design thread's storage (`v3/survey.md`), not committed. Its primary
  sources include:
  - [the `@tldraw/store` 5.6.0 licence](https://unpkg.com/@tldraw/store@5.6.0/LICENSE.md),
    [RecordsDiff](https://tldraw.dev/reference/store/RecordsDiff),
    [RecordScope](https://tldraw.dev/reference/store/RecordScope),
    [createMigrationSequence](https://tldraw.dev/reference/store/createMigrationSequence),
    [HistoryManager](https://tldraw.dev/reference/editor/HistoryManager);
  - [Base UI releases](https://base-ui.com/react/overview/releases);
  - [shadcn create](https://ui.shadcn.com/docs/changelog/2025-12-shadcn-create),
    [the shadcn CLI](https://ui.shadcn.com/docs/cli);
  - [Tailwind v4 theme](https://tailwindcss.com/docs/theme);
  - [A2UI catalogs](https://a2ui.org/concepts/catalogs/);
  - [CopilotKit generative UI](https://docs.copilotkit.ai/concepts/generative-ui-overview);
  - [json-render](https://json-render.dev/docs);
  - [MCP Apps](https://apps.extensions.modelcontextprotocol.io/api/documents/overview.html).
- **kb:** `docs/research/2026-10-28-canvas-tldraw-parity.md` (parity with
  tldraw, member by member); `DESIGN.md` → Canvas documents (export,
  import); `packages/extension/canvas/src/shapes.ts`;
  `packages/extension/canvas-ui/src/{canvas-paste,canvas-history,canvas-keymap}.ts`.
- **TypeScript tooling:**
  - sucrase 3.35.1 (https://github.com/alangpierce/sucrase);
  - TypeScript 5.9.3 (`erasableSyntaxOnly`);
  - esbuild-wasm 0.25.12;
  - Node 24 `module.stripTypeScriptTypes`;
  - esbuild 0.25.12 (native);
  - quickjs-emscripten 0.31.0.

  The measurements and harnesses are in the design thread's storage:
  `v3/ts-measurements.json`, `v3/bundle-bench.cjs`, `v3/qjs-bench.cjs` and
  `v3/skillpkg/`.
- **kb's code-tier model:**
  - `DESIGN.md` → Sandbox (Engines, Trust, Limits);
  - `packages/app/runtime/src/extension-closure.ts`;
  - `packages/infrastructure/sandbox-quickjs` and `sandbox-worker`.
- **DOT-3** (bb task): voice on any thread.
- **visionOS:** Apple's Human Interface Guidelines (depth, ornaments, the
  hover effect, motion),
  https://developer.apple.com/design/human-interface-guidelines/designing-for-visionos
