# A spatial, generative canvas for the voice concierge (v3 delta)

Date: 2026-11-03. Design only: nothing here is built. This is a **delta** on
[v2](2026-11-02-spatial-generative-ui-v2.md), not a rewrite.

- **What carries over from v2:**
  - the room projection and its contract;
  - presets;
  - typed ports and push/pull;
  - level of detail (LOD), culling and budgets;
  - the three speed paths and the turn record;
  - spoken approval.
- **What does not:** §0 lists every v2 obligation that changes or moves.

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
- **[unverified]**: needs a live test.

## 0. What changes from v2

| v2 | v3 |
|---|---|
| The engine lives in kb; the scene is a kb canvas node | The engine is **space**, a standalone runtime forked from kb's canvas. kb becomes one host adapter (§3) |
| A placed component is a kb view node; bindings are node fields | A component comes from the **skill library**; its params and bindings live in the scene document (§4) |
| Sources are kb read actions with a feed; the bb source is a kb family | **Same contract shape** (`ReadAction + ChangeFeed`, v2 §3.3), owned by the space host. bb's source lives in the bb host, so kb needs no bb credentials |
| kb core work: live reads in the subscription hub, query read sets and write sets (v2 §7.5, §8 "the only core change") | **Not in this plan.** The bb host's cache is event-driven and needs none of it. Dependency-aware invalidation becomes a kb-side item, approved separately, and only the kb host (phase 3) needs it |
| Commands wait until kb restores approval enforcement | Commands go through the **space host's own gate** on the plugin server (§5). kb's actions, once kb is a host, also pass kb's guard |
| P2 fills a ghost through `kb_call`; its edits stream in as they land (v2 §7.3) | P2 **acts in plain JS** through `space_run`. Each call is atomic, so P2 shows progress by making several small calls (§4.1). The ghost is still placed at dispatch |
| Storage, camera and pages are kb nodes | The space host owns them (§3.2) |
| Phases (v2 §9) | Replaced by §6, which keeps LOD, culling, the live scheduler and the reconnect suite in phase 1 |

## 1. Recommendation

