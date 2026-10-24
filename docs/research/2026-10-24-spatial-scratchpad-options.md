# Spatial scratchpad for bb: findings and options

Date: 2026-10-24. Research only. Nothing was installed, published or changed.

Sources:
- The two npm packages were packed with `--ignore-scripts` into `/tmp/ssp-pkgs/{sticky,agentation}/package`. Their `server.ts` and `app.tsx` have the same sha256 as the copies installed on shared-server, so the line numbers below are valid for both.
- bb on shared-server is 0.46.1.
- The SDK types are `@get-bb/plugin-sdk` 0.6.49, at `.claude/worktrees/agent-a6d21bbdef21dbbc4/assets/bb-plugins/bbim/node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk.d.ts`. This document calls that file `sdk.d.ts`.

---

## 0. Where sticky-notes stores its data

**Sticky notes are stored on the server, in a SQLite database owned by the plugin, one row per note, keyed by thread. They are not in the browser.**

- **Location.** The file is `/home/popemkt/.bb/plugins/sticky-notes/data.db` on shared-server (WAL mode, so `data.db-wal` and `data.db-shm` sit next to it). The SDK documents `bb.storage.database()` as `<dataDir>/plugins/<id>/data.db` (`sdk.d.ts:22525-22536`). The plugin opens it at `server.ts:95-96`.
- **Table.** The table is `sticky_notes(id, thread_id, text, links_json, hue_index, horizontal_anchor, vertical_anchor, offset_x, offset_y, width, height, rotation, created_at, updated_at)`, indexed on `(thread_id, updated_at)` (`server.ts:96-122`).
- **Scope.** Notes are per thread. Every RPC takes `threadId`, and reads filter `WHERE thread_id = ?` (`server.ts:124-139`).
- **Cleanup.** Rows are deleted when their thread is deleted (`server.ts:217`).
- **Sync.**
  - Notes are shared by every browser and device connected to that bb server. A write calls `bb.realtime.publish("notes", {threadId})` (`server.ts:145`), and clients refetch through `useRealtime("notes")` (`app.tsx:783`).
  - Notes are not synced to any other bb server. Nothing is backed up beyond what backs up `~/.bb` on shared-server.
- **What is not used.** The plugin uses no plugin KV and does not write to bb's `bb.db`. It uses no `localStorage` for note data; the only client-side DOM work is loading a font (`app.tsx:82-91`).
- **Current contents.** The table is empty (`count(*) = 0`). Nothing would be lost by replacing the plugin.

For comparison, agentation-mentions keeps its data in three places:
- Its own `~/.bb/plugins/agentation-mentions/data.db`, with tables `sessions` (60 rows), `annotations` (0), `annotation_routing` and `annotation_dispatches`.
- One plugin-KV flag for toolbar visibility (`server.ts:253`, `:619`).
- A per-route mirror in browser `localStorage` (`bb-agentation-synced-<route>`, `lib/toolbar.ts:71`, `:189-198`). The vendored toolbar owns this mirror.

---

## 1. sticky-notes (`@phosphorco/bb-plugin-sticky-notes` 0.1.2, MIT)

**How it works**
- The package has about 2.1k lines: `app.tsx` (1052), `server.ts` (220), and helpers for geometry, links and the save queue.
- **Server.** A zod RPC contract with `listNotes`, `createNote`, `updateNote`, `deleteNote` and `resolveThreadLink` (`server.ts:33-63`). The server stores rows (see §0) and publishes a realtime ping after each write.
- **Links.** Pasting a URL turns it into a numbered citation. Links to threads on the same bb host resolve to the thread's title (`server.ts:181-215`), match on the path `/projects/proj_*/threads/thr_*`, and open with `navigate.toThread` (`app.tsx:527`).
  - Links are **thread-level only**. There is no message anchor.
- **Layout.** A note is placed relative to the nearest horizontal and vertical edge of the pane: `horizontal_anchor` and `vertical_anchor` plus offsets (`notes.ts:33-41`).
  - There is no canvas coordinate space and no pan, zoom, edges or grouping.
  - Size is fixed at 220×156 (`notes.ts:4-5`, and migration 2 forces it).

**UI surface.** The UI is a workaround.
- The plugin registers `app.composer.customize` with:
  - a composer action button (drag it to place a note);
  - a plus-menu item;
  - a **bare composer banner** (`app.tsx:1036-1052`).
