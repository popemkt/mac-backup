# `kb ui` — browser outliner + subscription backend (design doc)

Tana-style outliner UI for kb, served locally by `kb ui`, opened in the
browser. Client-side DataScript for instant interaction; a **subscription
layer that lives in the backend** so other apps (not just this UI) can
subscribe to live queries later. MCP Apps generative UI is phase 2.

## Decisions (from Q&A)

| Decision | Choice |
|---|---|
| Shell | Browser app served by `kb ui` (no Electron/Tauri). **Why not Electron for "local ops like materialization":** those ops run in the `kb ui` bun server, which has full fs access — the browser only calls actions. Electron's sole trick is bundling Chromium+Node to get fs in one process; we already have a local server process. Zero gain, +200MB. |
| Frontend build | **Vite+ (`vite-plus@0.2.8`, on npm, Evan You et al — confirmed installable)** + React 19 + Tailwind 4 + Zustand — same stack as nxus, so its outliner forks in cleanly. If vp misbehaves anywhere, its config is Vite config; plain-Vite fallback is a dependency swap. |
| Bun's role | Runtime for the server only (`kb ui` = Bun.serve listen + WS upgrade + `Bun.file` bodies). HTTP routing, asset/static reads, SubscriptionHub message/broadcast/cleanup, and fs-watch reloads are Effect v4 programs (`@effect/platform-bun` FileSystem). **Not** `@effect/platform-bun` `BunHttpServer` as the outer server: on effect@4.0.0-beta.106 its `HttpServerRequest.upgrade` path deadlocks on the request fiber when awaiting the open deferred / forking `socket.runRaw` from that fiber (empirically verified). Protocol-preserving Bun.serve WS + Effect hub is the working single boundary. Bun ≠ bundler here; Vite builds the frontend. No Effect in the browser bundle. |
| Reactivity | Client-side DataScript (Logseq architecture) **plus** backend subscription hub designed for third-party consumers |
| Edit scope v1 | Solid basics (outline CRUD, props/tags panel, [[ref]] autocomplete, query page, backlinks) |
| MCP Apps | **Backbone now, apps later**: shared render layer (query + template → HTML) ships in this wave and kb MCP serves one `ui://` resource through it. Adding an "app" later = adding a template + query, nothing structural. |

## Why bun *and* vite (your question)

The backend must be bun — kb's store/query/registry code is bun TS, and
`kb ui` is just another surface over the same registry. The frontend is a
normal web app; Vite is its dev server + bundler. They compose:
`kb ui --dev` proxies to Vite HMR; production `kb ui` serves `ui/dist/`
static files. Vite+ ("vp") is a superset CLI — if you install it later the
config carries over unchanged.

## Architecture

```
browser ──HTTP GET /api/graph────────► kb ui server (bun)
   │  ◄──full node set (jsonl parse)──   │
   │                                     ├─ registry.invoke (same actions as CLI/MCP)
   │ ──POST /api/action {id,input}─────► ├─ JsonlStore commit
   │  ◄──receipt───────────────────────  ├─ fs.watch .kb/nodes.jsonl
   │                                     └─ SubscriptionHub
   │ ◄──WS: tx events / query rows ─────────┘
DataScript (client) ← re-run open queries on tx
```

Server ownership lives behind the stable facade `src/surface/ui.ts`, which
re-exports the public CLI/server seam (`startUi`, `runUiCli`, …). The
implementation modules under `src/surface/ui/` split by concern:

| Module | Owns |
|---|---|
| `server.ts` | Bun.serve / Effect runtime boundary, fs-watch, CLI entry, Scope shutdown |
| `http.ts` | Effect REST/API routing, failure mapping, kb asset GET, SPA static fallback |
| `session.ts` | Effect `SubscriptionHub` (clients, message processing, broadcast, cleanup) |
| `assets.ts` | Effect SPA `ui/dist` static + `.kb/assets` serving (`Bun.file` body at boundary) |
| `saved-queries.ts` | Effect list/materialize `.kb/queries/*.edn` |
| `paths.ts` | `KB_PKG_ROOT`, `UI_DIST` |

