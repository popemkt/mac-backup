# "tldraw, but ours": a 2D+3D scriptable canvas for kb

Research date: 2026-09-29. This report synthesizes a local inspection of the owner's tldraw offline setup and five parallel web-research passes. Their raw notes sit next to this file and carry every URL, version and UNVERIFIED marker:

- `notes-tldraw-excalidraw.md`: tldraw SDK, sync, formats, offline app, AI kits; Excalidraw; JSON Canvas
- `notes-commercial.md`: Figma/FigJam, Miro, Muse/Allume, Heptabase, Kosmik, Kinopio, Scrintal, Milanote, AFFiNE, Logseq, Penpot, Frame0, Obsidian, spatial/VR
- `notes-3d.md`: Spline, Womp, Bezi, Vizcom, ShapesXR, Gravity Sketch, Arkio, Rive, Theatre.js, Needle, three.js editor, PlayCanvas, Babylon, R3F/drei/uikit, WebGPU status, 2.5D canvases, rendering techniques
- `notes-scripting.md`: Patchwork/Embark/Potluck/Inkling, Observable, Folk, Natto, cables.gl, Nodes.io, vvvv, Excalidraw Automate, Scrapbox, Glamorous Toolkit, Lively, Webstrates, Livebook, anywidget; sandboxing (QuickJS, SES, ShadowRealm, iframes, WASI, Extism, Bun/Deno); capability patterns; agents on live canvases
- `notes-formats.md`: JSON Canvas, tldraw snapshot, Excalidraw, glTF 2.0/2.1 and KHR_interactivity, OpenUSD, X3D, Automerge, Yjs, Loro, Figma's multiplayer model, plus a full comparison table
- `tldraw-readme.md` and `tl/readme.md`: the tldraw offline app's own agent API readme (served at `GET localhost:7236/readme`)

---

## 0. TL;DR

1. **What the owner likes in tldraw offline.** A single local file holds the canvas, its assets and its behavior scripts. Agents drive the live editor through a local, token-gated HTTP API: they can read it, run one-off JavaScript against it, add durable scripts, check whether a script applied, stop what they started, lint, screenshot and comment. Scripts are trusted by content digest. The whole design assumes a human and an agent share one board.
2. **Nothing off the shelf gives kb that with an open license and 2D+3D.**
   - The tldraw SDK (5.4.2) needs a production key.
   - tldraw offline is closed ("All rights reserved").
   - Excalidraw is MIT but 2D-only and has no in-file scripts.
   - Every commercial tool is SaaS and proprietary.
   - The 3D tools (Spline, Needle) are proprietary, or they bundle or fork three.js.
3. **Recommended shape** (it follows Rule 1, "everything is a node"):
   - **One scene graph made of kb nodes.** A placement is a relationship node from a canvas to what it shows, with a transform (`x, y, z, rotation, scale`) and a fractional `order`.
   - **2D and 3D are two projections** of that one graph, picked by the camera mode on a view node.
   - **JSON Canvas 1.0 becomes an import/export projection** that drops 3D. It stops being the storage model.
   - **glTF (.glb) is only the format for 3D assets and for export.**
   - **Scripts are `#script` nodes** that attach to a canvas or tag through a relationship. They get a capability-scoped `ctx` in one contract with two engines: a trusted Worker, and QuickJS-wasm for untrusted code. Their UI goes in a sandboxed iframe, the same channel as kb's MCP Apps `ui://kb/view/*` resources.
   - **Trust is per digest, per machine,** and kept as backup state, never committed.
   - **Agents edit through the same kb actions and transactions as the UI.** Presence and cursors are ephemeral traffic over `/ws`.
4. **Renderer.** Keep the rich markdown cards in DOM for the 2D projection, and draw 3D on the existing three.js WebGPU/TSL scene kit. The two are joined by one canvas-renderer contract and one camera model: an orthographic 2D camera equals a CSS transform, and a dolly-zoom crosses into perspective 3D. Upgrade three.js from r180 to r186 so cards can appear in 3D as textures through `HTMLTexture` (HTML-in-Canvas). Don't add R3F or drei yet; both are mid-migration to WebGPU in alpha.
5. **License traps:**
   - tldraw SDK, tldraw sync and `@tldraw/commenting`
   - tldraw offline (closed)
   - Needle Engine and `@needle-tools/usd` (proprietary / PolyForm-NC)
   - Spline runtime (proprietary, bundles its own three)
   - Theatre.js studio (AGPL, dormant)
   - Obsidian Excalidraw plugin (now AGPL-3.0)
   - Kinopio (PolyForm-NC)
   - OctoBase (AGPL)
   - Logseq (AGPL)

   Everything recommended above is MIT, Apache-2.0 or ISC, or an open spec.

---

## 1. The owner's tldraw offline setup (local inspection, read-only)

### 1.1 What is installed
- `/Applications/tldraw offline.app`: bundle id `com.tldraw.desktop`, **v1.20.0**, Electron. It auto-updates from GitHub `tldraw/tldraw-offline`, a repo that holds only releases and issues. The app is closed source.
- The bundled SDK types (`Resources/sdk-types/meta.json`) are **tldraw 5.5.0-next.c91b2de0a423**, with these packages: `tldraw`, `@tldraw/editor`, `store`, `tlschema`, `sync`, `driver`, `mermaid`, `commenting`, `mentions`.
- `THIRD_PARTY_NOTICES.txt` states: "The tldraw SDK is proprietary software with a tiered license model."
- `~/Library/Application Support/tldraw/` contains:
  - `server.json`: port and a per-launch bearer token
  - `config.json`: preferences; the editor identity `{id, color, name: "popemkt"}`; per-board view preferences; and **`scriptConsent`**, a map from document id to `{decision: "trusted", digest: sha256}`
  - `agent-skills.json`: the list of files and hooks the app installed
  - `working/`: unpacked working directories of open documents