- The banner renders an invisible anchor `<span>`. The plugin then walks up the DOM to find the thread pane (`paneBoundsFrom`, `app.tsx:225-250`) and watches it with a body-wide `MutationObserver` plus a `ResizeObserver` (`app.tsx:252-300`). Finally it portals an absolutely positioned overlay into `document.body` (`app.tsx:948-996`).
- The README says this outright: the "bare Composer banner [is] its per-pane lifecycle anchor because the bb SDK does not yet expose a dedicated Thread workspace overlay surface" (`README.md:25-27`).

**Assessment**
- The good parts to keep: the server and RPC pattern, the realtime refresh, the save queue (`save-queue.ts`) and the link-title resolution.
- The overlay layout model is the wrong base for a spatial canvas. It is notes floating over the chat, not a board.
- The DOM-ancestry overlay is the part most likely to break when bb's layout changes.

## 2. agentation-mentions (`@phosphorco/bb-plugin-agentation-mentions` 0.2.0, MIT plus PolyForm Shield 1.0.0)

**How capture works**
- A **content script** mounts the vendored `agentation@3.0.2` React toolbar over the whole app shell (`app.tsx:27-30`, `lib/toolbar.ts:205`). The toolbar is patched and imported by path from `vendor/agentation/dist/index.mjs` (`lib/toolbar.ts:16-26`).
- The user picks an **element** with the toolbar and types a comment. The plugin records the last element under the pointer (`onPointerDown`, `lib/toolbar.ts:759-764`).
- On `onAnnotationAdd` (`lib/toolbar.ts:622`) it decorates the CSS path with bb attributes `data-panel-id`, `data-bb-plugin` and `data-testid` (`lib/location.ts:1-41`). It then queues an upsert to the server.
- **No screenshots.** The package contains no screenshot code; a grep of `dist/app.js` finds none.
- The route is polled every tick to follow bb's SPA navigation (`lib/toolbar.ts:766-790`).

**What a mention stores**
- **The annotation.** It is an AFS 1.1 object (`lib/afs.ts:67-121`) with these fields:
  - `comment`, `elementPath`, `fullPath` and `element`;
  - `x` and `y` and an optional `boundingBox`;
  - optional `selectedText`, `nearbyText`, `reactComponents`, `cssClasses`, `computedStyles`, `accessibility` and `sourceFile`;
  - `intent`, `severity`, `kind`, `status`, and a reply `thread`.
- **bb context** is added on top: `{route, pluginId, surface, threadId, projectId, routeLabel}` (`lib/afs.ts:45-58`).
- **Storage.** The whole object is stored as JSON in `annotations.payload` (`lib/store.ts:7`, `:339-379`).
- **The mention itself** is only a pointer. It is `encodeURIComponent(JSON.stringify({annotationIds:[…]}))` under provider `feedback-batch` (`lib/attachment.ts:1-21`).
  - `bb.ui.registerMentionProvider` has `search: () => []`, so it never appears in the composer's @-search.
  - `resolve` loads the rows and renders them to text for the agent's context at send time (`server.ts:309-335`).

**How a mention goes back to its location**
- Markers are drawn again only when the user is on the **same route**: the toolbar reloads that route's annotations from `localStorage`, which is synced from the server.
- The review panel can only go to the thread with `navigate.toThread(...)` (`components/annotation-panel.tsx:258`, `:267`).
- There is no "scroll to message" or "highlight text" step. The anchor is a CSS selector, which breaks on the thread timeline because it is virtualised and its DOM is not stable from one load to the next.

**Can it be reused?**
- **As a library: no.** It exports nothing, and its value is in its app wiring.
- **By reading its storage: possible but not worthwhile.** It is another plugin's private SQLite file, and its annotations are about UI elements, not conversation content.
- **By forking: legally possible.** The plugin code is MIT. The vendored `agentation` is **PolyForm Shield**, which forbids building a competing product. A personal fork is fine, but redistributing it is messy (`THIRD_PARTY_NOTICES.md:13`).
- **What is worth taking** is the idea of capturing any UI element through a content script. It is the right tool for capturing *non-message* UI such as plugin panels and diffs. It is the wrong tool for message text.

## 3. What the bb plugin SDK provides (0.6.49)

