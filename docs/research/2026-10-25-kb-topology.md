# kb topology, and linking kb canvases to bb threads

Date: 2026-10-25. Two linked questions from the owner:

- **A.** "Do you think this makes it too much, this whole setup? Should we have kb local to the machine, or make
  the kb plugin machine aware as well?"
- **B.** "I want to do it like canvas link, so if any thread created any canvas, we can know the link. How
  should we design this? Mostly in the bb kb plugin?"

A comes first because it decides where B's links live.

Sources:

- [2026-10-24-interaction-app-topology.md](2026-10-24-interaction-app-topology.md), the workbench topology
  report, below called "the topology report".
- [2026-10-24-bb-vs-pi-omp-harness.md](2026-10-24-bb-vs-pi-omp-harness.md).
- `hosts/shared-server/default.nix`, `docs/kb-service.md`, `docs/backup-strategy.md`.
- `assets/bb-plugins/kb`, `assets/bb-plugins/canvas-links`, `modules/stacks/ai-agents/canvas-links`.
- kb at `73158f3f` (DESIGN.md → Locations; The transaction tail; Action registry).
- Read-only checks on shared-server: the home store's `.kb/tx.jsonl`, and the bb 0.46.1 server bundle.

## Summary

**Topology, in five lines:**

1. Keep one central kb home store on shared-server (the status quo). It runs beside the bb server that frames
   it, so it adds no point of failure that bb does not already have.
2. Don't run a kb per machine, and don't sync replicas. Both split or duplicate one person's graph to fix an
   outage that bb has anyway.
3. The question "which kb does a thread's work belong to" is about the store, not the machine. kb's Locations
   already model stores: the home store is the person's, and a repo `.kb` follows that repo's Git lifecycle.
   So make the plugin store-aware later, if a trigger fires. Never make it machine-aware.
4. What is actually "too much" is the ambiguity, not the server. Today a Mac agent's `kb` CLI writes to that
   Mac's own store, while the kb tab shows shared-server's. The fix is a rule plus links, not more servers:
   personal kb work goes through `kb_call`.
5. The real risk is backup. shared-server's home store, and bb's data, are copied nowhere. Close that first
   (gap `01M5QJFWFYAKE90KSRNPN4EX78`).

**Linking, in short:**

- The link is bb knowledge (thread, project, machine), so it lives in the bb kb plugin.
- kb gains two generic primitives and nothing bb-specific:
  - a caller's `via` label recorded on every write;
  - `graph.changes`, which reads the transaction log back.
- The plugin labels each thread's writes `bb:<thread>`:
  - `kb_call` states the label on the envelope;
  - the plugin contributes `KB_VIA` to every provider, so the thread's own kb CLI and kb MCP carry it too.
- The plugin then reads kb's log and records the links.
- A **kb canvases** panel mirrors the Canvases panel: the same Thread | Project | All tabs, row, search,
  "link" button, and click-to-open.

Version 1 is an experiment, to try one way of using kb from bb. It is small, and meant to be changed or thrown
away. The signals to watch are listed under "What to watch" in part B.

## A. Topology

### What is there today

| Piece | Where | Notes |
|---|---|---|
| bb server | shared-server (`app-bb`) | Every bb plugin's server half runs here, including the kb plugin's tools and its links. |
| bb daemons | shared-server, and each Mac | Threads run on all of them. Their agents' shells run on that machine. |
| kb home store, served | shared-server: `my.services.kb`, `~/.local/share/kb/home`, owner-only socket, Tailscale Serve `svc:kb-popemkt` | The bb kb tab frames it. `kb_call` reaches it over the local socket. |
| kb on popemkt-personal | launchd `kb-ui` on `_brain`, port 9000, `svc:kb` | A separate graph, which the owner chose. |
| kb on popemkt-work | CLI only | Its home store holds only its location list. |
| repo stores | `.kb/nodes.jsonl` in this repo, and in kb | Committed. They change through commits, and are never served live (`docs/kb-service.md`). |

The important fact: the kb plugin's server code runs where the bb server runs. A `kb_call` from a thread on a
Mac therefore reaches the shared-server kb over a Unix socket on the same machine. The framed page loads over
Tailscale Serve, exactly as bb itself does.

### The four options