1. **Space-agent: borrow its patterns, take no code.** Read in source by a
   GPT-6.1 Sol thread
   ([study](#sources): 232 lines, with file:line citations).
   - **What it is:** a private Node app with its own server, users, groups,
     filesystem store and Alpine front end.
   - **How the agent acts:** its reply carries JavaScript after a
     `_____javascript` line. The page runs it as an `AsyncFunction` in **the
     main page realm** (`with (scope)`, a Proxy that falls through to
     `window`), and `(0, eval)`s persisted widget renderers in that same
     realm [doc].
   - **That is full page authority:** the DOM, fetch, storage, the user's
     session, decrypted API keys, and an unfiltered `/api/proxy` to any
     HTTP(S) host [doc]. Inside bb, it would hand every model reply bb's
     session.
   - **Activity:**
     - MIT at the root (its dependencies carry mixed licences).
     - 1,417 stars and 3 contributors.
     - 101 commits, 88 of them in April. **No commits since 2026-06-08.**
     - Last release v0.66, 2026-04-30 [doc].
   - **So:** embedding means a second server, store, auth and agent loop.
     Forking it means owning all of that, plus building the sandbox it
     lacks. What we borrow is the shape of its loop and library (§2).
2. **Fork kb's canvas into a standalone runtime, `space`** (the coordinator's
   view, which holds).
   - It has **small ports** (§3.2): scenes, assets, sources, commands,
     skills, refs and look.
   - **kb becomes a host adapter.**
   - kb's own canvas is **left alone**. Interchange with it is a defined
     subset, plus a sidecar (§3.3).
   - **The geometry is cheap to fork; the node-backed parts are not.**
     - Cheap: box, transform, arrange, place, snap, pick, paths and
       presets.
     - Real rewrites, budgeted in phase 1: the world, camera, page and
       context code, which decode kb nodes, and the live flow engine.
3. **Ship it first as its own bb plugin, `space`.**
   - The space plugin gives the surface (a panel that goes full screen),
     the bb host, and two agent tools: `space_run` and `space_describe`.
   - The voice concierge's second mode **opens and drives** that surface.
     Its P0 router stays in the concierge (it owns the transcript stream)
     and calls the space plugin over RPC.
   - It needs no kb running.
4. **The agent acts in plain JS, never in the page's realm.**
   - A script calls a `space` API in a fresh worker inside a networkless,
     opaque-origin frame.
   - Its effects are **buffered and committed as one revision-checked
     transaction**.
   - Generated UI runs in nested frames. Commands only *propose*; approval
     is a separate path that guests cannot reach (§5).
5. **The library grows, and the fast path grows with it, through review.**
   - Skills are `SKILL.md` plus an optional component.
   - **Only reviewed skills reach P0 and P1:** their intents, pinned by
     hash, extend the reflex grammar as data.
   - Agent-written drafts are usable at once, but only on the slow path, in
     their own space and in a sandbox. **"Keep this", then review**, is how
     a slow ask becomes a fast one.

## 2. Space-agent, pattern by pattern

| Pattern (space-agent) | Verdict | In space |
|---|---|---|
| Agent acts by writing JS, not tool-call JSON (`onscreen_agent/execution.js:98–133,251–265`) | **Borrow the language, not the realm** | A script against a `space` API, in a worker, committed as one transaction (§4.1) |
| Persisted widget renderer source, `eval`'d on open (`spaces/store.js:2657–2662`) | **Borrow persistence; reject in-realm eval** | Generated components persist in the space and always render in a nested frame with no network (§5) |
| Readback: the current widgets and their source go into the next prompt (`spaces/prompt-context.js`) | Borrow | `space_describe`: the forked `describe.ts`, plus handles, the skill index and the last errors |
| Execution output and errors become the next turn, so the agent repairs (`store.js:5357–5392`) | Borrow, plus rollback | A failed script commits nothing, so the last working UI stays, and the error goes to the agent |
| Renderer cleanup contract (`store.js:2729–2754`) | Borrow, enforced | The component `mount → {update, dispose}` contract (§3.2); LOD demotion disposes renderer resources (v2 §6.1) |
| `SKILL.md` with frontmatter, a compact catalog, explicit load, context-conditioned eligibility (`skillset/skills.js`) | Borrow | §4.2 |
| L0 / L1 / L2 override layers (`customware/overrides.js:36–85`) | Borrow, **without overriding by untrusted layers** | owner may override built-in; space drafts only add, under their own namespace |
| The agent writes new skills by file write | Borrow, bounded | Drafts live in their space; promotion is reviewed |
| Git history per owner: 10 s debounce, fixed author, `reset --hard` rollback with preserved refs (`git_history.js`) | Borrow git; change the unit | One commit per transaction, authored by the actor, with the utterance as its message |
| Model called from the browser with a Bearer key (`onscreen_agent/api.js:214–220,328–354`) | **Reject** | Models run on the server (the concierge thread, P1); no page holds a key |
| Unfiltered authenticated `/api/proxy` (`server/router/proxy.js`) | **Reject** | No network from the space frame; sources resolve on the plugin server |
| Users, groups, its own auth | Reject | bb's owner is the user |
| Connectors | Nothing to borrow: there is no connector contract (widgets `fetch`) [doc] | v2's source contract stands |

## 3. The fork

### 3.1 What we fork, cut and leave

The sizes, from source, excluding tests [measured]:

- `@kb/canvas`: 43 files, 10,598 lines;
- `@kb/canvas-ui`: 114 files, 19,371 lines;
- `@kb/scene` + `@kb/scene-gpu`: 6 + 13 files;
- `@kb/ext-canvas`: 13 files, 2,910 lines.

The table is a plan. **Phase 1 starts by producing a dependency-closure
manifest** (each kept file, what it imports, and whether that is a type-only
or a runtime import), because a cut file is often imported by a kept one.

| kb package | Fork into | Cut | Rewrite or adapt |
|---|---|---|---|
| `@kb/canvas` | **`@space/scene`**: box, transform, rotation, pick, snap, arrange, place, presets, connect, edges, paths, membership, relations, shapes, style, paint, edit, describe, lint, links, ids, clip, `extra`, `fields`, `style-fields`, `doc` | `tldraw`, `mermaid`, `diagram`, `comments`, `seed`, `promote`, `references`, `view`, `extension`, `svg` | **Rewrites:** `world`, `camera`, `pages` and `context`, which decode node-backed state (seeded node props, pages as graph nodes, `@kb/contracts`); and `flow`, which becomes v2's typed live engine. **Adapt:** `describe` without comments; `doc` (JSON Canvas parsing) without `@kb/model`'s asset helpers; the barrel `index.ts` |
| `@kb/scene` + `@kb/scene-gpu` | **`@space/stage`**: the three.js WebGPU stage, post chain and frame loop, rig, pointer field, offscreen pass, screen geometry | starfield, lab-only pieces | **`@space/kit`** gets copies of what they import: approach, clamp, easing (`easeAt`, `CubicBezier`), pointer slop, `djb2Hash`, token colour and `ColorToken` |
| `@kb/canvas-ui` | **`@space/surface`**, in part: camera and rig, gestures, pointer and touch, selection, resize and transform guides, edge and card layers, faces (`canvas-face*`, `canvas-face-pictures`, `canvas-capture`: snapshot faces already exist), culling (`canvas-visible`), the 3D stage and `canvas-scene-*`, projections, history, keymap, full screen, media, image and link cards, ports | comments, node picker, item inspector, outline rows (`canvas-item-outline`), list and page strip, dock, style panel, tool sheets, `plugin`, `routes`, `surfaces`, `canvas-handover`, `canvas-view-widget` | **Cards do more than read nodes.** `canvas-card.tsx` activates, selects and writes nodes through the browser host and imports the outline rows [doc, Sol review]. A kept card becomes a **read-only record face** from `refs`: opening goes through `refs.open`, and any edit is a command. `canvas-api.ts`'s `readCanvasDoc` and `tx.apply` become `scenes` |
| `@kb/sandbox` + its QuickJS and Worker engines | **`@space/sandbox`**: the capability API over MCP Apps JSON-RPC, `runGuest`, drawing as data, both engines | kb's `CodeGrant` | It imports kb's protocol and action contracts (`@kb/contracts`: `MCP_APPS_METHODS`, the messages, the capability types), so that subset is copied. **kb's grant enforcement is replaced by space's, not deleted:** calls are bound to the port they arrive on (§5). The adversarial sandbox suite runs on both engines |
| `@kb/ext-canvas` | **Not forked.** It is the model for the kb adapter (phase 3) | — | — |

**What stays only on kb's canvas:**

- diagramming tools;
- tldraw and Mermaid import;
- comments;
- the outline integration and editing;
- SVG and docs export;
- `canvas.run` over kb nodes.

**Drift.** Each forked file's header names its kb commit, and `FORKED.md`
keeps the table. Geometry fixes are ported by hand. There is no automatic
sync, because the two are meant to diverge.

**3D.**

- `@kb/scene-gpu` gives GPU infrastructure: the stage, pick rays, and
  snapshot faces drawn as textures.
- **`room`** (v2 §3.1) is a third projection kind on it. kb's camera
  accepts only `2d` and `3d` [doc, `camera.ts:20–22`], which is one more
  reason the camera is rewritten.
- Live DOM faces need a **CSS3D layer**, which kb does not have. It is new
  work in phase 2.

### 3.2 The host port

The forked code reaches the world only through this. Each member is one
contract, with a contract suite every host passes.

```ts
interface SpaceHost {
  scenes:   { read(id): Promise<{ doc: SceneDoc; rev: Rev }>; subscribe(id, onRev): Unsubscribe;
              commit(id, tx: SceneTx, at: { expectedRev: Rev; actor: Actor; runId: RunId; note?: string })
                : Promise<Receipt | Conflict> };               // idempotent per runId
  assets:   { stage(bytes, mime): Promise<StagedAsset>; url(ref): string };     // promoted by the commit that uses it
  sources:  SourceRegistry;   // v2 §3.3: ReadAction + optional ChangeFeed, one subscription hub
  commands: { propose(action, input, at: { runId; actor }): Promise<PendingId> };  // guests' only command verb
  skills:   { index(): SkillCard[]; load(id: PinnedId): Promise<Skill>; stage(draft): Promise<StagedSkill> };
  refs:     { resolve(ref): Promise<RecordView>; subscribe(ref, on): Unsubscribe; open(ref): void };  // open = host navigation
  look:     { token(name): string; timing(name): Timing };
}
// Approval is deliberately not a member: it is a ring-0 endpoint (§5).
type Actor = "person" | "voice" | { agent: "P0" | "P1" | "P2"; turn: TurnId } | { rule: RuleId };
// A component, in ring 1 or (proxied over its port) ring 3:
type ComponentModule = { mount(el: Element, inputs: Json, ctx: ComponentCtx): { update(inputs: Json): void; dispose(): void } };
```

- **The bb host** (phase 1) runs in the space plugin.
  - **scenes:** a folder per space (`scene.json`, `skills/`, `assets/`)
    with git: **one commit per transaction**, authored by the actor.
  - **sources:** bb's threads, thread, PR status and environments, from
    one in-memory cache that `bb.sdk.subscribe` keeps current.
  - **refs:** bb records; `open` navigates bb to the thread.
  - **assets:** files.
- **The kb host** (phase 3) is a kb extension:
  - **scenes:** canvas nodes, through `tx.apply`;
  - **sources:** read actions;
  - **commands:** write actions under kb's guard;
  - **refs:** nodes.
  - **kb views as components** need a defined bridge: a view is rendered
    by kb as a snapshot (`render.view`) or as a drawing (the sandbox
    protocol), passed in as serialized input, with its subscription and
    cleanup under the component contract. kb's UI SDK is not ported as a
    hidden adapter.

### 3.3 Staying portable to kb

kb keeps fields it does not read [doc, `doc.ts:565–581,684–711`]. That makes
storage tolerant, not interoperable: kb would not draw components, room, or
pages the way space does. So the promise is narrow.

- **A space scene (`space/1`) is shaped like kb's `CanvasDoc`.**
- **The shared subset** survives a round trip both ways:
  - text, shape, group, file, link and path items;
  - edges;
  - transforms;
  - `ref {source: "kb"}` ↔ `kb-node`, including links, edges and page
    targets that name nodes.
- **Everything else is a lossless sidecar:**
  - components, bindings and rules;
  - the room camera;
  - page identity;
  - assets.

  kb shows each component as a fallback card (title plus a link).
- **What kb edits can destroy is stated.** Deleting a fallback card in kb
  deletes the component when the scene is imported again.
- **The converter is tested by parse → edit in kb → serialize → reimport,**
  not only by parse and stringify.
- **Rule 1 holds by direction:** one engine per purpose. If kb later wants
  live spaces, its canvas adopts `@space/scene`. That decision is kb's, and
  is not needed now.

## 4. The agent loop

```
turn ─► P0 reflex (reviewed intents) ─► space plugin RPC ─► bb host: commit (rev+1) ─► signal ─► ring 0 ─► port ─► ring 1 draws
     ├─► P1 fast model ─► a composition of reviewed skills, as ops (no code)
     └─► P2 concierge thread ─ space_describe ─► scene, handles, skill index, last errors
                             └ space_run(script), as often as it likes ─► fresh worker ─► buffered tx ─► commit or nothing
source change ─► live bindings re-run (no model) ─► rules (reviewed or draft JS, no model) ─► scheduler ─► commit
```

### 4.1 Acting in plain JS

```ts
// What P2 sends with space_run. `space` is a proxy; mutations are buffered, never applied mid-script.
const prs = await space.source("bb.threads", { where: { pr: "open" } });   // an observation, from the cache
const board = space.place("skill:board", { near: "focus", params: { groupBy: "status" } }); // provisional id
space.bind(board, "rows", { action: "bb.threads", input: { where: { pr: "open" } }, mode: "live" });
for (const t of prs.slice(0, 3)) space.place("skill:thread.card", { in: board, ref: { source: "bb", id: t.id } });
space.arrange(board, "kanban");
```

**The transaction boundary.**

- **Reads within a run are consistent.**
  - A run reads each source as it stood in the bb host's cache when the
    run started: the same input gives the same answer for the whole run.
  - Each answer carries its cache age, so the script (and `space_describe`)
    can tell how fresh it is.
- **The script runs against a snapshot at revision R.**
  - Every mutation, staged skill, staged asset and **command proposal** is
    buffered.
  - Ids are provisional; the receipt maps them to real ones.
- **At the end, one `commit` with `expectedRev: R`.**
  - It is idempotent per `runId`.
  - A **conflict** (a person or a rule committed meanwhile) re-runs the
    script once against the new revision; a second conflict fails.
- **On success, everything is published together:** the transaction and
  its staged skills and assets. Only then is each proposal created as a
  pending approval. **Nothing is approved before the script's own commit
  exists.**
- **On failure nothing exists.** That covers a throw, a refused op (lint,
  a port type mismatch), the budget (2 s wall, 500 ops [estimate]), or a
  second conflict. Staged files are deleted, and the error goes to the
  agent, as in space-agent.
- **Undo** reverts a transaction. It cannot undo what was only observed (a
  source read) or a command that has since run; those receipts say so.
- **One transaction is one undo step, one git commit and one history
  entry,** for scripts, P0 ops and rules alike.
- **A fresh worker per run** (terminated after, from a prewarmed pool), so
  no global state leaks between scripts or rules.
- **Why buffered ops, not DOM edits:**
  - An op exists in every projection (flat, room, phone), and it can be
    undone, diffed and committed.
  - A worker can be killed; a `while(true)` in space-agent's realm freezes
    the page [inferred, Sol study §3].

**Rules: reshaping without a model, without storms.**

- **Triggers.** A rule's trigger is a **source** change or a timer, never a
  scene change. Rules write only to the scene. They cannot propose
  commands; they may place a "needs you" card. Sources change only through
  commands, which need a person. So rules cannot trigger each other.
- **Re-entry.** A rule that rebinds an input can make that binding's
  answer change, and that change could trigger the rule again. Every
  transaction carries a **cause chain**, which binding re-runs propagate,
  and a rule ignores changes caused by its own runs. Unchanged answers
  trigger nothing (v2's equality check).
- **The scheduler:**
  - Bursts coalesce, with at most one run per rule per second.
  - Timers fire no more often than every 10 s.
  - Global budgets: 120 rule runs and 2 s of CPU per minute [estimate].
  - Rules run at a lower priority than P0, P1 and the person.
  - A rule that breaches a budget is **suspended**, with a "needs you" card
    and its diagnostics. Disabling a rule is a ring 0 control.
- **A rule never wakes a model.**

### 4.2 The skill library

```yaml
# skills/thread-card/SKILL.md (frontmatter)
name: thread.card
description: One bb thread as a card: status dot, title, PR chip, latest reply.
kind: component            # component | layout | pattern | recipe
ports: { inputs: { thread: { $ref: "bb#/Thread" } }, outputs: { selected: { type: string } } }
intents:                   # active only once reviewed
  - match: "show (thread|number) {handle}"
    ops: [{ place: "skill:thread.card", ref: "{handle}", near: "focus" }]
when: { sources: ["bb"] }  # eligibility, as space-agent's context tags
```

- **The body** holds the model's instructions and examples. P2's context
  always has the index (name, description, kind, and whether the skill is
  reviewed); bodies are loaded on demand.
- **Layers and names:**
  - **built-in:** the space repo, reviewed;
  - **owner:** a folder the owner keeps in git, changed by commits the
    owner approves. It may override built-in names.
  - **space drafts:** agent-written, living in their space, under their
    own namespace (`draft:<space>/<name>`). **They never override or shadow
    a reviewed name.**
- **Reviewed means pinned.** P0 and P1 resolve `name@contentHash` from the
  reviewed layers, never a layered name at execution time. An item records
  its pin, and editing a skill never silently changes an existing space.
- **Intents:**
  - **The reviewed intent registry** is built only from reviewed skills,
    pinned with them.
  - A draft's `intents` are inert until promotion. Then the review covers
    them, and the registry validates each one: a bounded grammar, op
    templates against the op schema, and declared handle substitution.
  - Two intents that match the same utterance are an ambiguity, and P0
    passes the utterance to P1.
- **Generated, then composed:**
  1. P2 writes a component and places it (draft, sandboxed, slow).
  2. "Keep this" saves it as a draft skill.
  3. Promotion (owner review) makes it composable by P1 and, through its
     reviewed intents, by P0.

### 4.3 Speed survives

| Path | Runs new code? | Evidence |
|---|---|---|
| P0 reflex (reviewed intents) | No. The ops are committed by the bb host; the frame draws reviewed components | v2's prototype **callback** timings (33–101 ms median) are only that: they measured no RPC hop, commit, signal, port message or real component [v2 §7.4] |
| P1 composition | No: ops naming reviewed, pinned skills | v2's P1 budget, ≈ 1 s [estimate] |
| Live bindings | No: built-in transforms and reviewed components | as v2 |
| Rules | Yes: a worker from a prewarmed pool | off the reaction path; lower priority |
| P2 scripts and draft components | Yes: a worker, then a nested frame from a prewarmed pool | a separate path, with its own budget; small next to P2's 20–30 s; the ghost is placed at dispatch |

- **Committing is durable first, then visible.**
  1. The bb host appends the transaction to its log and `fsync`s it.
  2. Only then does it bump the revision, signal, and move the run's
     proposals into an **outbox keyed by `runId`**, which is idempotent.
  3. The git commit follows asynchronously, off the visible path.
  - A restart replays the log into git.
  - **It voids every approval that was pending, never executing one,** so
    no command can run for a transaction or approval that a crash lost.
  - The append is a small local write [estimate: ≲ 5 ms; measured in
    phase 1].
- **Phase 1 measures the new P0 hop chain,** cold and warm: RPC, commit,
  signal, port, draw. It also measures first use of a reviewed skill, pool
  misses, and git under rule load.
- **The ≤ 1 s target from the end of speech** remains an unvalidated exit
  criterion.

The rule that keeps it fast is the one that keeps it safe: **the fast paths
compose reviewed, pinned things and never run new code.**

## 5. Security: whose code runs where, with what reach

| Ring | What runs there | Whose code | Reach |
|---|---|---|---|
| **0 · bb app shell** | The space plugin's frontend: the broker, the approval UI, website frames, the chrome | The space repo, reviewed | bb's session ("full-trust, same-origin page code, not a security sandbox" [doc, bb plugin guide]). Holds no source tokens |
| **0′ · plugin server** | The bb host: sources, the command gate, storage, git; the kb token in phase 3 | Reviewed | Every credential. The only place a source resolves or a command executes |
| **1 · space frame** | The runtime, the projections, reviewed components | Reviewed | An opaque origin with no session, cookies, keys or network. One `MessagePort` to ring 0 |
| **2 · script worker** | P2 scripts and rules, one fresh worker per run | The agent | The `space` proxy only: buffered ops and buffered proposals |
| **3 · component sandbox** | Draft (generated) components, raw HTML | The agent, or whoever shared the space | A nested opaque frame per live component (within v2's live budget). No network. Its own port: data in through its bindings, events out, proposals only |
| **4 · websites** | Framed third-party pages | Anyone | Created **only by ring 0**, at exact approved URLs, outside the space frame's subtree |

**How the rings are made.**

- **Ring 1** is an `<iframe sandbox="allow-scripts">` (no
  `allow-same-origin`), loaded from a plugin route
  (`/api/v1/plugins/space/http/frame`). The route sends its own CSP:

  ```
  default-src 'none';
  script-src 'sha256-<runtime bundle>' 'wasm-unsafe-eval';
  worker-src blob:;
  style-src 'unsafe-inline';
  font-src data:;
  img-src data: blob:;
  frame-src <the ring 3 shell route>;
  connect-src 'none';
  form-action 'none';
  ```

  - **It is not a `srcdoc` or `blob:` document,** since those inherit the
    parent's CSP.
  - **The runtime is inline and hash-pinned,** not module scripts.
    - CORS-mode requests from an opaque frame (module scripts, `fetch`)
      carry `Origin: null`. A bb route's default `"local"` auth rejects
      that: it accepts only no `Origin` or bb's own [doc, bb plugin guide →
      `bb.http`; confirmed in bb's server code by the review].
    - A GET navigation sends no `Origin`, so the frame document itself
      loads.
    - Everything after that arrives over the port, so the frame needs no
      further fetches.
  - **Scripts need no `unsafe-eval`:** a script runs as a `blob:` worker
    whose source *is* the script, as kb's Worker engine does
    (`sandbox-worker/src/index.ts:116`) [doc].
  - **Inline styles are allowed** (with no hash beside it, since a
    hash makes browsers ignore `'unsafe-inline'`). Nothing they could load
    (`url()`, fonts beyond `data:`) is.
- **Ring 3** is the same shell one level down, plus `script-src blob:`, so
  it can run the component code it is sent.
  - It has no `frame-src`, so it cannot open frames of its own.
  - It has no network, so running its own code reaches nothing beyond
    its port.
- **Websites (ring 4) are not in the space frame's subtree at all.**
  - Ring 0 draws them in its own layer, positioned from the item rects
    that ring 1 reports (a CSS3D layer in room mode, synced to the camera).
  - **They are sandboxed too:** `sandbox="allow-scripts allow-forms"`.
    - There is no `allow-same-origin`, so even a site that navigates itself
      to bb's origin stays opaque and cannot touch ring 0.
    - There are no popups and no top navigation.
    - `allow=""` grants no camera, microphone, geolocation or autoplay, and
      `referrerpolicy="no-referrer"` is set.
  - **Some URLs are refused.** The server checks the URL and every redirect
    hop (v2 §6.1's header check), and refuses:
    - bb's own origin;
    - plugin routes;
    - loopback and private addresses;
    - anything that carries credentials.
  - **A site that breaks without its own origin** (storage, cookies) gets
    v2's link card, with a snapshot and "open in browser".
  - **Ring 0's approval chrome is a top layer** above every frame, and no
    frame's rect may overlap it.
  - A website item's URL is a **gated field**: setting or changing it is a
    command, shown with the **full URL**, because an allowed origin can
    still receive data in a path or query string.
  - Navigation the site makes by itself is the site's own; we put no data
    in it.

**The broker and approval.**

- **Ports, not window messages.**
  - At load, ring 0 hands a dedicated `MessagePort` to the exact frame
    (`iframe.contentWindow`), and ignores window-level messages from then
    on.
  - Ring 1 does the same for each ring 3 frame and worker.
  - Every opaque frame's origin is `null`, so origin checks prove nothing;
    the port is the identity.
- **The server binds each port.** Its space, run or component id, and
  source grants are fixed when the port is created. A guest names no actor
  or space. Messages are schema-checked and rate-limited.
- **Approval is not a guest verb.**
  - A pending approval is v2's `{pendingId, actionId, inputDigest,
    revision, expiresAt ≈ 20 s, used}`.
  - It is approved through a **separate ring 0 RPC**, reachable from no
    port, under one of two conditions:
    - **a trusted press** (`isTrusted`) on ring 0's approval chrome. The
      chrome is drawn outside every guest's bounds, and its text comes from
      the server's record, not from anything a guest drew.
    - **a spoken "yes"**, matched on the concierge server's transcript
      stream, after the concierge read that pending command aloud in that
      turn.
- **One pending command per space.** A new proposal voids the one before
  it, and the concierge reads again.
- **Voice approves only what the person asked for.**
  - A spoken "yes" can approve only a command that P0 or P1 proposed from
    the person's own utterance in that turn ("tell number three to stop").
  - **Anything a guest proposed** (a script, a component) **needs a
    press,** as does any command marked destructive.
  - Muting cannot be guaranteed: a site may play audio after interaction,
    and guests have Web Audio and speech synthesis. So no audio a guest
    produces can approve anything.

**Reads, writes, residual risks.**

- **Reads:**
  - A component sees what its bindings deliver.
  - A script sees the scene, plus the sources its port grants. Each space
    has a source allowlist; adding to it is a command.
- **Writes:**
  - Scene ops are local and undoable, so they need no approval.
  - Everything outside the scene is a command: telling a thread, merging a
    PR, writing to kb, setting a website URL.
- **Injection:**
  - Source data and draft skills are untrusted instructions; only reviewed
    skills are trusted context.
  - The defence is the gate, not trust in the agent.
  - A poisoned shared space can draw wrong things inside its own frames
    and propose commands.
- **Residual risks we accept:**
  - timing and shared-resource side channels between frames on one page;
  - what a person approves by mistake.

  These are stated, not claimed away.

## 6. Phases (replaces v2 §9)

| Phase | Scope | Exit criterion | Size [estimate] |
|---|---|---|---|
| **0** | v2, plus this delta | The owner confirms §7's defaults | done |
| **1a · Feasibility spike (entry gate)** | In bb web and desktop:<ul><li>serve the ring 1 shell from a plugin route;</li><li>read the effective CSP;</li><li>load the inline runtime and WASM;</li><li>render CSS;</li><li>start and kill `blob:` workers;</li><li>open ring 3 frames;</li><li>check WebGPU inside the sandbox;</li><li>run negative tests for egress, window messages, approval, and website frames (self-navigation to bb's origin, popups, overlap with the approval chrome)</li></ul> | Each ring exists as specified, or this doc changes before any build | 1–2 days |
| **1b · Fork, flat, bb** | <ul><li>The space repo and its `AGENTS.md` (linking kb's shared rules)</li><li>The dependency-closure manifest, then the fork of `@space/scene` (with the world, camera, page and context rewrites), `@space/kit`, `@space/sandbox` and the flat parts of `@space/surface`</li><li>`SpaceHost` and its contract suites</li><li>The bb host (folder and git, the transaction log, the bb source and cache, assets)</li><li>Rings 0–2 and ports</li><li>The live scheduler (push/pull) and its reconnect suite</li><li>LOD faces and culling (v2 §6.1)</li><li>The space plugin (panel, full screen, `space_run`, `space_describe`)</li><li>The concierge opens and drives it (P0 over RPC, the turn record)</li><li>Built-in skills: list, card, detail, board, stat, markdown</li></ul> | <ul><li>v2 phase 1's asks each land in ≤ 1 s, measured end to end, with the hop chain of §4.3</li><li>A `space_run` script places a live board, a conflicting run retries, and one undo reverts it</li><li>A rule moves a card on a status change with no turn, and a rule loop is suspended</li></ul> | 10–12 days |
| **2 · Room, library, commands** | <ul><li>`room` on `@space/stage`, with the CSS3D layer</li><li>Skill layers, pinning, the reviewed intent registry, promotion</li><li>Ring 3 draft components with a pool</li><li>The command gate and the approval RPC, with press and voice</li><li>Website items in ring 0</li><li>P1 compositions</li></ul> | <ul><li>"Make that a chart and keep it" yields a draft</li><li>After promotion, "show the chart for X" composes it via P0</li><li>"Tell number three to stop" runs only after "yes"</li></ul> | 8–10 days |
| **3 · kb host** | <ul><li>The kb adapter (scenes, sources, commands, refs, the kb view bridge)</li><li>The `space/1` ↔ `CanvasDoc` subset converter and sidecar, with fixtures in both repos</li><li>Dependency-aware invalidation in kb, if kb approves it separately</li></ul> | <ul><li>A space opens with kb as its host</li><li>The subset survives parse → kb edit → reimport</li></ul> | 5–6 days |
| **4 · XR** | As v2 phase 4 | As v2 | open |

## 7. Open questions, each with my default

1. **Where does the fork live?**
   - *Default:* its own repo, `popemkt/space` (MIT, same owner), with its
     bb plugin in the same repo.
   - dotfiles' `my.pkgs.bbPlugins` takes only folders in this repo today,
     so phase 1 adds a pinned GitHub source to that channel (one channel,
     a second source kind) and records a `#gap` node until then.
   - The stop-gap is `assets/bb-plugins/space`.
2. **Its own plugin, or a mode of the concierge?** *Default:* its own
   plugin. The concierge's second mode opens and drives it.
3. **Storage on the bb host?** *Default:* a folder per space with git, one
   commit per transaction, authored by the actor. Rollback keeps preserved
   refs, as space-agent does.
4. **May drafts run before review?** *Default:* yes, but only in their own
   space, on the slow path, in ring 3, under their own namespace.
5. **May rules propose commands or wake a model?** *Default:* no to both.
6. **Ring 3 for generated UI: a frame, or drawing-as-data?** *Default:* a
   frame (it can hold anything), within v2's live budget. kb's
   drawing-as-data in a worker is the lighter option.
7. **What may a voice "yes" approve?** *Default:* only a command that P0
   or P1 proposed from the person's own utterance, and never a destructive
   one. Everything else needs a press.
8. **Syncing with kb's canvas?** *Default:* none automatic. Provenance
   headers, `FORKED.md`, and hand-ported geometry fixes.
9. **Should kb's canvas adopt `@space/scene`?** *Default:* not decided here.
   The subset converter keeps the door open.
10. **Any space-agent code?** *Default:* none. Patterns only (§2).

## Sources

- **The space-agent study** (GPT-6.1 Sol, 2026-11-03, read-only, at
  `10f4ffd`):
  - [the pinned tree](https://github.com/agent0ai/space-agent/tree/10f4ffdaf50a8136cf8450d17c11286178fd58e6);
  - the study and the review of this delta are in the design thread's
    storage (`v3/`), not committed;
  - [repository metadata](https://api.github.com/repos/agent0ai/space-agent) and
    [releases](https://api.github.com/repos/agent0ai/space-agent/releases).
- **kb** (`origin/main` `6c6da7dc`):
  - `packages/extension/canvas/src/*` (`doc.ts`, `camera.ts`, `world.ts`,
    `pages.ts`, `flow.ts`);
  - `packages/extension/canvas-ui/src/*` (`canvas-card.tsx`,
    `canvas-api.ts`);
  - `packages/kit/scene{,-gpu}/src/*`;
  - `packages/contract/sandbox`, `packages/infrastructure/sandbox-{quickjs,worker}`;
  - `DESIGN.md` → Sandbox; `LICENSE` (MIT).

  Counts are from `git ls-tree` and `git show`, excluding tests.
- **bb:** the Plugin SDK guide:
  - trusted content scripts ("full-trust, same-origin page code, not a
    security sandbox");
  - `bb.http` routes and their auth modes.

  Also this repo's `modules/options/channels.nix` (`bbPlugins`).
- **Web platform:**
  - CSP Level 3, https://www.w3.org/TR/CSP3/ (policy inheritance for
    `srcdoc` and `blob:` documents and workers);
  - HTML, https://html.spec.whatwg.org/multipage/iframe-embed-object.html
    (`sandbox`, opaque origins) and
    https://html.spec.whatwg.org/multipage/web-messaging.html (`MessagePort`).
