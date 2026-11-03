# A spatial, generative canvas for the voice concierge (v3 delta)

Date: 2026-11-03. Design only: nothing here is built. This is a **delta** on
[v2](2026-11-02-spatial-generative-ui-v2.md), not a rewrite. Everything in
v2 holds unless §0 says otherwise:

- the room projection and its contract;
- presets;
- typed ports and push/pull;
- level of detail (LOD) and budgets;
- the three speed paths and the turn record;
- dependency-aware invalidation.

**The owner's direction (condensed).**
1. The experience should feel like
   [space-agent](https://github.com/agent0ai/space-agent):
   - it keeps reshaping the space;
   - it writes UI, or composes it from a library of dynamically loaded
     skills that keeps growing (one extension point);
   - it connects to the data sources a space has.
2. **Not kb-tied.** kb's canvas has many of the building blocks, but it is a
   static diagramming tool (with powerful scripting). Fork it, evolve the
   fork into the spatial thing, and decide nothing about the original
   canvas.
3. The first usable place is a **bb plugin**, kept portable back to kb.

Claim tags as in v2:

- **[measured]**: counted or observed today.
- **[doc]**: source or documentation read today. kb is `origin/main`
  `6c6da7dc`; space-agent is `10f4ffd`.
- **[estimate]**: a guess, to be measured.
- **[inferred]**: a conclusion not demonstrated.

## 0. What changes from v2

| v2 | v3 |
|---|---|
| The engine lives in kb; the scene is a kb canvas node | The engine is **space**, a standalone runtime forked from kb's canvas. kb becomes one host adapter (§3) |
| A placed component is a kb view node; bindings are node fields | A component comes from the **skill library**; its params and bindings live in the scene document (§4) |
| Sources are kb read actions with a feed; the bb source is a kb family | **Same contract shape** (`ReadAction + ChangeFeed`, v2 §3.3), owned by the space host. bb's source lives in the bb host, so kb needs no bb credentials |
| Commands wait until kb restores approval enforcement | Commands go through the **space host's own gate** on the plugin server (§5). kb's actions, once kb is a host, also pass kb's guard |
| P2 fills a ghost through `kb_call` | P2 **acts in plain JS** through `space_run`, as one transaction (§4.1) |
| No new agent tools | Two: `space_run` and `space_describe`, registered by the space plugin |

The v2 sections on speed (§7), heavy items (§6.1), presets (§5) and the room
contract (§3.1) carry over to the fork unchanged.

## 1. Recommendation

1. **Space-agent: borrow its patterns, take no code.** Read in source by a
   GPT-6.1 Sol thread
   ([study](#sources): 232 lines, with file:line citations).
   - **What it is:** a private Node app with its own server, users, groups,
     filesystem store and Alpine front end. The agent's reply carries
     JavaScript after a `_____javascript` line, and the page runs it as an
     `AsyncFunction` in **the main page realm** (`with (scope)`, a Proxy
     that falls through to `window`). Persisted widget renderers are
     `(0, eval)`'d in the same realm [doc].
   - **That is full page authority:** the DOM, fetch, storage, the user's
     session, decrypted API keys, and an unfiltered `/api/proxy` to any
     HTTP(S) host [doc]. Its authors chose this on purpose. Inside bb, it
     would hand every model reply bb's session.
   - **Activity:**
     - MIT at the root (its dependencies carry mixed licences).
     - 1,417 stars and 3 contributors.
     - 101 commits, 88 of them in April. **No commits since 2026-06-08.**
     - Last release v0.66, 2026-04-30 [doc].
   - **So:** embedding means a second server, store, auth and agent loop,
     isolated cross-origin. Forking it means owning all of that, plus
     building the sandbox it lacks. Neither pays.
   - **What we borrow** is in §4. It is the shape of the loop and of the
     library, not the authority model.
2. **Fork kb's canvas into a standalone runtime, `space`** (the coordinator's
   view, which holds).
   - The fork has **small ports** (§3): scene storage, assets, data
     sources, commands, components (skills), references and look.
   - **kb becomes a first-class host adapter:**
     - storage: a `sys.f.canvas` field;
     - sources: kb's read actions;
     - commands: kb's write actions;
     - components: kb views.
   - kb's own canvas is **left alone**, and may adopt the scene format
     later (§3.3).
   - The fork is cheap because the core is already mostly pure: **31 of
     `@kb/canvas`'s 43 source files import nothing from kb** [measured].
3. **Ship it first as its own bb plugin, `space`.**
   - The space plugin gives the surface (a panel that goes full screen),
     the bb host and the two agent tools.
   - The voice concierge's second mode **opens and drives** that surface.
     Its P0 router stays in the concierge (it owns the transcript stream)
     and calls the space plugin over RPC.
   - The concierge needs no kb running.
4. **The agent acts in plain JS, but never in the page's realm.**
   - A script calls a `space` API. It runs in a worker inside an
     opaque-origin frame, and its calls become scene ops: **one script, one
     transaction, one undo step, one history commit**.
   - Generated UI runs in nested sandboxed frames. Commands only *propose*;
     approval happens on the plugin server (§5).
5. **The library grows; the fast path grows with it.**
   - Skills are `SKILL.md` plus an optional component, in three layers:
     built-in, the owner's, and the space's.
   - A skill may declare **intents**: phrase patterns mapped to op
     templates, as data. The P0 router learns them without new code.
   - Composed UI stays on the fast path. Generated UI is the slow path, and
     **"keep this" turns it into a skill**, so the next ask composes it.

## 2. Space-agent, pattern by pattern

| Pattern (space-agent) | Verdict | In space |
|---|---|---|
| Agent acts by writing JS, not tool-call JSON (`onscreen_agent/execution.js:98–133,251–265`) | **Borrow the language, not the realm** | A script against a `space` API, in a worker, applied as one transaction (§4.1) |
| Persisted widget renderer source, `eval`'d on open (`spaces/store.js:2657–2662`) | **Borrow persistence; reject in-realm eval** | Generated components persist in the space and always render in a nested sandboxed frame (§5) |
| Readback: the current widgets and their source go into the next prompt (`spaces/prompt-context.js`) | Borrow | `space_describe`: kb's `describe.ts` (forked), plus handles, the skill index and the last errors |
| Execution output and errors become the next turn, so the agent repairs (`store.js:5357–5392`) | Borrow, plus rollback | A throw rolls the transaction back, so the last working UI stays, and the error goes to the agent |
| Renderer cleanup contract (`store.js:2729–2754`) | Borrow, enforced | LOD demotion (v2 §6.1) disposes renderer resources; the sandbox frame is torn down |
| `SKILL.md` with frontmatter, a compact catalog, explicit load, context-conditioned eligibility (`skillset/skills.js`) | Borrow | §4.2 |
| L0 / L1 / L2 override layers (system, group, user) (`customware/overrides.js:36–85`) | Borrow, without groups | built-in < owner < space |
| Agent writes new skills by file write | Borrow, bounded | Space-layer skills are drafts, usable at once in their space; promotion needs the person |
| Git history per owner: 10 s debounce, fixed author `Space Agent`, `reset --hard` rollback with preserved refs (`git_history.js`) | Borrow git; change the unit | A commit per transaction, authored by the actor (person, voice or agent), with the utterance as its message |
| Model called from the browser with a Bearer key (`onscreen_agent/api.js:214–220,328–354`) | **Reject** | Models run on the server (the concierge thread, P1); the page holds no key |
| Unfiltered authenticated `/api/proxy` (`server/router/proxy.js`) | **Reject** | No network from the space frame at all; sources resolve on the plugin server |
| Users, groups, its own auth server | Reject | bb's owner is the user |
| Connectors | Nothing to borrow: there is no connector contract (widgets `fetch`) [doc] | v2's source contract stands |

## 3. The fork

### 3.1 What we fork, cut and leave

| kb package (files / lines [measured]) | Fork into | Cut | Seam |
|---|---|---|---|
| `@kb/canvas` (43 / 10,598): pure model and geometry | **`@space/scene`**: box, transform, rotation, camera, pick, snap, arrange, place, presets, connect, edges, paths, membership, relations, shapes, style, paint, edit, describe, lint, links, ids, index, clip, pages, world, `doc` and `flow` (rewritten) | `tldraw.ts`, `mermaid.ts`, `diagram.ts`, `comments.ts`, `seed.ts`, `promote.ts`, `references.ts`, `view.ts`, `extension.ts`, `svg.ts` (export stays kb's) | The 12 coupled files take `KbNode`, `SYSTEM_IDS`, seeded fields, asset paths and view ids from `@kb/model`. **`doc.ts`** (834 lines) is the one real rewrite: decoding no longer goes through a node. **`flow.ts`** becomes v2's typed live engine |
| `@kb/scene` + `@kb/scene-gpu` (19 files) | **`@space/stage`**, whole: the three.js WebGPU stage, one post chain and frame loop, rig, pointer field, offscreen pass, screen geometry (`onFacingPlane`, `pixelsPerUnit`, `toScreen`) | starfield, lab-only pieces | Five `@kb/ui-sdk` utilities (timing and approach, easing, pointer slop, `djb2Hash`, `readTokenColor`) are copied into `@space/kit` |
| `@kb/canvas-ui` (114 / 19,371) | **`@space/surface`**, in part: camera and rig, gestures, pointer and touch, selection, resize and transform guides, edge and card layers, **faces** (`canvas-face*`, `canvas-face-pictures`, `canvas-capture`: snapshot faces already exist), visibility culling (`canvas-visible`), the 3D stage and `canvas-scene-*`, projections, history, keymap, full screen, media, image and link cards, ports | comments, node picker, item inspector, outline rows, list and page strip, dock, style panel, toolbar and tool sheets (space is agent-first: a small palette later), `plugin.ts`, `routes.ts`, `surfaces.tsx`, `canvas-handover`, `canvas-view-widget` | `OutlineNode`/`useNodes`/`NodeMap` (20 + 4 + 2 imports) become the **refs** port. `browserHost().invoke("ext.canvas.tx.apply")` and `readCanvasDoc(node)` (`canvas-api.ts`) become the **scenes** port. `assetSrcUrl` becomes **assets**; `cn`, timing and tokens become `@space/kit` |
| `@kb/sandbox` + its QuickJS and Worker engines | **`@space/sandbox`**: one capability API over the MCP Apps JSON-RPC dialect, `runGuest`, drawing as data | kb's grant semantics (`CodeGrant`, `scriptRefusal`) stay kb's; the kb host maps to them | Its only kb imports are `KbNode` (a type) and `canonicalJson` |
| `@kb/ext-canvas` (13 / 2,910): actions over `@kb/operations` and `@kb/query` | **Not forked.** It *is* the kb adapter's model for phase 3 | — | — |

**What stays only on kb's canvas:**

- diagramming tools;
- tldraw and Mermaid import;
- comments;
- the outline integration;
- SVG and docs export;
- `canvas.run` over kb nodes.

None of it is needed for an agent-reshaped space.

**Drift.** Each forked file's header names the kb commit it came from, and
`FORKED.md` keeps the table. Geometry fixes are ported by hand in either
direction. No automatic sync, because the two are meant to diverge.

**3D is mostly there.**

- kb's canvas already has a `3d` projection on `@kb/scene-gpu`'s stage
  (`canvas-3d-stage.tsx`, `canvas-scene-*`), with pick rays and snapshot
  faces drawn as textures.
- **`room`** (v2 §3.1) becomes the fork's third `CanvasProjectionKind` on
  that stage.
- The new piece is a **CSS3D layer** for live DOM faces, since a WebGPU
  texture cannot hold a live frame.

### 3.2 The host port

The forked code reaches the world only through this. Each member is one
contract, with a contract suite every host passes (kb's "One contract, every
implementation").

```ts
interface SpaceHost {
  scenes:   { read(id): Promise<SceneDoc & { rev }>; subscribe(id, onRev): Unsubscribe;
              apply(id, tx: SceneTx, meta: { actor: Actor; turn?: TurnId; note?: string }): Promise<Receipt> };
  assets:   { put(bytes, mime): Promise<AssetRef>; url(ref): string };             // media, snapshots
  sources:  SourceRegistry;   // v2 §3.3 unchanged: ReadAction + optional ChangeFeed, one subscription hub
  commands: { propose(action, input, meta): Promise<PendingApproval>; status(id): Promise<…> }; // §5: never execute
  skills:   { index(): SkillCard[]; load(id, layer?): Promise<Skill>; save(draft, layer: "space"): Promise<SkillRef> };
  refs:     { resolve(ref: { source: string; id: string }): Promise<RecordView>; subscribe(ref, on): Unsubscribe };
  look:     { token(name): string; timing(name): Timing };
}
type Actor = "person" | "voice" | { agent: "P1" | "P2"; turn: TurnId } | { rule: RuleId };
```

- **The bb host** (phase 1) runs in the space plugin.
  - **scenes:** a folder per space (`scene.json`, `skills/`, `assets/`)
    with git: a commit per applied transaction, batched per turn, authored
    by the actor.
  - **sources:** bb's threads, thread, PR status and environments, from
    one in-memory cache that `bb.sdk.subscribe` keeps current (v2 §7.3).
  - **refs:** bb records.
  - **assets:** files under the space.
- **The kb host** (phase 3) is a kb extension:
  - **scenes:** a `sys.f.canvas` field, written through `tx.apply`;
  - **sources:** kb's read actions, with the transaction tail as the feed
    (v2 §7.5's dependency-aware invalidation pays off here);
  - **commands:** kb's write actions under kb's guard;
  - **skills:** kb's view catalog as built-in components;
  - **refs:** kb nodes.

### 3.3 Staying portable to kb

- **One scene format, versioned (`space/1`), shaped like kb's `CanvasDoc`.**
  The same pages, items, edges, frames and transforms. New things are
  extra fields, which kb's canvas already keeps when it doesn't know them
  [doc]:
  - `projection: "room"`;
  - component `{skill, pin, params, bindings}`;
  - rules.
- **The one renamed item kind is the reference.** kb's `kb-node` item
  becomes `ref {source: "kb", id}`. A converter maps it both ways, and a
  round-trip fixture suite runs in both repos. A space with only kb refs
  opens in kb's canvas as a diagram, with its components shown as cards.
- **Rule 1 holds by direction, not by sharing.** There is one engine per
  purpose: kb's for diagrams, space's for live spaces. If kb later wants
  live spaces, its canvas *adopts* `@space/scene` instead of growing a
  second engine. That decision is kb's and is not needed now.

## 4. The agent loop

```
turn (voice / typed) ─► P0 reflex (intents, incl. skill intents) ─► scene ops            (no model, v2 §7.2)
                    ├─► P1 fast model ─► a composition (skill + params + bindings) as ops (no code)
                    └─► P2 concierge thread ─ space_describe ─► reads scene, handles, skill index, errors
                                             └ space_run(script) ─► worker ─► one transaction ─► receipt/errors
data events ─► live bindings re-run (no model) ─► rules (agent-written JS, no model) ─► transactions
```

### 4.1 Acting in plain JS

```ts
// What P2 sends with space_run. The worker's `space` is a proxy; every call is an op in one transaction.
const prs = await space.source("bb.threads", { where: { pr: "open" } });   // a once read, granted per space
const board = space.place("skill:board", { near: "focus", params: { groupBy: "status" } });
space.bind(board, "rows", { action: "bb.threads", input: { where: { pr: "open" } }, mode: "live" });
for (const t of prs.slice(0, 3)) space.place("skill:thread.card", { in: board, ref: { source: "bb", id: t.id } });
space.arrange(board, "kanban");
```

- **One script is one transaction:** one undo step and one git commit, with
  the receipt (the ops, their ids, the timing) returned to the caller.
  - A throw, a budget breach (2 s CPU and 500 ops [estimate]), or an op the
    scene refuses (lint, a port type mismatch) **rolls everything back**.
    The error goes to the agent, as space-agent does, but the last working
    UI stays.
- **Why a worker and ops, not DOM edits:**
  - A DOM edit exists in one projection only. An op exists in flat, room
    and phone alike, and it can be undone, diffed and synced.
  - A worker can be killed. A `while(true)` in space-agent's realm freezes
    the page [inferred, Sol §3].
- **"Keeps reshaping" without a model in the loop:**
  - Live bindings re-run on their feeds (v2 §3.4).
  - **Rules** are agent-written scripts with a trigger: a binding's change
    or a timer. One example: "when a PR here merges, move its card to Done".
    Rules run in the same worker, each run is one transaction with actor
    `{rule}`, and each has an op budget.
  - **A rule never wakes a model.** It may place a "needs you" card, which a
    person or the next turn acts on.

### 4.2 The skill library

```yaml
# skills/thread-card/SKILL.md (frontmatter)
name: thread.card
description: One bb thread as a card: status dot, title, PR chip, latest reply.
kind: component            # component | layout | pattern | recipe
ports: { inputs: { thread: { $ref: "bb#/Thread" } }, outputs: { selected: { type: string } } }
intents:                   # data for the P0 router, never code
  - match: "show (thread|number) {handle}"
    ops: [{ place: "skill:thread.card", ref: "{handle}", near: "focus" }]
when: { sources: ["bb"] }  # eligibility, as space-agent's context tags
```

- **The body** is instructions and examples for the model (progressive
  disclosure). The index (name, description, kind) is always in P2's
  context; the body is loaded on demand.
- **The component** (`component.js`, optional) renders the skill.
  - Built-in and owner-layer components are reviewed code. They render
    in the space frame's realm (fast, no nested frame).
  - Space-layer components are agent-written and always render in a
    nested sandbox (§5).
- **Layers:**
  - built-in: the `space` repo, reviewed;
  - owner: a folder the owner keeps in git, changed only by commits the
    owner approves;
  - space: drafts the agent wrote, living in that space.

  The higher layer overrides the lower (built-in < owner < space).
  **Promotion** from space to owner is a commit the person approves. It is
  the only way agent code becomes trusted.
- **Pinning:** an item records `skill@contentHash`. Editing a skill never
  changes an existing space silently; the runtime offers an update.
- **Generated, then composed:**
  1. P2 writes a component (slow, sandboxed) and places it.
  2. "Keep this" saves it as a space-layer skill.
  3. Promotion makes it composable everywhere, by P1 and, through its
     intents, by P0.

  The library is how slow asks become fast ones.

### 4.3 Speed survives

| Path | Runs agent code? | Cost |
|---|---|---|
| P0 reflex (with skill intents) | No: ops on the runtime's main thread | v2's local callback timings: 33–101 ms median [measured, v2 §7.4] |
| P1 composition | No: ops naming reviewed skills | v2's P1 budget, ≈ 1 s [estimate] |
| Live bindings | No: built-in transforms and reviewed views | as v2 |
| Rules | Yes, in a **prewarmed** worker | worker start-up [estimate: tens of ms], off the reaction path |
| P2 script / generated component | Yes: a worker, then a nested frame from a **prewarmed pool** | negligible next to P2's 20–30 s; the ghost is placed at dispatch (v2 §7.2) |

The rule that keeps it fast is the one that keeps it safe: **the fast paths
compose reviewed things and never run new code.**

## 5. Security: whose code runs where, with what reach

| Ring | What runs there | Whose code | Reach |
|---|---|---|---|
| **0 · bb app shell** | The space plugin's frontend: the broker, the **approval UI**, the full-screen chrome | The space repo, reviewed | bb's session ("full-trust, same-origin page code, not a security sandbox" [doc, bb plugin guide]). Holds no source tokens |
| **0′ · plugin server** | The bb host: sources, the command gate, storage, git; the kb token in phase 3 | The space repo, reviewed | Every credential. The only place a source resolves or a command executes |
| **1 · space frame** | The runtime, the projections, built-in and owner components | Reviewed | An opaque origin. **No** session, cookies, keys or network. Talks only by `postMessage` to ring 0 |
| **2 · script worker** | P2 scripts and rules | The agent | The `space` proxy only. Its effects are scene ops and `propose()` |
| **3 · component sandbox** | Space-layer (generated) components, raw HTML | The agent, or a shared space | A nested opaque frame per live component (within v2's live budget). Data in through its bindings, events out, commands only as proposals |
| **4 · websites** | Framed third-party pages | Anyone | Cross-origin, as v2 §6.1 |

**How the rings are made.**

- **Ring 1** is an `<iframe sandbox="allow-scripts">` (no
  `allow-same-origin`), loaded **from a URL** that the plugin serves with its
  own CSP:

  ```
  default-src 'none';
  script-src <the plugin's asset URL> 'wasm-unsafe-eval';
  worker-src blob:;
  connect-src 'none';
  img-src data: blob:;
  frame-src <sandbox URL> <allowed sites>;
  form-action 'none';
  ```

  It is not a `srcdoc` or `blob:` document, because those inherit the
  parent's CSP.
  - No `unsafe-eval` is needed. A script runs as a `blob:` worker whose
    source *is* the script, as kb's Worker engine already does
    (`sandbox-worker/src/index.ts:116`) [doc]. QuickJS needs only
    `wasm-unsafe-eval`.
  - A `blob:` worker inherits ring 1's opaque origin and CSP, so it gets no
    network either.
  - Ring 3 is the same recipe, one level down.

**Rules the rings enforce.**

- **Reads:**
  - A component sees what its bindings deliver, and nothing else.
  - A script sees the scene, plus the sources the space was granted. Each
    space has an allowlist of sources; a new one is a command.
- **Writes:**
  - Scene ops are local to the space and undoable, so they need no
    approval.
  - **Anything outside the scene is a command:** telling a thread, merging
    a PR, writing to kb, opening an origin not on the allowlist.
  - Rings 1–3 can only `propose`. The server creates v2's pending approval
    `{actionId, inputDigest, revision, expiresAt≈20 s, used}`.
  - Only the person approves: a press in ring 0's UI, whose text ring 0
    renders from the server's record (not from what a component drew), or
    a spoken "yes", matched on the server's transcript stream (v2 §3.5).
  - No code in rings 1–3 can approve.
- **Exfiltration:**
  - Network, navigation, popups and forms are closed by the CSP and the
    sandbox.
  - **The residual channel is a website frame's URL.** A script could
    encode data into a link it opens. So scripts open websites only on the
    space's origin allowlist, anything else is a command, and every frame
    URL is in history.
- **Injection:**
  - Source data (thread text, PR bodies, web pages) and space-layer skills
    are untrusted instructions to the model. The defence is the gate, not
    trust in the agent.
  - Only built-in and owner skills are trusted context.
  - A poisoned shared space can, at worst, draw wrong things inside its own
    frames and propose commands.

## 6. Phases (replaces v2 §9)

| Phase | Scope | Exit criterion | Size [estimate] |
|---|---|---|---|
| **0** | v2, plus this delta | The owner confirms the defaults in §7 | done |
| **1 · Fork, flat, bb** | The space repo and its `AGENTS.md` (which links kb's shared rules). Fork `@space/scene`, `@space/kit`, `@space/sandbox`, and the flat parts of `@space/surface`. `SpaceHost` and its contract suite. The bb host (folder + git, bb source and cache, assets). Rings 0–2. The space plugin (panel, full screen, `space_run`, `space_describe`). The concierge opens and drives it (P0 over RPC, with the turn record). Built-in skills: list, card, detail, board, stat, markdown | v2 phase 1's asks each land in ≤ 1 s, measured end to end. A `space_run` script places a live board and undoes in one step. A rule moves a card on a status change with no turn | 8–10 days |
| **2 · Room, library, commands** | The `room` projection on `@space/stage` with a CSS3D layer. Skill layers, intents, pinning, promotion. Ring 3 generated components with a prewarmed pool. The command gate with voice "yes". Website items and the origin allowlist. P1 compositions | "Make that a chart and keep it" yields a space-layer skill. After promotion, "show the chart for X" composes it via P0. "Tell number three to stop" runs only after "yes" | 8–10 days |
| **3 · kb host** | The kb adapter (scenes, sources, commands, kb views as components, refs). The `space/1` ↔ `CanvasDoc` converter and round-trip fixtures in both repos | A space opens with kb as its host. A kb-only space opens in kb's canvas as a diagram | 4–5 days |
| **4 · XR** | As v2 phase 4 | As v2 | open |

## 7. Open questions, each with my default

1. **Where does the fork live?**
   - *Default:* its own repo, `popemkt/space` (MIT, same owner), with its
     bb plugin in the same repo.
   - dotfiles' `my.pkgs.bbPlugins` takes only folders in this repo today,
     so phase 1 adds a pinned GitHub source to that channel (one channel,
     a second source kind) and records a `#gap` node until then.
   - The stop-gap, if the channel change waits, is
     `assets/bb-plugins/space`.
2. **Its own plugin, or a mode of the concierge?** *Default:* its own
   plugin. Space is useful without voice; the concierge's second mode opens
   and drives it.
3. **Storage on the bb host?** *Default:* a folder per space with git. One
   commit per turn's transactions, authored by the actor, and rollback with
   preserved refs (as space-agent does).
4. **May agent-written skills run before review?** *Default:* yes, but only
   in their own space and only in ring 3. Promotion needs the person.
5. **May rules wake a model?** *Default:* no. A rule may place a "needs you"
   card.
6. **The ring 3 tier for generated UI?** *Default:* a nested frame (it can
   hold anything, including raw HTML), within v2's live budget. kb's
   drawing-as-data in a worker is the lighter option for simple views.
7. **Websites opened by scripts?** *Default:* the space's origin
   allowlist; anything else is a command.
8. **Syncing with kb's canvas?** *Default:* none automatic. Provenance
   headers, `FORKED.md`, and hand-ported geometry fixes.
9. **Should kb's canvas adopt `@space/scene`?** *Default:* not decided here
   (the owner's instruction). The format and converter keep the door open.
10. **Any space-agent code?** *Default:* none. Patterns only (§2).

## Sources

- **The space-agent study** (GPT-6.1 Sol, 2026-11-03, read-only, at
  `10f4ffd`):
  - [the pinned tree](https://github.com/agent0ai/space-agent/tree/10f4ffdaf50a8136cf8450d17c11286178fd58e6);
  - the study file is in the design thread's storage
    (`v3/space-agent-study.md`), not committed;
  - [repository metadata](https://api.github.com/repos/agent0ai/space-agent) and
    [releases](https://api.github.com/repos/agent0ai/space-agent/releases).
- **kb** (`origin/main` `6c6da7dc`):
  - `packages/extension/canvas/src/*`, `packages/extension/canvas-ui/src/*`,
    `packages/kit/scene{,-gpu}/src/*`, `packages/contract/sandbox`,
    `packages/infrastructure/sandbox-{quickjs,worker}`;
  - `DESIGN.md` → Sandbox; `LICENSE` (MIT).

  File and line counts are from `git ls-tree` and `git show` on that
  commit, excluding tests.
- **bb:** the Plugin SDK guide (trusted content scripts: "full-trust,
  same-origin page code, not a security sandbox"); this repo's
  `modules/options/channels.nix` (`bbPlugins`).
- **The CSP inheritance of `srcdoc`, `blob:` and `about:blank`
  documents:** the CSP Level 3 specification,
  https://www.w3.org/TR/CSP3/#initialize-document-csp
