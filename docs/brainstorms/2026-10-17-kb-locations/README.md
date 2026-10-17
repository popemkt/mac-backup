# kb locations: a picker over the stores a person has opened

Plan of 2026-10-17. Nothing here is built. It builds on
[DESIGN.md → Extension families](../../../tools/kb/DESIGN.md#extension-families)
and restates none of it. Index and ordering:
[2026-10-17-kb-overnight-plans.md](../2026-10-17-kb-overnight-plans.md).

## What the owner asked

> "an extension to help me pick between saved kb locations? much like logseq itself."

## Prior art

- **Logseq.** A DB graph lives in its own folder, `~/logseq/graphs/<name>/`
  (forum report, https://discuss.logseq.com/t/sqlite-location-customisation/33175).
  The 0.10 app lists graphs under "All graphs…" and adds an opened folder to
  that menu, and shift-click opens a graph in a new window
  (https://discuss.logseq.com/t/shortcut-for-new-window-gone/25541). Where the
  registered-graph list itself is kept is not documented; I could not confirm a
  file name.
- **Obsidian.** The vault list sits in the app's own data directory, outside
  every vault: `~/Library/Application Support/obsidian` on macOS
  (https://obsidian.md/help/Files+and+folders/How+Obsidian+stores+data).
  `obsidian.json` keys each vault by a random id and holds `path`, `ts` (taken
  to be last opened) and `open` (community source,
  https://forum.obsidian.md/t/option-open-last-used-vault-or-open-vault-selector/7093/15).
  "Remove from list" leaves the files alone (https://obsidian.md/help/manage-vaults).
  `obsidian://open?vault=…` and `obsidian://choose-vault` address the list
  (https://obsidian.md/help/Extending+Obsidian/Obsidian+URI). A listed vault
  whose folder has gone reportedly drops off the list without a word (forum
  summary, https://forum.obsidian.md/t/suddenly-can-not-open-vaults/44363,
  unverified).

What kb takes: the list lives outside every store; an entry is a path plus
recency; one store per window; forgetting an entry never touches its files.
What kb does differently: the list is a kb store, not a JSON file of its own;
an entry that cannot be opened stays listed and says why.

## The concept in kb's terms

A **location** is a kb root, a directory holding `.kb/`, that a person has
opened. The known locations are nodes in the person's **home store**, which is
itself an ordinary kb root. The picker is a view of those nodes. **Opening** a
location means going to the `kb ui` that serves that root, and starting one if
none does.

The framing I was handed, tested:

- **Locations as `#kb-location` nodes in a home store: kept.**
- **A `backend` field: dropped.** DESIGN.md → "Choosing an adapter — presence,
  not configuration" makes the adapter whichever store file is present. A
  stored backend would be a mirror, and it would go stale after
  `kb store migrate`. The backend is read from the directory each time.
- **A `last opened` field: dropped (owner question 2).** Recency is sibling
  order: opening a location ranks it first among its siblings
  ([Sibling ranks](../../../tools/kb/DESIGN.md#sibling-ranks)). Pinning is the
  existing `#pinned` tag. No new field and no timestamp type question.
- **Label = node text; path = one field.**
- **Status is derived, never stored.** Served, closed, missing or not a store
  is read from the path and from `.kb/ui.json`. The presence reader already
  checks which root a live server serves before trusting the file
  (`workspace-fs/src/ui-presence.ts`).

### Why switching starts another process

`startUi` (`app/server/src/server.ts`) binds one root for its whole life:
`openKbEffect(opts.root)`, the `SubscriptionHub`, the plugin kernel and the
plugins it hosts, the saved-query watcher, and the presence file
`<root>/.kb/ui.json`. Rebinding a running server would mean tearing all of that
down, which is a restart under another name. So kb keeps one root per process,
as Obsidian keeps one vault per window. Switching is navigation to the process
that serves the other root.

That needs one core change: `kb ui` must be able to listen on any free port,
because 4321 (`UI_DEFAULT_PORT`) is taken by the first server. Presence already
records the URL a server bound, so a spawned server's address is read back from
it.

## Where it lives

An optional family, `locations`, on by default.

| Package | Scope | Holds |
|---|---|---|
| `@kb/locations` | shared | `defineExtension({name: "locations", label: "Locations", optional: {byDefault: "on"}})`, the frozen ids (`LOCATION_IDS`), `locationWrites` (mint on first write), the `LocationRow` schema, and the action definitions |
| `@kb/locations-fs` | backend | home resolution, the action handlers, status derivation, and spawning `kb ui` |
| `@kb/locations-ui` | browser | a sidebar section (`SidebarSectionPoint`), a ⌘K command (`CommandPoint`), and the "cannot be opened" state |

The family joins `BUNDLED_FAMILIES` (`app/bundled`) and
`BUNDLED_EXTENSIONS` (`app/runtime/src/bundled.ts`). The CLI's new commands
invoke actions by id, so `cli.ts` imports no extension package outside
`EXTENSION_ROOTS`.

The tag and field are **not** in the seed fold. The fold seeds every store, so
a `#kb-location` tag would appear in this repository's store and invite
tagging nodes that `location.list` never reads. They are minted in the home
store by the first register, the way `extension.switch` mints
`sys.f.extension.enabled` (`switchWrites`, `seededField`).

## Data model

The home store holds:

- **Tag** `sys.tag.kb-location` ("kb-location"), templating the path field.
- **Field** `sys.f.location.path`: text, cardinality one. The absolute,
  canonical path (`canonicalRoot`, symlinks resolved) of the directory that
  holds `.kb/`.
- **List node** `sys.locations` ("Locations"). Its children are the location
  nodes, most recently opened first.
- **Each location** is an ordinary node: a ULID, its text the label, tagged,
  with one path prop. The default label is the directory's basename, or
  `parent/basename` when two basenames collide (`.dotfiles` and
  `.dotfiles/tools/kb` read as `.dotfiles` and `.dotfiles/kb`).
  `#pinned` pins one.

Derived at read, never stored:

```ts
interface LocationRow {
  id: string; label: string; path: string; current: boolean;
  status: "served" | "closed" | "missing" | "not-a-store" | "broken";
  url?: string;               // when served
  backend?: "jsonl" | "sqlite";
  reason?: string;            // why it is missing, not a store, or broken
}
```

Registering is idempotent by canonical path. Two nodes with one path (made by
hand) are both listed, the second with a warning.

**Where the home store lives.** `$KB_HOME` when set. Otherwise
`~/Library/Application Support/kb/home` on macOS, and
`${XDG_DATA_HOME:-~/.local/share}/kb/home` on Linux (the NixOS hosts).
Under [backup-strategy.md](../../backup-strategy.md) this is state produced by
use, so it goes to regular backup (Time Machine). It is not committed. It is
not Mackup's either: paths are per machine, and Mackup syncs between
popemkt-work and popemkt-personal, so each Mac would list the other's paths as
missing. Losing the home costs the list only, and the next `kb ui` registers
its root again. A step adds a "kb Home Store" section to backup-strategy.md.

The home store is a full kb root, seeded with the bundled fold like any store.
So a person can open home itself and get tables, boards and queries over their
locations for free. It could also hold notes. That is a side effect, not a
goal.

## Mechanisms reused and new

Reused:
- the store and its open (`openKbEffect` over the home root);
- mint-on-first-write (`seededField`, as `switchWrites` does);
- sibling ranks for recency, and `#pinned`;
- the presence reader and `canonicalRoot`;
- `childProcessEnv` for the spawn;
- the action registry, so MCP, the agent, WebMCP and `kb action-invoke` list
  the actions with no surface code;
- approval policy nodes;
- `SidebarSectionPoint` and `CommandPoint`;
- the "cannot be shown here" posture.

New:
1. **Home resolution** (`resolveHomeEffect`), in `@kb/locations-fs`.
2. **Four actions.** Namespaced `ext.locations.*`, with bare aliases:
   - `location.list` (read): the rows.
   - `location.register {path, label?}` (write): idempotent, and ranks the
     location first.
   - `location.forget {id}` (write): deletes the node from home and never
     touches the directory.
   - `location.open {id | path}` (write). A missing location or one that is
     not a store fails `not_found` and gives the reason. A served one answers
     `{url}`. A closed one spawns `kb ui --root <path> --port 0 --no-open`
     detached, waits up to about 10 s for its presence, and answers `{url}`;
     otherwise it fails `internal` with the tail of stderr. Only success
     re-ranks.
3. **`kb ui --port 0`**, meaning any free port.
4. **A detached spawn of `kb ui`.**
5. **An action that reaches outside its root** (owner question 4).
   DESIGN.md → Surfaces says every MCP tool is `openWorldHint: false`
   "because an action touches only its kb root". These four touch the home
   root and can start a process, so that statement would become silently
   false.

**Registering automatically.** `runUiCli` registers its root once it listens,
beside the presence write, and `kb init` registers the root it creates. A
failure is reported, and the server serves anyway, the posture presence
already has. Other CLI commands never touch home, because hooks and pre-commit
run `kb` constantly.

**The agent asks before opening.** That is a policy node in this repository's
store, "An agent asks before opening a location", the same as the existing
`approval.agent-extension-switch`. There is no declared `approval: "required"`:
that would make the CLI's own `kb open` (actor `cli`, not `human`) fail
`approval_required`.

## Surfaces

- **CLI.**
  - `kb locations [--json]` prints label, path, status and URL.
  - `kb locations add [path] [--label <text>]`.
  - `kb locations forget <id|label|path>`.
  - `kb open <label|path|id>` opens that location in the browser.
  - `kb open` with no argument opens the home store in `kb ui`, which is
    the picker as a page.
- **MCP and the agent.** The actions are tools with no extra code. The agent
  can list locations, and open one after asking. It cannot read another
  store's content.
- **UI.**
  - A "Locations" sidebar section lists the rows. The current one is marked,
    and each of the others has a status dot.
  - Clicking a row runs `location.open`, then `location.assign(url)` in the
    same tab. ⌘-click opens a new tab.
  - ⌘K "Open location…" lists the same rows.
  - A missing row shows its reason and offers Forget. Re-pointing it is a
    field edit in the home store.

## A location that cannot be opened

A broken definition never makes a surface unopenable (INSPIRATIONS, standing
rules).

| Case | What happens |
|---|---|
| Path absent, or no `.kb/` | The row shows `missing` or `not-a-store` with a reason. `location.open` fails `not_found`. The list still answers. |
| Location node with no path or two paths | The row is `broken` and carries a warning. |
| Presence file left by a dead server, or one serving another root | The presence reader rejects it, and the row is `closed`. |
| Spawn fails or times out | The receipt fails with the stderr tail. Nothing is written. |
| No home store yet | The list is empty, with a warning naming where home will be created. |
| Home store unreadable | The section shows "home store unreadable: <reason>". The current root's UI is untouched. |

## The contract suite

- **`locationsContract`** runs over `STORE_BACKENDS`, because the home store can
  be JSONL or SQLite. Its properties:
  - registering is idempotent by canonical path, and a symlinked path finds
    the same node;
  - registering ranks the location first;
  - forget deletes the node and leaves the directory byte-for-byte the same;
  - status is derived correctly for each fixture: a JSONL store, a SQLite
    store, a missing path, a plain directory, and a served one through a
    written presence file;
  - a malformed location lists as `broken` with a warning;
  - listing never writes to a listed store, so opening still never writes;
  - the tag and field are minted once.
- **`extensionContract`** picks the family up as it does every bundled family:
  load and unload, the switch, no seed of its own.
- **`surfaceContract`** lists the actions on the CLI, MCP and agent wires with
  their hints.
- **A spawn test** starts `kb ui --port 0` over a temp root, then checks that
  the URL in presence answers and serves that root.

## Steps

Each step is one commit. Restructure steps leave behaviour unchanged and are
proven by the tests that already pass.

| Step | What | Kind | Size |
|---|---|---|---|
| L0 | This plan, and its queue nodes in kb | docs | S |
| L1 | `kb ui --port 0` binds a free port, prints it and records it in presence. The default (4321) is unchanged | restructure | S |
| L2 | The action-mode member for reaching outside the root, and its MCP hint mapping (`mcpToolHints`), if the owner agrees | restructure | S |
| L3 | `@kb/locations` and `@kb/locations-fs`: home resolution, `location.list/register/forget`, `locationsContract` | add | M |
| L4 | Auto-register from `runUiCli` and `kb init`; `kb locations` | add | S |
| L5 | `location.open`, the spawn and `kb open`; the agent policy node in this repo's store | add | M |
| L6 | `@kb/locations-ui`: sidebar section, ⌘K command, broken states; the switching case in `ui-plugins.test.ts` | add | M |
| L7 | DESIGN.md "Locations", DESIGN-UI.md sidebar, and backup-strategy.md "kb Home Store" | docs | S |

This plan does not depend on O3–O5. The sidebar and command points are shell
points that stay core. L2 touches `@kb/contracts` action modes. It can conflict
with the Cordis gap-1 work only if that work also edits the mode type.

## Questions for the owner

1. **The home store is a full kb root at `~/Library/Application Support/kb/home`
   (`KB_HOME` overrides).** It goes to Time Machine, not Mackup and not git.
   *Recommended: yes.*
2. **How is recency kept?** Either by sibling order (opening ranks first) or
   in an `opened-at` field. *Recommended: sibling order.* It needs no new
   field, and a date field holds only a day.
3. **Should Nix register this repository's two stores** (`.kb` and
   `tools/kb/.kb`)? *Recommended: no.* Each registers the first time it is
   opened. Writing user state from activation would cross the backup
   strategy's line.
4. **An action-mode member for reaching outside the root**, so that MCP
   reports `openWorldHint: true` for these actions. *Recommended: yes.* The
   alternative leaves the hint false while they touch home and start
   processes.
5. **Same tab or a new tab on open?** *Recommended: the same tab, with ⌘-click
   for a new one.*
6. **Spawned servers keep running.** *Recommended: yes, with no supervisor.*
   `kb locations` shows which locations are served.

## Non-adoptions

- **One server serving many roots under path prefixes.** Every per-root
  service (hub, kernel, presence, the query watcher) would need a second
  dimension.
- **Rebinding a running server.** It is a restart under another name.
- **Stored backend, status or opened-at timestamps.**
- **A JSON registry file like `obsidian.json`.** It would be a second storage
  shape beside nodes.
- **Seeding `#kb-location` into every store through the fold.**
- **A `kb://` URL handler.** It needs OS registration. Later, if wanted.
- **Cross-store queries, or refs between locations.**
- **Dropping missing locations silently**, as Obsidian reportedly does.

## Review (GPT-6.1 Sol, 2026-10-17)

A security review of batch L as it landed (main `0db1f307`). Each finding
was verified against the code before it was fixed.

| # | Severity | Finding | Fix |
|---|---|---|---|
| L1 | blocker | `location.open` starts a `kb ui` over any store the probe accepts, and that server imports the root's `.kb/extensions/*.ts`, so an agent could run code it chose with no trust check. | An agent's register, forget and open ask, by a floor the family declares; a root's repository extensions load only when that root is trusted, through the existing code trust. |
| L2 | major | Agents register, forget and open with no approval, though DESIGN.md says they ask: a write with no policy and no declared approval is allowed. | The floor of L1, with a contract case. |
| L3 | major | The URL in `.kb/ui.json` is checked only for its root, then navigated to and fetched. | `servingUi` accepts only a loopback `http://` URL with a port. |
| L4 | minor | A start that times out leaves its child running, which later ranks its root, though a failed start should rank nothing. | The child is killed on timeout. |
| L5 | minor | Two opens of one closed root start two servers. | One start per root at a time. |
| L6 | minor | Concurrent home writes lose updates: `commitHome` commits without `expected`, and the list is rewritten from a snapshot. | The read fingerprint is passed as `expected`, and a conflict retries. |
| L7 | minor | Two registration paths, one called by a string alias with no wire (actor undefined, read as the owner). | One registration owner, through the normal wire. |
| L8 | minor | Presence's `pid` is written and never read. | Read or removed. |
| L9 | minor | The detached server child gets the whole environment. | A minimal allowlist from the one child-env owner. |
| L10 | minor | `locationsContract` overrides `serve`. | A real-`serve` case, or a named gap. |

### Batch R: the re-review (main `c14236f9`)

A re-review of the security fixes as they landed. Each finding was verified
against the code before it was fixed.

| # | Severity | Finding | Fix |
|---|---|---|---|
| R1 | blocker | A trusted repository extension's digest covers only its own file, then `import()` runs its whole module graph, so a trusted `a.ts` importing `./helper.ts` runs a helper nobody trusted. | Trust covers what runs: the imported bytes are the verified bytes, and a relative import out of the one file is refused. A helper that is not trusted never runs (a contract property). |
| R2 | major | `@kb/client`'s `commitChange` commits through `store.commitEffect` directly, with no system-write rule or approval, and `openClient` is published for external tools. | It commits through the one commit owner. |
| R3 | minor | Opening a store commits its seed and migrations through `store.commitEffect` directly. | Explicit `systemWrites: "system"` commits through the owner, which becomes `commitEffect`'s one caller. |
| R4 | minor | `persist` in `runtime/src/session.ts` exists only for tests. | Moved out of `src`. |
| R5 | minor | `agentSeedNodes`' comment overstates the guard: a field is configuration only on a tagged node. | The comment states the tag requirement. |
| R6 | minor | The Claude adapter passes the whole environment to the SDK child. | It uses the one child-env owner. |
| R7 | minor | `stopChild` sends only SIGTERM. | SIGKILL after a grace period. |

R5 did not reproduce: a configuring field counts as configuration on any
node, tagged or not, so the comment was left as it is. R6 as stated did not
reproduce either (the SDK child got only picked variables); its fix removed
a second allowlist instead.

### Review round 4 (GPT-6.1 Sol, 2026-10-17): batch 3

A review of round 3 as it landed (main `c00a439a`). Each finding was
verified against the code before it was fixed.

| # | Severity | Finding | Fix |
|---|---|---|---|
| 3.1 | blocker | R1's trust closure is open: `scanImports` sees only literal specifiers and the verified load hook only paths under `.kb/extensions`, so a computed `import()` of a file outside runs unverified, and a symlinked extension loads the bytes on disk after its digest was checked. | Only the bytes that were hashed are imported, served by real path; a link that resolves out of the extensions directory is refused; every non-literal import is decided explicitly. A contract property for each escape. |
| 3.2 | major | `env:` secret refs resolve any environment variable, and the agent child keeps the person's login variables. | Verified whether a resolved value can reach a node, a tool result or the page; an `env:` ref resolves only a name declared as a secret, and login variables reach the child only where the adapter declares it runs the person's own login. |
| 3.3 | major | A store migration writes through `persistOwnWrite` as a system write with no expected fingerprint. | Through the commit owner with its mode justified and an expected fingerprint. |
| 3.4 | major | Opening commits the seed and migrations with no expected revision: a lost update. | The loaded snapshot's revision is expected, and a conflict plans the migration again. |
| 3.5 | minor | `stopChild` sends SIGKILL to the group even after a clean exit. | SIGKILL only when the group is still alive after the grace. |
| 3.6 | minor | The server's and the page's `visibleNodes` keep scaffolding trace ends differently. | One shared function. |
| 3.7 | minor | `bundled/src/index.ts` claims a derived table that a root's repository `refCarriers` make false. | The claim is corrected, or gap 01M549TK1WP4E6T4QHNDRSDYQA's text extended. |