| | 1. One central kb (status quo) | 2. A kb per machine | 3. Central plus a machine-aware plugin | 4. Local-first replicas that sync |
|---|---|---|---|---|
| Complexity | One service and one plugin. Exists. | Three served kbs, three Serve names, three embed origins. The plugin must choose a page per thread, so it ends up machine-aware anyway. | Option 1, plus a kb served on every Mac, plus routing in the plugin and the tab. | A multi-writer merge protocol in kb. Its log supports catch-up (`since`), but nodes are replaced whole, so concurrent canvas edits would lose work. Weeks of kb work. |
| Single point of failure | Shares bb's: when shared-server resets, bb's UI and plugin go down too. It adds nothing for work inside bb. Outside bb (the kb page on the phone) it is down while shared-server is. | Per machine, but bb itself is still central, so in-bb use gains nothing. | Same as option 1 for the tab. Better only for Mac CLI use. | Best for reading. Writes still need a merge story. |
| Latency | `kb_call` uses a local socket on the bb server. The page goes through Serve, as bb does. | Same or worse: the tab would frame a Mac's page over the tailnet. | Same as option 2. | Best, all local. |
| Agents on Macs | `kb_call` works from every machine. Their kb CLI and MCP write to the Mac's own store (the ambiguity). | Native. The personal graph splits by which machine the thread ran on. | Routes the tab and tools to the Mac's kb, which is again a split graph. | Native, after a merge. |
| Which store a thread's work belongs to | Clean: the home store is the person's, and a repo `.kb` goes through Git (kb Locations). | Muddled: is a Mac's kb personal, the machine's, or the repo's? | Answers the wrong question: it keys on the machine, but the store is what decides. | Same as option 1, once merged. |
| Backup | One store to back up, which today is not backed up. | Three. | Two or more. | Every replica, plus conflict history. |

### Recommendation

Keep **option 1**. The parts of the setup that look like a lot are each needed for one feature:

- the socket, the Serve name and `--embed-origin` let bb frame kb;
- `--embed-script` makes bbim keys work inside the frame;
- the session heartbeat lets an agent act in the tab you see.

None of them comes from having one store.

Three things are worth trimming or adding:

1. **One rule:** personal kb work from a bb thread goes through `kb_call`, on any machine. The kb CLI and kb
   MCP are for the repo `.kb` of the thread's workspace, and that work gets committed. The skill already
   steers agents this way. The skill now also says that a write elsewhere is not linked.
2. **Backup:** back up shared-server's home store and bb's data directory (gap `01M5QJFWFYAKE90KSRNPN4EX78`;
   stage 1 of the topology report).
3. **No machine-awareness.** If the plugin ever has to reach a store other than the home store, it should
   pick by store (a root, through Locations), not by machine. That is the path that closes gap
   `01M5QJFVQ61E19BAB2KXC0FA4M`.

### Minimal migration path

| Step | Change | Effort |
|---|---|---|
| 0 | Nothing moves: no store migration and no new service. | none |
| 1 | Back up the home store and the bb data dir from shared-server (a restic or rsync timer, or Litestream for `bb.db`). | hours |
| 2 | Add `via` and `graph.changes` to kb, and linked items to the plugin (part B, this change). | done |
| 3 (only on a trigger) | Store-aware links: a host entry runs `kb` `graph.changes` against each store the thread's machine holds. Links are keyed by root and id, and open goes through `location.open`. | 1–2 days |
| 4 (only on a trigger) | A read-only kb replica on a Mac, fed by `graph.changes` or `/ws since`, for when shared-server is down. | days |

Triggers for steps 3 and 4:

- A Mac agent loses kb work, or cannot reach kb, more than occasionally while shared-server is down.
- A canvas that matters keeps being made in a Mac store or a repo store and is missed by the panel.
- The owner wants the kb tab to show a repo's `.kb`.

## B. Linking kb canvases to threads

### Rule 1 first

**Should the link live in kb itself, for example as a field on the canvas node?** No.

- Threads, bb projects and machines are bb's concepts. kb is a standalone product and must not grow them, or
  come to depend on bb. This is the boundary the owner set, and it is recorded here.
- A field that the plugin writes into the person's data would cost a second write for every agent edit. The
  plugin would then have to tell its own writes apart from the agent's.
- That field would also show up in kb's UI as a bb artifact, and it would grow without bound.

**What kb does get** is two primitives that are useful without bb:

- **`via`:** the caller's own label for the work a call belongs to. It is stated on the envelope, or taken
  from `KB_VIA` by the CLI and by `kb mcp`. kb records it on the transaction the call commits, next to
  `actor` and `session`, and never reads it. Any harness, job or script can later ask "what did my run
  change". It follows the pattern `session` already established, down to the SQLite column migration.
  **`via` is advisory:** a caller states it about itself and kb checks nothing, so any caller can claim any
  label. That is why the panel shows a link a write made as *claimed by* its thread, and a link made by hand
  as plain.
- **`graph.changes {since, viaPrefix?, limit?}`:** the transactions committed after a revision, read from the
  store's own tail one page at a time (by count and by bytes). For each one it returns who made it, and the
  ids, text and tags of the nodes it wrote or deleted. `viaPrefix` matches on a separator (`bb:` matches
  `bb:thr_1`, not `bbx:`). `through` is the last revision read, matched or not, and the next page starts after
  it. `complete: false` means the log no longer reaches back that far. Any program that follows kb can use it.

This keeps one record of which write happened: kb's own log. The plugin's database is an index derived from
that log. It is kept on disk only because kb compacts its log after 2048 entries.

**Should both panels share one contract or one component?** Two panels, one row.

- The owner wants to use both panels every day and compare them, so each plugin keeps its own panel.
- What a row is and how it is drawn is stated once, in `assets/bb-plugins/linked-items/`: `rows.ts` (the
  `LinkRow` model, scopes, search, threads, "edited 3h ago", claimed links) and `row.tsx` (the scope tabs and
  the row with its thread chips, React only). Each plugin maps its own item to a `LinkRow` (`rowOf` in
  `canvas-links/lib/canvases.ts` and in `kb/lib/links.ts`) and imports both by relative path.
- `bb plugin build` bundles that folder into each plugin, and `bb-plugins-sync` counts every sibling folder
  with no `package.json` as shared code in its change stamp, so editing it reinstalls both plugins.
- The panel shell is still copied (gap `01M5QJFW217ZNBXHEX74VG7VYP`): the header, search box, link button,
  and empty and error states. They are drawn with each plugin's own `Button`, `Input` and `Icon`, which import
  `@/…` and `@get-bb/plugin-sdk/app`. Those resolve only inside a plugin's root, not from the shared folder.

### The boundary

| kb (generic, no bb) | bb kb plugin (bb-specific) |
|---|---|
| `via` on the envelope, and `KB_VIA` for the CLI and MCP | The label format `bb:<thread>`, and setting `KB_VIA` per thread through `bb.providers.experimental_contributeEnv` |
| `via` recorded on the log (both log backends) | Reading the log on a loop, with a cursor per store |
| `graph.changes` | Which changes count as links: kinds, starting with canvas = tag `sys.tag.canvas` |
| Tags, `ui.screen`, `ui.navigate` | The link table, thread → project and machine resolved through the bb SDK, the scopes, and the panel |

### Design

```
agent in thread T ──kb_call {via: bb:T}──────────────▶ kb (shared-server home store)
agent's kb CLI / kb MCP (env KB_VIA=bb:T) ──────────────▶ same store, if it is the one written
                                                         │ tx log records via
bb kb plugin: loop every 10 s, and on each list ◀── graph.changes {since: cursor, viaPrefix: "bb:"}
  → canvases written by a bb:* change: links(store, canvas, thread, project, host, how, first, last)
    and items(name, edited_at, gone), for linked canvases only; newest 5000 links kept
  → on each list, one graph.query for the canvases kb has now: renames and deletions by anyone
kb canvases panel ◀── RPC links {thread, scope}  ·  linkOpen  ·  openItem → ui.navigate in the thread's tab
```

- **Kinds seam.** `KINDS` in `lib/links.ts` maps a kind to its tag and its route. Adding a kind means adding
  one entry, plus a row label if it needs one.
- **Seams for more kb integration.** The plugin is meant to become bb's home for kb integration in general,
  and links are its first capability. Each capability is one module (`links.ts`, `linked-panel.tsx`,
  `lib/links.ts`, `lib/link-book.ts`) that `server.ts` and `app.tsx` register in a line each. It reaches kb
  only through the `KbAccess` interface: one action, the root, and a thread's tab session.
- **A log that skipped ahead.** If kb compacted its log past the cursor, the book carries on from kb's head,
  remembers when, and the panel says the links "may be incomplete". A first read is never a gap.