| Need | API | Notes |
|---|---|---|
| Per-thread host surface | `app.slots.threadPanelAction` (`sdk.d.ts:19220`) | Props are `{threadId, params}`. It is a thread side-panel tab with `layout: "flush"`. Stable (not experimental). |
| Full page | `app.slots.navPanel` (`:19139`) | No `threadId` in props. Use `useBbContext()`. |
| App-wide overlay | `app.slots.experimental_appOverlay` (`:19085`) | No thread context. Experimental. |
| Capture text from a message | `app.slots.messageAction` (`:20282`) | An icon on every message's action bar, and an entry in the **assistant-message text-selection menu**. |
| What a captured message gives you | `PluginMessageActionContext` (`:20244-20278`) | Has `threadId`, `message`, `selectedText?` (the exact highlighted text, only from the selection menu), `openPanel({actionId})` and `composer`. |
| Message identity | `ThreadChatMessageReference` (`:20220-20235`) | Has `id`, `threadId`, `role`, `text`, `sourceSeqEnd` and **`experimental_messageSeq`**, which is the `msg` value of a message link. |
| Message deep link | bb's native reference syntax `@thread:<thr>#msg=<seq>` (bb 0.46.1 bundle, and `bb thread log --message`) | bb renders it as a project-aware link. `useBbNavigate()` (`:21683-21732`) has `toThread(threadId)` with no message parameter, and `openUrl(url)`. |
| Re-read the source later | `sdk.threads.message({threadId, seq, before?, after?})` | Also `bb thread log --message <seq>`. |
| Capture arbitrary UI | `app.contentScripts.register` | Same-origin DOM access. There is no selection API: you call `window.getSelection()` yourself. |
| Turn a pad item into composer context | `bb.ui.registerMentionProvider` (`:23989`) | Server-side. `search({query, threadId})` and `resolve(id) → {context, experimental_images?}`. |
| Storage | `bb.storage.kv` (≤256KB per value, in `bb.db`) and `bb.storage.database()` (per-plugin SQLite) (`:22525-22543`) | Neither has a built-in scope; key by thread yourself. Also `sdk.threads.{get,update}PluginMetadata` (per-thread JSON) and `sdk.threads.storageLocation` (`:18448`), the thread's file directory, which is where binary files such as screenshots can go. |
| Live sync | `bb.realtime.publish` and `useRealtime` | Broadcasts to all clients; filter by `threadId` in the payload. |
| Message directives | `messageDirective` (`:20184`) and `experimental_codeFenceRenderer` (`:20204`) | Render custom markup inside messages. An agent could emit "pin this" or render a pad chip inline. |

Limits:
- Plugins cannot add timeline rows to arbitrary threads.
- Embedded `ThreadChat` timelines do not show slot-registered message actions.
- `ctx.openPanel` works only in the main thread view.
- There is no part-level id below a message. Part anchoring has to be done with a text quote.

## 4. The kb canvas

Code is in `/stuff/workspace/repos/kb/packages/extension/`.

**Packages.** The canvas is three packages (DESIGN.md:2791-2811):
- `@kb/canvas`: the shared document, geometry and verbs, about 9.3k lines.
- `@kb/canvas-ui`: the React 2D renderer (DOM cards and SVG edges) and the three.js WebGPU 3D renderer, about 16.2k lines.
- `@kb/ext-canvas`: the Effect backend write path, about 2k lines.

It uses no canvas library: no tldraw and no react-flow.

**Data model**
- The document is **JSON Canvas 1.0**, stored as one JSON string in the `sys.f.canvas` prop of a `#canvas` node (`canvas/src/ids.ts:8-14`, `canvas/src/world.ts:78-84`).
- An item is `{id,type,x,y,width,height,z?,rotation?,color?,nodeId?,parent?,link?,…}` (`canvas/src/doc.ts:75-120`).
- The only places the document touches the graph are the optional `nodeId` on an item and `kbLink` on an edge (`doc.ts:56-65`).
- Unknown fields round-trip (`fields.ts:96-103`).

**How separable it is**
- About 87% of `@kb/canvas` is host-agnostic. Ten files are coupled to kb, about 1.2k lines: `camera`, `comments`, `context`, `extension`, `pages`, `references`, `seed`, `svg`, `view` and `world`.
- `CanvasWorld` (`world.ts:19-66`) is already a read port.
- About 60% of `canvas-ui` is pure math and interaction: camera, pointer state machine, selection, keymap, tool and transform input. The other 40% (React shell, node cards through `NodeRow`, inspectors) depends on `@kb/ui-sdk`'s `BrowserHost` (`kit/ui-sdk/src/host.ts:46-126`). That is already the single seam for writes, which go through `invoke("ext.canvas.tx.apply")` (`canvas-ui/src/canvas-api.ts:120-141`).