- **Client DataScript**: browser loads all nodes once, builds the same datom
  set the CLI builds (shared `foundation/query` code — it's isomorphic TS, no
  node APIs in the datom builder). Keystrokes never wait on the network.
- **Mutations**: optimistic local tx → `POST /api/action` (registry.invoke,
  same receipts) → on failure, strict `/api/graph` refetch (never demo
  fixtures mid-session) + toast; if refetch fails, restore local pre-plan
  state without rewinding `rev`, dropping unconfirmed minted nodes after
  partial multi-action applies. Cold-boot `loadGraph` may fall back to
  fixtures; `hydrateFromWire` is boot-only — live resync uses
  `refreshFromWire` so `loadSource` stays `api`. No temp-id dance (nxus's
  pain): client mints final ULIDs, server accepts explicit ids (already
  supported by `node.add`).
- **Change flow**: server fs-watches `.kb/` (catches CLI/MCP/agent writes
  too) → diffs old/new node sets → broadcasts node-level deltas on WS →
  client transacts deltas into DataScript → open queries re-run.

## SubscriptionHub — the "other apps can subscribe" layer

Designed as a backend service now, minimal v1, clear growth path:

```
WS protocol (JSON):
→ {op:"subscribe",   id:"s1", query:"[:find ?id ... ]"}   // EDN datalog
→ {op:"unsubscribe", id:"s1"}
← {op:"rows",  id:"s1", rows:[...], rev:N}   // full rows on change (v1)
← {op:"delta", id:"s1", ...}                  // future: diffed rows
← {op:"tx",    datoms:[...], rev:N}           // broadcast to graph subscribers
```

- v1 implementation: hub keeps a server-side DataScript conn (reusing the
  query layer); on fs change it re-runs each subscription's query and pushes
  rows if the result hash changed. Coarse but correct; 50k nodes re-query in
  ~20ms, fine for tens of subscriptions.
- The browser UI is just subscriber #0 (it mostly uses `tx` events + local
  re-run; thin clients use `rows` subscriptions and need no DataScript).
- Growth path kept open, not built: result diffing, per-query dependency
  tracking (nxus has a reference impl), auth token if ever exposed beyond
  localhost. Server binds 127.0.0.1 only.

## Fork from nxus (verdict: fork the tree, ignore the plumbing)

nxus's outliner is genuinely portable — components import only a classname
helper; the tree algebra is a pure store over `Map<id,node>`; all data
coupling sits in two seam files we replace with kb calls.

Taking:
- `outline.store.ts` (419 LOC + tests) — indent/outdent/move/fractional
  order/visible-node flattening. Adapt node shape to kb (`children` array
  instead of fractional order props — simpler, kb owns order).
- `node-block.tsx`, `node-content.tsx`, `bullet.tsx` — recursive row,
  contentEditable + cursor/IME handling, keyboard map (Enter/Tab/merge).
- `field-value.tsx`, `fields-section.tsx` — per-type inline prop editors.
- `docs/outline-editor-prd.md` — feature checklist to track against.

Not taking: SQLite/Drizzle spine, server-fn sync hook (temp-id swap dance),
event-bus/dependency-tracker (DataScript tx listener replaces it), TanStack
Start/Router (we need one page + panels, not an app framework).

Known nxus gaps we must add ourselves: `[[ref]]` autocomplete, backlinks
pane, persistent collapse state (localStorage), query page.

## v1 feature list

- Outline: expand/collapse (persisted), zoom/breadcrumbs, add/edit/delete,
  indent/outdent, keyboard reorder; Enter/Tab/Shift-Tab/Backspace-merge.
- Node: props panel (typed editors, add/remove field values), tag chips,
  `[[` autocomplete inserting refs, backlinks pane.
- Query page: datalog textarea + run, saved queries (`.kb/queries/*.edn`)
  listed and runnable, results as table with node links.
- Search box (text substring) with jump-to-node.
- Live updates: edits from CLI/agents appear without reload (fs-watch → WS).
- No drag-drop, no undo/redo, no table/board views in v1 (explicitly out).