- **Installed agent integration** (through the app's "Install Agent Skills"):
  - A shared skill at `~/skills/tldraw-offline/SKILL.md`, plus `tq.mjs`, a curl-free request helper that re-reads the port and token on every call.
  - Copies or pointers for Claude Code (`~/.claude/skills/tldraw-offline/SKILL.md`, `~/.claude/agents/tldraw-offline.md`), Codex, Cursor, Gemini CLI and Pi.
  - A `SubagentStart` hook in `~/.claude/settings.json` and `~/.codex/hooks.json` that runs `inject-server-context.mjs`. The hook injects the server URL, the token and a snapshot of the open documents into every subagent.
  - The Claude agent definition is `model: sonnet` with tools Bash, Read, Write, Edit and MultiEdit, and its body is essentially the skill text.

### 1.2 File format: `.tldraw` (new) vs `.tldr` (legacy)
Four `.tldraw` files exist in `~/Documents` (`brainstorming topology`, `TestingDomainServices`, `draiver-validation-2026-09-29`, `Journey test-name chain`). I inspected copies in the scratchpad.

- **Container:** a **zip with method=store**, meaning no compression, and fixed 1980 timestamps so the output is deterministic. It holds:
  - `db.sqlite`: the **tldraw-sync SQLite storage schema**. `documents(id, state BLOB, lastChangedClock)` stores tldraw records as JSON: `shape:*`, `binding:*`, `page:*`, `document:*`, `user:*`. `objects(...)` holds the `comment-thread:*` and `comment:*` records of the commenting lane. `tombstones(id, clock)` records deletions. `metadata(migrationVersion, documentClock, tombstoneHistoryStartsAtClock, schema)`, where `schema` is `SerializedSchema` v2 (`{schemaVersion: 2, sequences: {"com.tldraw.shape.geo": 11, …}}`).
  - `metadata.json`: `{formatVersion: 1, displayName, createdWith: "@tl/file-format", documentClock, script: {sha256, author: "agent"}, scriptTypes: {shapes, bindings, assets}}`.
  - `session.json`: per-user camera, current page and selection, kept outside the document.
  - `preview.png`: a thumbnail.
  - `assets/`: content-addressed media blobs.
  - **`script/main.js`, `script/config.js` and sibling modules**: the board script bundle.
- **Example record** (a shape):

  ```json
  {"id":"shape:title","type":"text","x":0,"y":0,"rotation":0,"index":"a1er2","parentId":"page:page","props":{…,"richText":{…}},"meta":{},"typeName":"shape"}
  ```

  Shapes use a flat id-keyed map with a parent pointer, a fractional `index` and a free `meta` bag. Arbitrary data such as `meta.tip` or `meta.code` goes in `meta`, and the scripts read it from there.
- **Legacy `.tldr`:** plain JSON `{tldrawFileFormatVersion: 1, schema, records[]}`. The app opens it but never creates it.
- **Takeaways:**
  - The document is a sync-server database snapshot plus code. It is not git-diffable, because the records sit inside SQLite inside a zip.
  - The things worth copying are the *separation*: document, session, assets and scripts are separate parts. Records are content-addressed, and code is pinned by digest.

### 1.3 Durable scripts attached to canvases
- **Two tiers of behavior:**
  - **Ephemeral snippets:** code posted to `/exec` that dies with the window.
  - **Durable board scripts:** saved in the file, and run on every open by every participant.
- **Where they are edited:** `POST /api/doc/:id/script-workspace` exposes a working directory. An agent or human edits `script/main.js`, and optionally `config.js` and siblings, with normal file tools. It gets types in `.script-workspace/script-context.d.ts` and a `jsconfig` mapping `tldraw` to the app's SDK declarations, so autocomplete is full.
- **What the watcher does on change:**
  1. Rejects symlinks and non-regular files.
  2. Embeds the bundle into the document and updates `metadata.json.script.sha256`.
  3. Marks the document unsaved.
  4. **Grants local trust for that digest.** It is stored in `config.json` under `scriptConsent`, so trust is per machine and never inside the file.
  5. Hot-reruns `main.js` without a remount. A change to `config.js` rebuilds the editor, which keeps the document but resets undo.
- **Status:** `GET /script-status` returns a derived `state` of `not-watching | no-entry | pending | error | applied`, plus digests. Errors go to `.script-workspace/error.log`.
- **Entry points:**
  - `main.js`: `export default function ({ editor, helpers, signal, app })`. It runs after mount, gets the whole live `Editor`, and ties every listener to the `AbortSignal`. `app` is `app.window` events plus `app.board.isHost`.
  - `config.js`: runs **before** mount. It receives `{config}` and returns a `TldrawConfig` with `shapeUtils`, `bindingUtils`, `assetUtils`, `overlayUtils`, `tools`, `components`, `options`, `getShapeVisibility`, `assetUrls` and `initialState`. **A document can therefore define its own shape types, tools, bindings, overlays and UI.**
  - Imports resolve only for `tldraw`, `react` and `react-dom`, through an import map to the app's own instances. There are no npm packages.
- **Collaboration rules:**
  - Every client runs the whole bundle, and nothing elects a writer.
  - Registration and rendering must be identical on every client.
  - Writes are guarded by `app.board.isHost`.
  - Creation uses stable ids: `createShapeIfMissing` and `createShapesIfMissing`.
  - Per-client UI state stays in module scope.
  - `helpers.renderEphemeral(fn)` paints *without* dirtying, saving, syncing or undo.
  - Controls are locked shapes.
- **Real scripts on disk:**
  - `draiver-validation`: `config.js` registers a `TooltipOverlayUtil` that draws a hover card for any shape carrying `meta.tip`. `main.js` sets the house style for the next shapes (sans, solid, elbow arrows).
  - `TestingDomainServices`: `main.js` listens to `pointer_move` and paints the hovered block's `meta.code`, which is C#, into a side panel through `renderEphemeral`.
  - Both scripts have `author: "agent"`. **The owner's agents write board behavior.**
- **No sandbox.** The only gate is the per-digest trust prompt.

### 1.4 Agent API surface
Local HTTP on `localhost:7236` (fallback: the port in `server.json`). Every route except `GET /` and `/readme` needs a bearer token.

| Endpoint | Purpose |
|---|---|
| `POST /api/search` | Runs JavaScript against an `api` object. Static reference: `api.members` (Editor plus util lifecycle methods with signature, description and category), `api.helpers`, `api.imports` (the index of importable SDK symbols) and `api.recipes` (15 worked recipes). Live reads: `getDocs`, `getFocusedDoc`, `getShapes`, `getBindings`, `getComments`, `getScriptStatus`, `getScriptRuns`, `getScreenshot` (canvas or window mode, returns a JPEG path) |
| `POST /api/docs/create` | Creates and opens a new named `.tldraw` file |
| `POST /api/doc/:id/exec` | Runs JavaScript against the live `Editor`. Top-level `await` works. Snippets per document run one at a time, and a failed snippet is **rolled back**. The response carries `snippetId` and `lints: {new, resolved}` |
| `POST /api/doc/:id/script-workspace`, `GET …/script-status` | Durable script editing and proof that the script applied |
| `GET /api/doc/:id/scripts`, `DELETE …/snippets/:id` | Lists running snippets and board-script outcomes, and aborts one (a stop, not an undo) |

- **Helpers:** `createArrowBetweenShapes` (always creates real bindings), `boxShapes`, `createShapeIfMissing` and the plural form, `translateShapes`, `onShapeTranslate`, `renderEphemeral`, `getLints`, `mermaid(source)` (builds whole bound diagrams), `saveDoc` (only from `/exec`), `richTextToPlainText`.
- **Ownership model:** a document is `local | remote | server`. `remote` means the board was joined over LAN from another host; `server` means an "offline server" board, whose script is written through the server's API. `shared: true` tells the agent people are on the board right now.
- **Comments:** threads are anchored to a shape, point, region or page, using `@tldraw/commenting` verbs. Agents reply, resolve, and skip threads addressed to others. Commenting is gated per board by its owner.
- **Operational rules baked into the skill:**
  - Save local documents yourself.
  - Never edit the archive or `db.sqlite` while the document is open.
  - Re-resolve documents by name after a window closes.
  - Sanity-check before bulk deletes.
  - Verify once, then stop.

### 1.5 Lints
- `helpers.getLints()` returns `{lints: [{type, shapeIds, message}]}`. The observed lint ids are `friendless-arrow` (an arrow not bound at both ends), `growY-on-shape` (text overflowing its shape) and `overlapping-text`.
- `/exec` reports only the lints that snippet introduced or resolved. Agents are told to fix every `new` lint and only on the shapes they touched.
- An intentional exception is written as `meta.lintIgnore: ['<id>']` on that shape.
- **Why it matters:** the canvas gives the agent a feedback loop about the canvas's own quality, not only about success or failure.

### 1.6 What kb should reproduce (the "tldraw offline parity" checklist)
1. A single-file, portable canvas that holds its behavior. For kb, that is the graph plus script nodes.
2. Live exec against the real model, with rollback on failure, serialized per document, and an abort handle.
3. Durable scripts: edited as ordinary files or nodes, trusted by digest, hot-applied, with a status check that proves application.
4. Extension of the model itself (custom shape, binding, tool and overlay types), not just imperative macros.
5. An ephemeral render path, kept separate from durable writes.
6. A writer rule on shared boards, plus idempotent creates with stable ids.
7. Lints returned as a diff with every agent action.
8. Anchored comments as the channel between humans and agents.
9. Discoverable API reference and recipes *served by the running app*, plus an installer that drops skills and hooks into every agent harness.

kb already has pieces of 1, 8 and 9: nodes, refs, the MCP server and `kb_manifest`.

---

## 2. Landscape survey (condensed; details, links and dates in the notes files)

### 2.1 2D whiteboards and PKM canvases

| Product | 2D/3D | Format | Scripting / API | AI and agents | License |
|---|---|---|---|---|---|
| **tldraw SDK** 5.4.2 (2026-09-10; 4.0 2025-09-18, 5.0 2026-05-06) | 2D | `.tldr` JSON records + migrations; `.tldraw` zip+SQLite (Desktop) | Full SDK: ShapeUtil, BindingUtil, OverlayUtil (5.0), tools, `@tldraw/driver` | Agent starter kit (MIT; Zod action schemas, streamed); MCP App (2026-03-03); Fairies (Dec 2025); make real; computer; flash | **Source-available; production key required** (trial 100 days / commercial / hobby with watermark) |
| **tldraw offline** v1.20.0 (launched 2026-07-16) | 2D | `.tldraw` | Board scripts, local agent HTTP API | Skills installer, lints, comments, LAN multiplayer (2026-08-13; reportedly unencrypted) | Free, **closed source** |
| **Excalidraw** 0.18.1 (2026-04-20) | 2D | `.excalidraw` JSON (`elements`, `appState`, `files`; `customData`, fractional `index`) | Embeddable React component; Obsidian plugin "Excalidraw Automate" (scripts are vault `.md` files, 184-script library) | Text-to-diagram through Mermaid; Excalidraw+ public API and MCP (beta, May 2026); official `excalidraw-mcp` MCP App | **MIT**; the Obsidian plugin is **AGPL-3.0** since 2026-05 |
| **Figma / FigJam** | 2D; 3D transforms waitlisted (Config 2026) | `.fig` proprietary | Plugin API (QuickJS sandbox + UI iframe), Widget API; Code Layers (closed beta) | Remote MCP with **write** (`use_figma`, `generate_diagram`, `get_figjam` as XML); FigJam agent skills (2026-04-28); Make | Proprietary SaaS |
| **Miro** | 2D | proprietary | Web SDK v2, REST v2 | MCP (2026-02-02, all plans); **board read and written as SVG, updates applied as SVG diffs**; Sidekicks, Flows | Proprietary |
| **Penpot** | 2D | **open SVG + JSON** | Plugin API | Official MCP with `execute_code` (plugin-API JS) | **MPL-2.0** |
| **AFFiNE** / BlockSuite | 2D edgeless + docs, one data model | Yjs CRDT docs | BlockSuite toolkit | Built-in MCP (read-only default) | App MIT; BlockSuite MPL-2.0; OctoBase **AGPL**; server EE |
| **Heptabase** | 2D | proprietary | none public | Official MCP (2025-12-30) | Proprietary |
| **Allume** (formerly Muse; v4.0 2026-05-02) | 2D ZUI | proprietary | CLI | MCP through the CLI (off / read / read-write) | Proprietary |
| **Frame0** | 2D wireframes | local files | local API server in the app | MCP (MIT, 25 tools), BYOK agent | Proprietary |
| **Obsidian Canvas** | 2D | **JSON Canvas 1.0** (MIT) | plugins; official CLI (1.12) | `kepano/obsidian-skills` (json-canvas skill) | App proprietary, spec MIT |
| Kinopio | 2D | JSON through REST | REST API | — | **PolyForm-NC** (source-available) |
| Logseq whiteboards | 2D (tldraw v1 fork) | — | — | — | AGPL; **removed from the DB version** (2.0 beta, 2026-07-13) |
| Kosmik | — | — | — | — | **Shut down 2026-05-31** |
| Scrintal, Milanote | 2D | proprietary | none / none | minimal | Proprietary |

The pattern to take from this table: every serious 2026 canvas exposes itself to agents through **MCP**. There are three flavors:
- **Declarative CRUD.** Heptabase, the tldraw MCP App and Excalidraw+ expose create/update/delete tools.
- **A whole-canvas serialization.** Miro reads and writes the board as SVG; FigJam exposes it as XML.
- **Code execution against the plugin API.** Penpot's `execute_code`, Figma's `use_figma` and tldraw offline's `/exec` let the agent run code.

### 2.2 3D, 2.5D and spatial

| Product | Relevance | License |
|---|---|---|
| **Spline** (V2, 2026-08-21) | The closest analogue to "one scene, 2D+3D": **Hana** (2D) and the 3D editor share one runtime, and 2D vectors extrude into live 3D. It also has an AI agent that edits scenes, **MCP access**, and a Code tab | Proprietary; runtime bundles its own three 0.185; glTF/USDZ export requires Pro |
| Vectary Canvas (private beta, about April 2026) | "2D, 3D and AR together" for ideation | Proprietary |
| Arcol | One BIM model shown in 2D and 3D, multiplayer | Proprietary |
| **tldraw-3d** (OrionReed, 2024) | A 3D underlay *behind* the 2D tldraw canvas, sharing its camera; shows history on the z axis | no license (a pattern only) |
| Womp, Vizcom, Gravity Sketch, ShapesXR, Arkio | 3D modelling, sketch-to-3D, VR collab and review; ShapesXR syncs Figma frames | Proprietary |
| Bezi | Pivoted to a Unity AI assistant; no longer relevant | — |
| Rive | 2D state machines + data binding + **Luau scripting** (2025-11); good model of a sandboxed script VM inside a file format | Runtimes MIT; editor SaaS |
| Theatre.js | Last npm release 2024-05; development went private | core Apache-2.0, **studio AGPL** |
| Needle Engine | glTF-first three runtime | **Proprietary EULA**; forks three 0.169 |
| three.js editor | `project.json` = ObjectLoader scene + **`scripts` keyed by object uuid**, with handlers `init/start/update/pointer*/key*` compiled with `new Function` (no sandbox) | MIT |
| PlayCanvas | Engine MIT v2.22.6; **editor frontend open-sourced under MIT 2025-07-30**; ESM scripts | MIT (backend hosted) |
| Babylon.js 9.28 | Full KHR_interactivity playback; Node Material Editor; Editor v5.5 | Apache-2.0 |
| R3F 9.8.1 / **v10 alpha**; drei 10.7.9 / **v11 alpha** | v10 adds first-class WebGPU/TSL and multi-canvas; drei v11 moves troika `Text` to `legacy/` (WebGL only) | MIT |
| Apple Freeform (visionOS) | A 2D board with USDZ objects; SharePlay | Free, closed |
| Meta Horizon Workrooms / Microsoft Mesh / Spatial creator tiers | **Discontinued** 2026-02-16 / 2025-12-01 / 2026-07-27 | — |

**WebGPU in 2026:**
- On by default in Chrome and Edge 113+ (desktop), Safari 26 (every Apple platform) and Firefox 141+ on Windows / 145–147+ on macOS.
- Firefox on Linux and Android is still in progress.
- three's `WebGPURenderer` falls back to WebGL2.

**Takeaway from the spatial space:** the market for VR whiteboards is contracting. "3D" in a brainstorming tool should mean *depth as an extra dimension of the same graph* (layers, time, hierarchy, clusters), viewed on a normal screen. It should not mean a VR product.

### 2.3 Scriptable documents and canvases (the "infinite scriptability" lineage)

| System | Where code lives | API given to code | Sandbox | Transferable idea |
|---|---|---|---|---|
| **Ink & Switch Patchwork** (2025–26) | Code is **Automerge docs**; a directory doc maps paths to `automerge:` URLs, and a service worker lets you `import()` straight from the CRDT, **pinned by heads** | Tool = `(docHandle, element) => cleanup`, chosen by the doc's datatype | none | Code as data in the store, content-pinned; tools dispatched by datatype; **Breadboard** makes the wiring visible, editable data |
| Embark / Potluck | Formulas in the doc | Formulas over the outline or text; annotations never write back | — | Computation is reified as data; overlays never feed back into the source |
| Inkling / Crosscut | Programs drawn on the canvas | Constraints, wires | — | Running code is a visible canvas object |
| **tldraw offline** | `script/` inside the file | The whole `Editor` + helpers + signal | none (per-digest trust) | See §1 |
| Obsidian Excalidraw Automate | Scripts are vault notes | `ea` + `utils` | none | **A script is a note** |
| Scrapbox / Cosense | `code:script.js` blocks on pages, importable by URL | `scrapbox` global | none (docs warn about exfiltration) | **Code is a page** |
| Webstrates | Code lives in the persisted, synced DOM | The DOM | none | Transient elements and attributes are never persisted |
| Observable Notebook Kit 2.x | `<script>` cells in an HTML file (source only, diffs cleanly) | Reactive runtime | iframe | Reactive recomputation; the file stores source, not output |
| Livebook smart cells, **anywidget AFM** | Notebook source; UI state serialized as attributes that generate code | `initialize/render({model, el, signal})` | iframe (Livebook, UNVERIFIED) | **One small host-neutral widget ABI with an AbortSignal** |
| Glamorous Toolkit, Lively.next, Smalltalk, HyperCard | Code attached to objects / types | Everything | none | Views chosen by type; handlers on objects; events bubble up the containment hierarchy |
| Folk Computer / folkjs | Programs coordinate through a shared **claim/wish/when fact database**; folk-sync makes a DOM subtree a CRDT | — | none | **Programs talk only through the shared fact base, which maps directly onto datalog over kb** |
| cables.gl (MIT since 2024), Nodes.io, vvvv, Natto | Node-and-wire patches with code in nodes | Ports | varies | Dataflow on the canvas |
| **Figma plugins** | External bundle | Sync `figma.*` API in **QuickJS-wasm** + UI in an iframe | **Yes** | The Realms shim was escaped (2019); **a separate VM plus a UI iframe** is the proven split |

**Sandboxing facts for 2026** (details in `notes-scripting.md`):
- QuickJS-wasm (`quickjs-emscripten` 0.32.0, MIT) has memory, stack and interrupt limits, but has not been audited.
- SES 2.3.0 has no CPU or memory limits, so it is defence in depth only.
- **ShadowRealm is still Stage 2.7 and shipped nowhere.**
- Sandboxed iframes are async-only.
- WASI 0.3 was released 2026-06-11.
- Extism 1.30 exists.
- **Bun has no permission model** (the `$.sandbox` PR was closed 2026-09-21).
- MCP Apps (SEP-1865, final 2026-01-26) standardizes `ui://` resources rendered in a **required sandboxed iframe** with JSON-RPC.

---

## 3. File formats for a 2D+3D scene document

Full table in `notes-formats.md`. Scores: ++ strong, + ok, ~ partial, − weak, −− bad.

| Format | Open | Diffable / git | Extensible | CRDT fit | Embeds scripts | External refs | 2D/3D |
|---|---|---|---|---|---|---|---|
| **JSON Canvas 1.0** (MIT, 2024-03-11, unchanged) | ++ | + JSON, but **z-order = array order**, integer coordinates only | − the spec says nothing about unknown fields or custom types (issues #13 and #57 still open); kb's `kb-node` type is already off-spec | + (needs a fractional index) | − | ~ file/link nodes | 2D |
| OCIF 0.7.0 (2026-03-24) | + (no license file) | + | + explicit extensions | + | − | + | 2D |
| tldraw `.tldr` | ~ schema MIT, SDK licensed | + | + `meta`, migrations | ++ (Figma model) | − (app convention) | + `meta` | 2D |
| Excalidraw | ++ MIT | + (inline dataURL files bloat it) | + `customData` | + | − | ~ | 2D |
| **glTF 2.0** (ISO/IEC 12113:2022) | ++ | −− **index-based references** renumber on insert | ++ `extensions` + `extras` | −− | ~ **KHR_interactivity** behavior graphs, ratified around Aug 2026 (vote date UNVERIFIED); explicitly not general scripting | + URIs; **glTF 2.1** external assets + unique ids expected Q4 2026 (UNVERIFIED) | 3D |
| **OpenUSD** v26.08 (TOST 1.0 ≈ Apache-2.0; AOUSD Core Spec 1.0 ratified 2025-12-17) | + | ++ `.usda` text, **path-addressed**, one sublayer per author | ++ codeless schemas, `customData`, variants | ~ | − (strings only) | ++ references/payloads + ArResolver (a `kb://` scheme needs a resolver plugin) | 3D |
| X3D 4.0 (ISO/IEC 19775-1:2023; JSON encoding still draft) | ++ | ~ nested, order matters | + PROTO | − | ++ **Script node with inline ECMAScript** (a security liability) | + | 3D |
| Automerge 3.5 (MIT) | ++ | −− binary | + | ++ but **no move / tree** | + as strings | + `automerge:` URLs | container |
| Yjs 13.6.33 / 14 RC (MIT) | ++ | −− binary | + | ++ but no tree | + | − | container |
| **Loro 1.16.3** (MIT) | ++ | + **lossless JSON op-log export** (`exportJsonUpdates`) | + | ++ **movable tree + movable list + fractional index + time travel** | + | − | container |

**Verdicts:**
- **Git + JSONL + kb ids** already give kb the property every good collaborative scene format converges on: Figma, tldraw and Excalidraw all use `Map<id, Map<prop, value>>` with a parent pointer and a fractional order. That is kb's datom model. **No foreign format should become the store.**
- **JSON Canvas** is a good *interchange* format (Obsidian compatibility, simple export) and a poor *storage* format. It has no extension mechanism, no 3D, z-order by array position and integer coordinates.
- **glTF** is the right format for **3D assets** (`.glb` in `.kb/assets/`, which is backup-owned and never committed) and for **scene export**, with `extras.kb.id` on each node; three.js round-trips `extras` through `userData`. It is never the editable document. KHR_interactivity is a possible *export* target for simple behavior later; Babylon supports it and three.js does not.
- **USD:** borrow its *ideas* and skip the runtime. The ideas are layered, non-destructive overrides, variants, and path addressing. A per-author or per-agent override layer maps cleanly onto "agent proposals" (see §4.5). A full browser USD runtime is either a heavy wasm build or Needle's PolyForm-NC one.
- **X3D** is the cautionary tale of scripts embedded in the data: every reader inherits an untrusted-code problem. Keep scripts as *referenced nodes* with trust by digest.
- **If kb ever needs multi-device offline multi-writer:** Loro is the only CRDT with a tree-move type suited to scene hierarchies *and* a text history format that can be committed. Automerge and Yjs would force Figma-style parent-pointer fields and binary blobs in git.

---

## 4. Recommended architecture for kb

The shape below is driven by kb's own rules in `CLAUDE.md`:
- Rule 1: abstraction before addition, "everything is a node".
- Canvases, graphs and outlines are *projections of one graph*.
- One contract, every implementation.
- Bridges over mirrors.

### 4.1 The model: a scene is part of the graph, not a document beside it
Today a `#canvas` node carries a JSON Canvas 1.0 document in a prop. `kb-node` cards point at store nodes, while shapes, text and groups are JSON-only (`packages/extension/canvas/src/doc.ts`). Adding z, 3D transforms and scripts *inside that prop* would fork the model. It would become a second storage shape with its own ids, its own edges (next to `:node/mentions` and ref props) and its own extension bag. That is the "bespoke storage shape" CLAUDE.md warns about.

Target shape:

- **Canvas** = a `#canvas` node (it exists already).
- **Placement** = a node tagged `#placement` (in effect a reified relationship) with these fields:
  - `canvas` (ref)
  - `shows` (ref to any node: a kb note, a tag, a query, an asset, a script, another canvas)
  - `x`, `y`, `z`, `w`, `h`, `d` (numbers)
  - `rotation` (a quaternion or `rx, ry, rz`)
  - `scale`
  - `order` (fractional-index string: stable, merge-friendly, no array renumbering)
  - `parent` (ref to a group placement, for nesting)
  - `style` fields

  The same node can be placed on many canvases, and each canvas can place it differently.
- **Freeform shapes** (a rectangle, a sticky with text that isn't a note yet) are *also* nodes: an untitled node whose `sys.f.type` is a shape tag (`#shape` with a `kind` field: rect, ellipse, diamond, and later meshes). Promoting a sticky into a real note is then no conversion at all; it is the same node gaining tags. This removes today's `kb-node` vs `shape` split, which is the kind of type distinction Rule 1 says belongs in the data.
- **Edges** drawn on a canvas **are** kb relationships. A drawn arrow is either a ref prop (the existing `KbLink` "native" mode) or a `#connection` node when it is purely visual ("layout" mode). `ext.canvas.tx.apply` already binds edges to ref props; generalize it instead of adding a parallel edge store.
- **Views and cameras** are nodes. A `#view` node refers to a canvas and carries `projection` (`2d-ortho | 3d-perspective`), a saved camera (position, target, zoom/fov) and a layout mode (`placed`, or `derived: force3d/tree` from the existing graph renderers). This gives "one scene graph, two projections" directly. The existing sigma 2D and 3D force renderers are the *derived-layout* projections of the same nodes, and a canvas is the *placed-layout* projection.
- **3D semantics without a 3D-only model:**
  - In 2D, `z` flattens to draw order: `order` first, then `z`.
  - In 3D, `z` is a real axis, and a view can *map* z to a meaning (layer, time, hierarchy depth, cluster) as a view-level choice; tldraw-3d's "history on the z axis" is the precedent.
  - Meshes are `#asset` nodes pointing at `.glb` files under `.kb/assets/`.
- **JSON Canvas** becomes an import/export extension. Import any Obsidian `.canvas`; export a canvas's 2D projection, which drops 3D and scripts, and keep `kb-node` cards as `file`/`text` nodes with `x-kb-id` extra keys. The `docs/kb`-style materialization pattern fits: the export is generated and never hand-edited.

**Costs to accept, or to name as a GAP:**
- `nodes.jsonl` grows by one node per placement. A brainstorm with 300 stickies is 300+ nodes.
- Canvas moves become many per-node transactions, not one prop write. That is fine for LWW per (node, field), but a drag of 50 items needs batched transactions.
- The migration from the prop to nodes is a real restructure commit. It must come *before* any 3D or script feature, per "restructure, then add, as separate commits".
- If that radius is too big right now, the honest alternative is to stop and record a `#gap`. Shipping "JSON Canvas + `kb3d` extension bag" as a stopgap is exactly what the rule forbids.

### 4.2 Scripts: nodes with capabilities, not code inside a blob

- **A script is a node.** `#script`, with its source in the node body or a `source` field (or an asset for large bundles), plus these fields:
  - `entry` (`main | config`): mirrors tldraw's before-mount and after-mount split. `config` registers types (a new shape kind, tool, overlay or binding); `main` wires behavior.
  - `targets`: ref(s) to a canvas, a tag ("every canvas tagged `#retro`"), or a view. This is Patchwork's `supportedDatatypes` and GT's view-by-type, expressed as a relationship.
  - `capabilities`: declared, e.g. `graph.read`, `graph.write:subtree`, `canvas.render`, `ui.panel`, `net:none`.
  - `digest`: computed, never hand-set.
  - `author`: human or agent node.

  Attaching behavior to a canvas is a relationship, so it is queryable ("which scripts touch this canvas?"), shows up in backlinks, and can be drawn on the canvas itself (Breadboard, Inkling).
- **Trust** is `{digest → decision}` per machine. This is machine state, so it belongs to `docs/backup-strategy.md` territory (Mackup / `.kb/` local state) and is **never committed**, exactly like tldraw's `scriptConsent`. Any edit, including an agent's, changes the digest, and the script must be approved again. Agent-authored scripts start untrusted, or trusted-in-sandbox (see the next point).
- **One capability contract, two engines** (the repo's "one contract, every implementation" rule, with a shared contract suite over both):
  - `ctx = { graph: {query(edn), watch(edn, fn), node(id), tx(ops)}, canvas: {placements, camera, select, hitTest}, render: {ephemeral(fn), overlay(...)}, ui: {panel(html)}, events: {on(name, fn)}, signal }`. Everything registered is tied to `signal`, as in tldraw, anywidget and folkjs.
  - **Engine A (trusted):** a module Worker or the main thread, with SES `lockdown()` as defence in depth.
  - **Engine B (untrusted):** QuickJS-wasm in a dedicated Worker, with capability objects injected as host functions, memory and deadline limits, and `worker.terminate()` as the kill switch. It runs the same way on the Bun server, which matters because Bun has no permission model.
  - **UI surfaces** from either engine render in a **sandboxed iframe** over MessageChannel. That is the same mechanism kb's MCP server already uses for `ui://kb/view/*` (MCP Apps), so it is one channel, not two.
- **Hooks:** prefer `graph.watch(datalog, fn)` (host-diffed, self-write-suppressed) over raw change feeds. This follows the Folk claim/when model and tldraw's warning against broad `store.listen`. Add `events.on('pointer' | 'select' | 'hover' | 'tick')` for interaction, and ephemeral rendering for per-frame or per-hover output that never enters the graph, undo or sync.
- **Writes** go through `graph.tx` → the same kb transaction pipeline as the UI and CLI: validated, write-guarded for `sys.*`, undoable, broadcast on `/ws`. Idempotent creation uses stable ids.
- **Writer rule:** the kb server is already authoritative, which is simpler than tldraw's "every client runs, guard with isHost". Behavior scripts that *write* run once, on the server (Bun + QuickJS) or in a designated client. Render-only scripts run in every client.
- **Custom node kinds from `config` scripts** register *shape renderers for a tag*. They are not new storage shapes: a script can teach the canvas how to draw `#kanban-column`, but the data remains ordinary nodes and fields. This keeps "infinite scriptability" inside Rule 1.

### 4.3 Renderer stack

Options weighed:

| Option | For | Against |
|---|---|---|
| **A. One three.js WebGPU scene, ortho camera for 2D** | A single renderer; seamless 2D↔3D; scales to 10k+ items with instancing and culling | Rich markdown cards with inline refs, IME editing, a11y and selection must be re-implemented on the GPU (three-text or MSDF), which is a huge amount of work; troika text is WebGL-only |
| **B. DOM 2D + separate three 3D, joined by one contract** | Keeps kb's existing DOM canvas and markdown rendering; each projection uses its native strengths | Two renderers to keep consistent. Mitigated by a shared contract suite (like `GRAPH_RENDERERS`) and a shared camera model |
| C. tldraw with 3D shapes | — | License; a 3D view inside a 2D editor rather than two projections of one graph |

**Recommendation: B now, converging toward A where it pays.**
1. **2D projection:** today's DOM/SVG canvas (Excalidraw-style interactions). An orthographic camera *is* a CSS `translate/scale`. Put an R-tree and culling behind it (tldraw 4.4's lesson), and cap DOM to the visible set.
2. **3D projection:** the existing **scene kit** (`src/scene/`: WebGPU + TSL stage, post chain, palette uniforms, frame loop) that `force3d-scene.ts` already uses. Placements become instanced card meshes. Cards show as textures: first rasterized snapshots at LOD levels, then **`HTMLTexture` / `InteractionManager`** (three r184+, WebGPU-supported, built on Chrome's HTML-in-Canvas origin trial 148–150) so the *real DOM card* sits in 3D with correct depth and stays interactive where supported. For text on the GPU, use `three-text` (vector mode) or `three-msdf-text-utils`, not troika.
3. **The transition** is one camera model: a dolly-zoom from perspective to orthographic at the focus plane, then a cross-fade to the DOM layer at the ortho limit (the tldraw-3d underlay pattern). Both projections read the same placement nodes and the same `#view` camera fields.
4. **Contract:** a `CANVAS_PROJECTIONS` registry with one shared suite covering hit-testing, selection, emphasis, camera fit/focus, and "a placement moved in one projection appears moved in the other". This mirrors the existing "one renderer contract" section in `DESIGN-UI.md`.
5. **Upgrade three r180 → r186.** It is needed for `HTMLTexture`. Don't adopt R3F or drei yet: kb's scene kit is vanilla three, R3F v10 and drei v11 are alpha, and drei v11 moves `Text` to legacy.
6. Review the switch to option A (GPU cards in 2D as well) only if the DOM projection passes about 2k visible items, or once HTML-in-Canvas ships in more than Chrome.

### 4.4 Agent collaboration

- **Same actions, same transactions.** Agents edit through kb's existing MCP tools (`node_add`, `graph_query`, `render_view`, `kb_manifest`) plus canvas actions registered as kb actions: place, move, connect, group, set-view, run-layout, mermaid-to-canvas. The UI, CLI, scripts and agents all call **one action registry**, which is exactly the tldraw agent kit's action-schema pattern with Zod-like schemas and `sanitize`/`apply`. There are no agent-only write paths.
- **Three tiers**, the same ones tldraw offline proved:
  1. declarative actions
  2. `exec`: a one-shot snippet against `ctx` in the untrusted engine, serialized per canvas, rolled back on failure, returning `snippetId`
  3. durable `#script` nodes, with a `script.status` action returning `applied | pending | error` and `script.stop(id)`
- **Perception:**
  - `canvas.describe(view)` returns records at three levels of detail: focused, blurry, and peripheral clusters, following tldraw's agent kit.
  - `canvas.screenshot(view, projection)` gives visual confirmation.
  - Datalog stays the precise query path.
- **Lints as a kb action**, returning `{new, resolved}` after every agent transaction. Candidate rules: an arrow that doesn't resolve to a relationship, overlapping cards, a card whose ref target was deleted, a placement off every view, a script without a digest. Each lint id is itself a node, which follows "rules are nodes" and suggests a `#lint` tag with `enforcement`.
- **Comments and threads are nodes** anchored by ref to a placement, a node or a region node, with `resolved` as a field. Agents reply, resolve, and skip threads addressed to others, as in tldraw.
- **Presence and cursors:**
  - Ephemeral messages on the existing `/ws` (`presence.update {actor, viewId, cursor, selection, camera}`), never persisted.
  - Agents are actors with a colour and name, like tldraw's `user:` records.
  - Attribution (`actor` on each transaction) shows who or what changed each node. tldraw 5.0 added the same "attribution" foundation.
- **Proposals (optional, USD-inspired):** an agent can write into a *proposal layer*, a `#proposal` node grouping pending transactions, that the human accepts or rejects. That is layered overrides without a USD runtime, and it fits git branches too.
- **Harness integration:** copy tldraw's installer idea. `kb` already has an MCP server in `.mcp.json`. Add a served `/readme` + recipes equivalent through `kb_manifest`, so the running app documents its own live API.

### 4.5 Collaboration and sync
- **Now:** a single machine, humans and agents together, with the server-authoritative tx log, `/ws` live updates, and JSONL in git (LWW per node-field, id-keyed, stable diffs). That is sufficient.
- **Later, multi-device offline:** evaluate Loro as the transport for canvas transactions (a movable tree for `parent`, fractional order, JSON op-log). The source of truth still materializes to JSONL.

### 4.6 License traps (flag list)

| Item | Trap |
|---|---|
| tldraw SDK / `@tldraw/sync` / `@tldraw/commenting` 5.x | Source-available; **production needs a license key**; hobby tier requires the watermark. Starter kits are MIT but depend on the licensed SDK |
| tldraw offline | Closed, "All rights reserved"; don't reuse its code or its `.tldraw` container, only the ideas |
| `@tldraw/tlschema` | Listed as MIT on npm, but useless without the SDK; don't build on it |
| Needle Engine, `@needle-tools/usd` | Proprietary EULA / **PolyForm-Noncommercial**; forked three |
| Spline runtime | Proprietary; bundles its own three, so it can't share our instance |
| Theatre.js studio | **AGPL-3.0**; public development dormant since 2024 |
| Obsidian Excalidraw plugin | **AGPL-3.0** since 2026-05; don't copy its Automate code (Excalidraw itself is MIT) |
| Kinopio | PolyForm-NC |
| AFFiNE OctoBase, Logseq | AGPL-3.0 (BlockSuite is MPL-2.0: file-level copyleft) |
| Slug-style GPU text | Check patent status before use (UNVERIFIED) |
| OCIF | No license file in its repo |
| Safe | three.js, glTF-Transform, three-text, camera-controls, Excalidraw, Loro, Yjs, Automerge, quickjs-emscripten, X_ITE, PlayCanvas engine and editor (MIT); Babylon.js, SES (Apache-2.0); three-msdf-text-utils (ISC); OpenUSD (TOST ≈ Apache-2.0); glTF (royalty-free); JSON Canvas (MIT) |

---

## 5. Suggested sequencing, each step a separate commit per Rule 1

1. **Restructure:** migrate canvas storage to placement, shape and connection nodes, and make JSON Canvas an import/export extension. Behavior is preserved and proven by the existing canvas tests. If this is too big for now, record a `#gap` rather than extending the prop.
2. **Add** `z` and 3D transform fields, plus the `#view` projection field. Build the 3D projection on the scene kit; upgrade three to r186.
3. **Add** the canvas action registry, lints-as-diff, and `canvas.describe`, exposed through MCP.
4. **Add** `#script` nodes, the trust store (backup-owned), the capability contract, the trusted engine, and the contract suite.
5. **Add** the QuickJS engine (browser Worker + Bun), the sandboxed-iframe UI shared with MCP Apps, and exec with rollback and abort.
6. **Add** presence and attribution, comment nodes, and proposals.

## 6. Open questions and unverified items
- Exact date of the KHR_interactivity ratification vote. Whether glTF 2.1 lands in Q4 2026.
- Whether Yjs 14 adds move. What Subduction is (the new automerge-repo sync protocol).
- tldraw offline's "offline server" mode: no public docs found. v1.20.0 release notes could not be retrieved.
- Whether Observable Canvases allow arbitrary JavaScript nodes. Natto's evaluation model. The Nodes.io license.
- Whether the HTML-in-Canvas origin trial becomes a standard, and whether Safari or Firefox commit to it. This decides how soon option A becomes cheap.
- Product decision for the owner: should a freeform sticky be a full node from creation (recommended; it is the Rule 1 reading) or be promoted on demand? This decides the JSONL growth rate.