**Effect v4**
- Only the backend (`ext-canvas`) and plugin wiring use Effect.
- The UI and document layers are plain TypeScript and React.
- An SDK with a plain-function core and a port interface carries no Effect requirement. kb's host adapter can stay in Effect.

**Rule 1 fit**
- The SDK boundary should be *derived from* the existing seams, `CanvasWorld` and `BrowserHost`, as a narrower `SpatialHost` port. It should not be a parallel canvas.
- Each host (kb, bb, in-memory) becomes one implementation tested by one contract suite, in the same way kb's store backends share `store-contract.ts` ("One contract, every implementation").
- A `canvas2` would break Rule 1.

**tldraw comparison**
- **Licence.** The tldraw SDK is not open source. Production use needs a licence key, and a hobby key shows a watermark. kb's own parity brainstorm records this and rules out tldraw interop (`docs/brainstorms/2026-10-17-kb-canvas-tldraw-parity/README.md:115`, `:209`).
- **Trade-off.** tldraw is far more polished on day one. However:
  - its store format is its own;
  - it adds a heavy bundle inside a plugin panel;
  - it would fork the owner's spatial model away from kb's JSON Canvas.

**Existing plugins**
- `canvas-links` (`assets/bb-plugins/canvas-links`) tracks tldraw-offline files for each session. It does not touch kb's canvas. It is the house precedent for the `threadPanelAction` + RPC + host-entry pattern (`app.tsx:265-266`, `server.ts:14-31`).
- The kb bb plugin embeds the **whole kb UI in an iframe** (`app.tsx:111`, `:160-171`). It exists only in an unmerged worktree, `.claude/worktrees/agent-aa393de098053b4f5/assets/bb-plugins/kb`. The canvas cannot be embedded on its own today.

---

## 5. Options

Each option is described by the same six points: what it is, effort, UX, storage, how reliably a capture links back, and how much a bb upgrade could break it.

### (a) Fork sticky-notes and add agentation-style capture

- **What it is.** Keep the overlay over the thread. Add a `messageAction` and a content-script capture that create notes with a source anchor.
- **Effort.** About 2–3 days.
- **UX.**
  - Notes float over the chat, which is close to what the owner likes visually.
  - There is no real canvas: no pan, zoom, edges or grouping, and space is limited to the pane.
  - It gets cluttered as captures pile up, and notes cover the conversation they cite.
- **Storage.** Per-thread SQLite rows on the bb server, as today, plus anchor columns.
- **Deep-link reliability.** Good, if it uses `msg=<seq>` (see the data model in §7). The fork does not get this for free: sticky-notes today only links to threads.
- **Fragility on bb upgrades: high.** The composer-banner anchor and the DOM-ancestry walk are both a self-described workaround (`README.md:25`). Content-script capture adds DOM coupling.

### (b) New bb plugin: a thread-scoped canvas panel with capture, stored in kb as nodes

- **What it is.**
  - `messageAction` is the capture: it records the selected text plus the message reference.
  - `threadPanelAction` "Scratchpad" holds a simple freeform board: cards, pan and zoom, drag.
  - The server writes each capture as a kb `#capture` node with a `source` and a back-reference. The board is a kb `#canvas` document whose items carry `nodeId`.
- **Effort.** About 1–1.5 weeks. Most of it is the kb write path from the bb server, plus deciding *which* kb store to use (see Q3).
- **UX.**
  - It lives in a proper side panel next to the thread, with a real 2D space.
  - Captures also show up in kb: backlinks, search, and the full kb canvas.
- **Storage.** kb, either a personal store or the repo store, reached over kb's action API in the same way as `kb_call`.
  - It survives the thread being deleted.
  - It is synced and backed up with kb.
  - It adds a hard runtime dependency on kb being reachable from the bb server.
- **Deep-link reliability.** Good (`seq` plus a text quote). As a bonus, kb's backlinks give a "where did I capture this" view.
- **Fragility on bb upgrades: low.** It uses only stable slots (`messageAction`, `threadPanelAction`, RPC, realtime). The one experimental field is `experimental_messageSeq`.

### (c) Extract the kb canvas core into a spatial SDK and embed it in a bb panel

- **What it is.**
  - A host-agnostic core: JSON Canvas document, geometry, verbs, camera, pointer, selection and keymap.
  - A React renderer on top of the core.
  - A `SpatialHost` port: `readDoc`, `writeDoc`, `subscribe`, `renderCard(item)`, `uploadAsset`, `readCamera`, `writeCamera`, `openSource(item)`.
  - Adapters for kb (the existing `BrowserHost`) and for bb (plugin RPC plus SQLite or kb), plus an in-memory adapter for the contract suite.