## Layout

```
tools/kb/
  src/surface/ui.ts              # stable facade (re-exports startUi / runUiCli / …)
  src/surface/ui/
    server.ts                    # Bun.serve boundary + Effect Scope stop + fs-watch
    http.ts                      # Effect REST/API + asset GET + SPA fallback
    session.ts                   # Effect SubscriptionHub (WS protocol)
    assets.ts                    # Effect ui/dist static + .kb/assets
    saved-queries.ts             # Effect .kb/queries listing / virtual nodes
    paths.ts                     # KB_PKG_ROOT, UI_DIST
  src/surface/protocol.ts        # WS/HTTP message types (zod) — shared contract
  ui/                            # Vite app (own package.json)
    src/{stores,components,ds}/ ...
    dist/                        # built assets, committed? → no: built on demand
```

`kb ui` with no `ui/dist`: runs `bun install && bunx vite build` once (cached),
then serves. `kb ui --dev`: spawns vite dev + proxies. No new global deps.

## Milestones (max parallel)

Contract first, then two independent tracks, then join:

- **U0 (me, small)**: `src/surface/protocol.ts` — zod types for HTTP/WS
  messages + written API contract in DESIGN-UI.md. Everything else codes
  against this.
- **U1 server (cursor)**: `kb ui` command — Bun.serve static+API, fs-watch,
  SubscriptionHub v1, tests via WS client. Depends on U0 only.
- **U2 frontend shell (cursor)**: Vite app, graph load → client DataScript,
  read-only outline (fork nxus components), search, collapse/zoom. Talks to
  a mock server built from protocol.ts fixtures. Depends on U0 only. ∥ U1.
- **U3 editing (cursor)**: mutations pipeline (optimistic tx → action POST),
  props/tags editors, [[ref]] autocomplete, backlinks. After U2; runs ∥ U4.
- **U4 query page + live wiring (claude)**: datalog/saved-query page, WS
  client, tx-delta ingestion, persistence polish. After U1+U2; ∥ U3.
- **U5 (me)**: integrate on main, e2e smoke (playwright against `kb ui`),
  docs (AGENTS.md note), commit.

Cursor:claude stays ≈3:1. Same orchestration recipe as last wave
(explicit `cursor-agent --trust -f` terminals, inject, verify, review each
diff with cavecrew-reviewer, I fix and merge).

## MCP Apps backbone (this wave), apps later

New module `src/render/`: `render(queryRows, template, format: "html" | "md")`
— pure functions, no deps. Consumed by three surfaces from day 1:
1. md materializer (existing templates migrate onto it),
2. web UI's rendered-view panel (saved query → html block),
3. kb MCP registers `ui://kb/view/<name>` resources + a `render_view` tool
   returning the html (MCP Apps extension shape).
Later "apps" = new template + query pair, registered by name. On-the-fly
generative UI (model writes the template at answer time) also lands on this
API — the client just passes a template string instead of a name.

## Packaging ("app like other apps") and dist

Decision: **don't commit `ui/dist`** — built artifacts in git churn every
diff. Instead, two install shapes:
- Now: checkout-based (global `kb` wrapper already installed by HM); first
  `kb ui` run builds `ui/dist` into a gitignored dir, cached until sources
  change. Fresh machine cost: one `vp build` (~seconds), automatic.
- Clean "like other apps" shape, when the tool stabilizes: a **nix package
  in `pkgs/`** (buildable derivation: bun deps pinned via lockfile hash, vp
  build in the sandbox, wrapper binary), installed from `home.packages` like
  chat2db/logseq-nightly. Then `rebuild` ships kb+UI as a versioned unit and
  no checkout is needed. Homebrew cask adds nothing over that for a personal
  tool. Backlogged as a kb todo, not in this wave.

## Port

Fixed default `4321`, `--port` override, auto-open browser on start, bind
127.0.0.1 only. **Portless later** (noted as backlog): unix-domain-socket
transport for local subscriber apps + `kb ui` finding a free port and
registering it in `.kb/runtime.json` for discovery; browser still needs a
TCP port, everything else can go UDS.