- **"edited"** is the last write a thread made: the loop reads only `bb:` writes, so an edit in kb's own UI
  does not move it (renames and deletions do show, through the list's query).
- **Open.** If the thread's kb tab is live, open calls `ui.navigate /canvas/<id>` in that tab session. If not,
  the route waits until the panel reports a session, then navigates. Either way the panel opens the kb tab.
- **Link open canvas.** This is the twin of "Link focused canvas". It links the canvas that the thread's kb
  tab shows (from `ui.screen`), and marks the link as made by hand.

### UX parity with the Canvases panel

| Canvases (tldraw) | kb canvases |
|---|---|
| Tabs: Thread / Project / All | Same. Project means the same bb project, where canvas-link uses the same git remote. |
| Row: dot, name, "edited 3h ago" | Same row, drawn by the same code. The green dot means "open in this thread's kb tab". |
| Second line: folder, or "on <host>" | "kb · <store>", plus "linked by hand" or "claimed by this thread" |
| Thread chips | Same; a chip with a dashed border is a claimed link |
| "file gone", struck through | "deleted", struck through |
| Thread chips in Project and All | Same |
| Search `/`, Escape clears it | Same |
| Link focused canvas | Link open canvas |
| Click opens in tldraw on the owning machine | Click shows it in the kb tab |
| Agents run `canvas-link add` | Nothing to run: writes link themselves |

### Built

- **kb PR:** `via` on calls and on the log (SQLite schema 6, JSONL, memory), `KB_VIA` for the CLI and MCP,
  `graph.changes` over a paged `TxTail.since` read, DESIGN.md, and tests (a tail contract every adapter runs,
  and a log-contract case for a second writer).
- **Dotfiles PR:**
  - in the kb plugin: `lib/links.ts`, `lib/link-book.ts`, `links.ts`, `linked-panel.tsx`, the label added
    to `kb_call`, the panel slot, and tests (the book runs on `node:sqlite` against a fake kb);
  - the shared `assets/bb-plugins/linked-items/` row, which the Canvases panel now draws with too;
  - the README, overview and skill;
  - three gap nodes;
  - this document and its `#research` node.
- **End-to-end run** of the plugin's real server bundle, under bb's fake plugin host, against a `kb ui` built
  from the kb branch. It covered:
  - CLI writes with `KB_VIA`, and `kb_call` writes;
  - the Thread, Project and All scopes;
  - a note that is not a canvas, which was correctly left out;
  - Link open canvas;
  - an open queued until the tab reported its session.

  The scripts and a screenshot are in `.kb/assets/overnight/2026-10-25/kb-canvas-links/`.

### Remaining

- After the kb PR merges and a nightly is published, move the kb pin in the dotfiles
  (`nix run .#github-sources -- update kb`). Until then the panel says the kb has no `graph.changes`.
- The panel has not yet been seen in a live bb. That needs a deploy.
- Gap `01M5QJFVQ61E19BAB2KXC0FA4M`: only the served kb is read.
- Gap `01M5QJFW217ZNBXHEX74VG7VYP`: the panel shell (not the row) is copied between the two panels.
- Gap `01M5QJFWFYAKE90KSRNPN4EX78`: there is no backup.

### What to watch (v1 is an experiment)

- **Reliability against canvas-link.** Do kb canvases appear with no agent action, where tldraw links depend
  on agents running `canvas-link add`? Count misses, especially Mac kb CLI writes (gap `…FA4M`).
- **Noise.** Are incidental writes linked, such as a thread that only arranged someone else's canvas? If so,
  the "wrote" link may need to tell creating apart from touching.
- **Project scope.** Does the bb project match the owner's notion of a project better or worse than
  canvas-link's git remote?
- **Link open canvas.** Is it ever used? If not, drop it.
- **Claimed links.** Does a dashed chip ever turn out wrong (a label some other caller stated)? If so, the
  plugin needs a label kb can check, not a stated one.
- **"May be incomplete".** How often does it show? Often means the 10 s loop falls behind kb's compaction.
- **Open in tab.** Does the queued open feel instant, or does the tab's reload make it lag?
- **Which panel the owner reaches for.** The two panels, or kb's own Canvases list? That decides whether to
  merge the panels (gap `…VYP`), fold tldraw in as a kind, or let kb's list replace the panel.
- **Other kinds.** If the owner starts wanting links for kinds other than canvases (pages, todos), the
  `KINDS` seam is the next step.