- **Effort.** About 3–6 weeks, done in the kb repo under its own AGENTS.md:
  - peeling `@kb/ui-sdk` helpers out of about 45 files;
  - packaging and publishing;
  - a bundle that runs inside a bb plugin (no Bun-only or `node:*` imports in the shared scope, which is already enforced);
  - the contract suite.
- **UX.** The best end state: the same canvas, feel and keymap in kb and in bb, with 2D and 3D.
- **Storage.** Pluggable. It can start on bb SQLite and move to kb later without changing the document format.
- **Deep-link reliability.** Same as (b). `openSource` is a host hook, so bb implements it with `msg=` and kb with node navigation.
- **Fragility on bb upgrades: low**, the same slots as (b). The risk moves to keeping kb's versioning and the SDK release in step.

### (d) tldraw SDK in a bb panel

- **What it is.** Mount `<Tldraw>` in a `threadPanelAction` with a custom "capture" shape. Each shape's `meta` holds the anchor. Persist with a snapshot per thread in plugin SQLite.
- **Effort.** About 3–5 days to a polished result.
- **UX.** Excellent from day one: arrows, frames, text, images and export.
- **Storage.** tldraw snapshot JSON in plugin SQLite. It can be reached from kb only by a converter.
- **Deep-link reliability.** Same as (b) through `meta`.
- **Fragility.**
  - On bb upgrades: medium. The slots themselves are stable, but tldraw is a large bundle inside a plugin and its own CSS and pointer handling compete with bb's.
  - On tldraw upgrades: medium.
- **Licence.** It needs a licence key, or shows the hobby watermark. That is acceptable for a private plugin but a non-starter for publishing it.
- **Strategy.** It pulls the owner's spatial work into a second format, against the "kb canvas is the generic product" direction.

### Comparison

| | Effort | UX | Storage | Deep link | Fragility |
|---|---|---|---|---|---|
| (a) fork sticky-notes | 2–3 d | overlay, cramped | bb SQLite, per thread | good (once added) | **high** |
| (b) new plugin + kb nodes | 1–1.5 wk | panel, basic board, kb backlinks | kb | good | low |
| (c) kb canvas SDK in bb | 3–6 wk | best, same as kb | pluggable | good | low (SDK upkeep) |
| (d) tldraw in panel | 3–5 d | very good now | tldraw snapshot in bb SQLite | good | medium, plus licence |

---

## 6. Recommended path

This is (b) and (c) in sequence, built so that nothing is thrown away. The MVP stores **JSON Canvas from day one**, so moving to the extracted SDK means swapping the renderer, not migrating data.

**Phase 1: MVP (about 3–4 days).** A new plugin, `assets/bb-plugins/scratchpad`, registered in the bb stack.
- **Capture.** `messageAction` "Pin to scratchpad".
  - From the selection menu it gets `selectedText`. From the action bar it takes the whole message.
  - It sends `{threadId, messageId, seq, role, quote}` to an RPC, then calls `ctx.openPanel({actionId:"scratchpad"})`.
- **Surface.** `threadPanelAction` "Scratchpad", flush layout. A minimal board: absolutely positioned cards, drag, pan and zoom on wheel, free text notes. Free text notes keep what is good about sticky-notes.
- **Storage.** Plugin SQLite with two tables: `captures` (the §7 model) and `boards` (one JSON Canvas document per thread). Writes are followed by `realtime.publish` with the `threadId`. Rows are deleted on `thread.deleted`, or kept, depending on the answer to Q4.
- **Linking back.**
  - Clicking a card calls `navigate.toThread(threadId)`, then `openUrl(<thread url>#msg=<seq>)`. The exact URL form and whether bb scrolls to and highlights the message must be checked on a live thread.
  - "Copy reference" puts `@thread:<thr>#msg=<seq>` on the clipboard, which bb already renders as a link.
- **Back into the agent.** A mention provider `scratch` whose `search` lists this thread's captures and whose `resolve` returns the quote and its source. That lets the owner @-mention a pinned snippet into a later prompt.
- **Leave out of the MVP:** screenshots, element capture, kb, edges.

**Phase 2: kb as a storage adapter (about 1 week).**
- Define `ScratchStore` (captures and board documents) with one contract suite, then add a kb implementation.
  - A capture becomes a `#capture` node with fields `source` (url), `quote`, `thread` and `seq`.
  - The board becomes a `#canvas` whose items carry `nodeId`.
- The SQLite implementation stays as the offline fallback.

**Phase 3: extract the spatial SDK from kb (option c), in the kb repo.**
- Derive `SpatialHost` from `CanvasWorld` and `BrowserHost`, and publish the core and renderer.
- Replace the MVP board with it. The documents are already JSON Canvas, so nothing has to be migrated.

**Phase 4: optional capture of richer sources.**
- A content script for non-message UI such as plugin panels, diffs and file views. It would borrow agentation's element-path decoration idea under MIT, without the PolyForm-licensed toolbar.
- Screenshots: a DOM-to-image render on the client, saved as a file under `sdk.threads.storageLocation` or the plugin `dataDir` and referenced by path.

Why not (a): its UI base is the fragile overlay workaround, and its layout model is not a canvas.
Why not (d): the licence watermark, a second document format, and it works against the generic kb canvas.

---

## 7. Data model for a captured item

The model is JSON Canvas-compatible. The capture is the *content*; the board item only *places* it. This matches kb, where items point at nodes through `nodeId`.

```ts
type Capture = {
  id: string                    // "cap_<ulid>"
  threadId: string              // thr_…
  projectId: string | null
  source:
    | { kind: "message"
        messageId: string                 // ThreadChatMessageReference.id
        seq: number                       // experimental_messageSeq → "#msg=<seq>"
        role: "assistant" | "user"
        // Part-level anchor via a W3C-style text-quote selector, since bb has no part ids:
        quote: { exact: string; prefix?: string; suffix?: string } | null }
    | { kind: "element"                   // phase 4 (content-script)
        route: string
        elementPath: string               // CSS path decorated with data-panel-id / data-bb-plugin
        pluginId: string | null
        text: string | null }
    | { kind: "url"; url: string; title: string | null }
  ref: string                   // "@thread:thr_x#msg=42", the canonical, bb-rendered link
  text: string                  // the captured quote or message text (snapshot; source may change)
  note: string                  // the owner's own annotation
  screenshot: { path: string; width: number; height: number } | null
  createdAt: number
  createdBy: string | null      // actor id, if bb-identity is wanted later
  kbNodeId: string | null       // phase 2: the #capture node
}

// The board is a JSON Canvas 1.0 document, one per thread (or per named board, see Q2)
type Board = {
  id: string; threadId: string
  doc: { nodes: Array<{ id: string; type: "text" | "link" | "file" | "group"
                        x: number; y: number; width: number; height: number
                        color?: string; text?: string
                        captureId?: string        // extension field, round-trips like kb's nodeId
                        nodeId?: string }>        // phase 2 kb node
         edges: Array<{ id: string; fromNode: string; toNode: string; label?: string }> }
  updatedAt: number
}
```

How a capture is resolved back to its source:
1. Open `ref`, which navigates to the message by `seq`.
2. Re-fetch it with `sdk.threads.message({threadId, seq})`.
3. Find `quote.exact` in the text, using `prefix` and `suffix` to tell repeated matches apart, and highlight it.
4. If the quote is no longer found (for example after an edit or compaction), fall back to message-level. If the thread was deleted, show the stored `text` snapshot.

---

## 8. Open questions for the owner

1. **Scope of a board.** One canvas per thread, as asked? Or per project, with each capture still linking to its thread, so that ideas can be gathered across threads? The model supports both: a board is keyed by `threadId` or by a board id.
2. **More than one board per thread?** Or a single scratchpad?
3. **Which kb store do captures go into in phase 2?** This repo's `.kb` store is repo-scoped and committed. Captures from arbitrary bb threads probably belong in a personal kb store. Is there one that the bb server on shared-server can reach?
4. **Lifetime.** When a thread is deleted, should its board be deleted (as sticky-notes does) or kept as orphaned references? kb storage keeps them by default.
5. **Overlay or panel.** Is the floating-over-chat feel of sticky-notes important, or is a side panel acceptable? The SDK has no supported thread overlay, and the overlay is the fragile part.
6. **Capturing user messages.** The selection menu covers assistant messages only, so a user message can only be captured whole. Is that enough?
7. **Screenshots.** Are they needed in the MVP, or only for non-message captures later?
8. **Sharing.** bb server storage is shared by everyone on shared-server, since it is a multi-person host. Should pads be private to their author?
9. **Investment in the SDK.** Is the kb canvas SDK extraction (phase 3) on the kb roadmap now? Or should the MVP's own board be kept deliberately throwaway?
