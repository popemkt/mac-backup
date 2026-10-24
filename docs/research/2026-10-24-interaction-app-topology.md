# Topology for a "human interaction point" app that supervises coding agents across machines

Date: 2026-10-24. Nothing in /Users/popemkt/.dotfiles or on shared-server was changed. Claims are tagged
**[code]** (read in source this session), **[doc]** (a project's own docs), **[prior]** (from the four
earlier research files in this directory), **[inferred]** (my reading) or **[unverified]**.

Sources read: bb at `5e1acd765` and T3 Code at `b24e8ce2` (existing clones in /tmp/rs, same code the
earlier reports used; a fresh shallow clone into /tmp/topo-research was started but not needed),
plus `t3code-restart-research.md`, `bb-restart-investigation.md`, `own-harness-and-context-composer.md`,
`bb-vs-pi-omp-harness.md`, `projects-layer-research.md` (all in this directory). Nothing from either repo was run.

Path note: the brief named /Users/popemkt/.dotfiles/docs/research/; that directory does not exist in the main
checkout. The files live next to this report.

## 1. Summary

1. The owner's workbench goals (one place to see and steer everything, works when a machine or the server is
   down, instant on phone over Tailscale, notifications, cross-machine handoff, plugins, a future project layer)
   are served best by a **hybrid: per-machine authority for each machine's threads, plus one thin
   aggregator that is a directory and a notifier and is never on the critical path**. Neither product is that
   today. bb is a central-authority design; T3 is a per-machine-authority design with a client-side fan-in and
   no aggregator for data.
2. bb's weakness is real but narrower than "the server is a single point of failure". When the server is
   down, agents keep running (daemon holds them, buffers events in memory, reconnects forever) **[prior,
   code]**. What is lost is the UI, orchestration, plugin server code, MCP/`bb` calls from agents, push
   notifications, and any new work. Today's failure that actually killed threads was a unit stop that
   took the daemon's cgroup with it, not the topology **[prior]**. That part is fixed by deployment changes
   (split units, `restartIfChanged=false`), not by redesign.
3. T3's strength is that every machine is a complete product (server, state, UI endpoint), so any
   machine outage costs only that machine. Its costs: no cross-environment routing by design ("never routes
   work between them" **[doc]**), no unified data (the unified thread list is a client-side merge, so a closed
   client sees nothing), and push notifications need its cloud relay (T3 Connect) **[doc]**.
4. Federation and CRDT products (Matrix, Nostr, Automerge, Electric, Zero, Replicache) solve a harder problem
   than this one. Agent event logs have one natural writer each (the machine running the agent), so
   per-thread append-only replication by `(thread, sequence)` cursor is enough; only small mutable
   metadata (title, archived, pin, project membership) needs last-writer-wins. No CRDT library is needed.
5. Recommended: **keep bb as the daily workbench now, harden it cheaply (section 7, stage 0 to 1), and design
   every new piece (composer, project layer, canvas links) as a host-independent core with adapters** so the
   topology can move to the hybrid later without rewriting them. Build the aggregator only when a concrete
   pain (a second user-visible outage, phone cold-start latency, or a pi-based harness) justifies it.
6. Cheap hardening in order of value per effort: (a) stop the power key and any unit stop from
   killing agents (`HandlePowerKey=ignore`, split `bb-server` / `bb-host-daemon` units, `restartIfChanged=false`);
   (b) Litestream (or plain periodic `.backup`) of the bb data dir to a second place; (c) a documented, rehearsed
   cold standby that restores to a second machine and takes over the Tailscale Serve name; (d) only then
   consider a hot standby.

## 2. Evaluation criteria (the owner's, experience first)

E1 one place to see and steer all threads across machines; E2 still works when a machine or the server is
down; E3 quick to open from any device including phone over Tailscale; E4 notifications; E5 cross-machine
handoff; E6 plugins and extensions; E7 fit with the context composer and project layer. Then infrastructure:
failure blast radius, latency, auth/multi-user, version skew, effort.

## 3. How bb and T3 actually implement their pieces

### 3.1 bb: central server, host daemons, plugins split across both

- **Central hub, state in one SQLite DB.** `docs/system-overview.md` (bb): "Server. Central hub. Stores all
  state in a SQLite database ... Stateless itself; the DB is the source of truth. Routes work to hosts over
  the active daemon WebSocket." **[doc]** The DB is opened with `journal_mode = WAL`
  (`packages/db/src/connection.ts:294`) **[code]**, which matters for Litestream (WAL-based).
- **Host daemon per machine** runs agent provider processes and "posts events back" in batches
  (`docs/system-overview.md`, "Commands and events") **[doc]**. Server to daemon is RPC over the daemon's
  websocket; daemon to server is event batches.
- **"One computer runs the bb server"** and "while the server machine is asleep or off, nothing can reach
  bb and running threads may stop" (`docs/multiple-devices.md`) **[doc]**. bb itself states the SPOF. The
  install on shared-server shows threads need not stop if the daemon survives **[prior]**.
- **Reconnect and buffering** (measured from the minified 0.46.1 bundle, not the source) **[prior]**: the
  daemon queues events in memory, retries with backoff capped at 30 s, websocket retries forever (1 s to 10 s),
  sends `undeliveredEventThreadIds` and `activeThreads` at `/session/open`. Same daemon `instanceId` after a server
  restart: threads stay active and are reconciled. Different `instanceId`: every active thread on that host is
  interrupted `host-daemon-restarted`. The queue is lost if the daemon dies.
- **Version skew is strict equality.** `packages/host-daemon-contract/src/protocol.ts:1-19`:
  `HOST_DAEMON_PROTOCOL_VERSION = 252` and `HOST_DAEMON_COMPATIBLE_PROTOCOL_VERSIONS = [HOST_DAEMON_PROTOCOL_VERSION]`
  (a one-element list) **[code]**. There is a compatibility-list mechanism already and a family of
  `hostDaemonSupports*` helpers using `>=` for features (lines 21-45), so the machinery for ranges exists;
  the list is simply kept to one value. In the head of main it is 252; the installed 0.46.1 is 237 and the Mac's
  0.47.0 is 251 **[prior]**.
- **Plugins span three places.** A plugin has `server.ts` (runs in the server), `app.tsx` (browser UI) and an
  optional host artifact (`experimental_providerBridge`, "runs on the host", one process per provider artifact,
  `docs/provider-plugin-api.md:218-239`) **[doc/code]**. For example `plugins/push-notifications/` has `server.ts`,
  `sender.ts`, `app.tsx` and sends through Expo; `plugins/provider-claude-code/` has `server.ts` plus a host
  bridge. Plugin storage and secrets live under `<dataDir>/plugins/<id>/` (`docs/configuration.md:871`) **[doc]**.
  Consequence: plugin server code is central; plugin host code is per machine.
- **Auth and multi-user.** `docs/multiple-devices.md` **[doc]**: Tailscale ACLs are the access boundary for the
  private route ("do not expose through Funnel"); `--server-bind-host 0.0.0.0` makes the public API
  unauthenticated with command execution and file reads. bb connect (getbb.app, Cloudflare Worker + D1,
  Fly gate in `docs/connect-next.md`) adds an account-gated route and mobile pairing with per-device revocable
  credentials and 7-day sessions. The shared-server runs several people; identity is a person per
  account, not a per-person server **[inferred; the multi-user model beyond this was not read]**.
- **bb already has a coordination plane in the cloud.** `docs/connect-next.md`: accounts, servers, machines,
  credentials and OAuth grants "stay in the Cloudflare D1 database ... only the data plane moves to Fly".
  The vocabulary (control vs data plane) is the same as Tailscale's **[doc]**. It is a gate and tunnel for one
  server, not a directory of independent authorities.
- **Cross-machine orchestration is native.** "Spawn and fork accept a live owner across projects, hosts, and
  environments" (`docs/system-overview.md`, thread lifecycle ownership) **[doc]**; a project can map to
  paths on several machines; manager threads coordinate child threads. This works because one server holds
  all machines' state.
- **Mobile.** App is a client of a server, "runs nothing itself", pairs over bb connect or a direct
  Tailscale Serve URL, push via Expo relay (`docs/multiple-devices.md`) **[doc]**.

### 3.2 T3 Code: server per environment, client holds many

- **Environment = one server + its machine + state.** `docs/internals/remote.md`: "Each connection joins a client
  to one environment ... The environment owns providers, execution, files, and durable state."
  "A project and its threads belong to one environment ... A repository identity can correlate clones across
  environments, but never routes work between them." **[doc]** This is the explicit non-goal that bb's
  design does the opposite of.
- **Client holds many connections with route fallback.** A saved environment has an ordered route list
  (LAN, Tailscale, SSH, T3 Connect tunnel); `packages/client-runtime/src/connection/driver.ts` walks routes and
  `supervisor.ts` preflights better routes while connected; learned routes come from the server's reported
  addresses (`docs/internals/remote.md`) **[doc]**. Tailscale "needs no separate environment type".
- **Fan-in is in the client.** The settings docs speak of "**All environments** ... a explicit bulk edit of
  connected, loaded servers, not a durable global default or a promise to synchronize offline or future
  environments" (`docs/internals/overview.md:49`) **[doc]**. Nothing aggregates on a server.
- **Per-environment auth.** Pairing delegates scopes; the environment issues its own sessions; every RPC
  declares a required scope (`apps/server/src/auth/RpcAuthorization.ts`); cloud identity and relay credentials
  are a separate trust boundary (`docs/internals/environment-auth.md`, `t3-connect.md`) **[doc]**.
  Multi-user inside one environment is scopes on pairing, not accounts **[inferred]**.
- **Relay is a broker, not a data path.** T3 Connect (Clerk identity + Cloudflare Worker, Durable Object for held
  webhooks) "does not proxy their HTTP or WebSocket sessions" after bootstrap; the environment mints a one-time
  credential bound to the client's DPoP key (`docs/internals/t3-connect.md`) **[doc]**. Mobile push: "Background
  delivery requires T3 Connect; a direct or Tailscale connection alone does not enable push
  notifications" (`docs/user/mobile-notifications.md`) **[doc]**. This is exactly the "optional aggregator
  off the critical path" shape, applied only to auth and push.
- **Cross-environment orchestration is only via MCP.** Each environment exposes `/mcp`; any agent
  (including one in another environment) can sign in with OAuth/PKCE and "read projects and threads, start and
  message threads" (`docs/user/outside-agents.md`; `apps/server/src/mcp/`) **[doc]**. So an agent on A can drive
  B if given B's MCP URL and a grant. I did not find a built-in picker for it **[inferred]**.
- **Version skew is a coarse integer + capabilities.** `packages/contracts/src/environment.ts:12`
  `ORCHESTRATION_PROTOCOL_VERSION = 2`; features by capability flags in the descriptor, "never through a client
  version"; remote servers "can outlive several client releases" **[code/doc]**. A blocked client can still update
  an outdated server (`outdatedHostUpdate.ts`) **[prior]**.
- **Agents die with their server** (process-group watchdog, `ClaudeAdapterV2.ts:313-358`), recovered by native
  resume (`restartContinuationRun`) **[prior]**. So T3's per-machine model buys independence between machines,
  not agent survival. Server restart = turn interrupted.
- **Plugins.** T3 has providers (adapter layer) and MCP, not an extension SDK like bb's plugin SDK. Within what I read
  I did not find a UI plugin system **[unverified]**.
- **Thread handoff across providers** is textual summaries (`docs/internals/context-handoffs.md`), 240-char
  prefixes per item, no native session parity **[doc]**. Cross-machine handoff of a live session is not a feature.

### 3.3 Evidence-based comparison of the two as they are

| | bb | T3 Code |
|---|---|---|
| Authority | one server per fleet | one server per machine |
| Agents survive server restart | yes (daemon), if cgroup is separate | no (resume instead) |
| Unified list | server-side, always | client-side, only while client is connected |
| Cross-machine spawn | native | MCP only; routing "never" built in |
| Mobile push | Expo via server plugin | needs cloud relay (T3 Connect) |
| Version gate | exact integer, one-element list | coarse integer + capabilities |
| Plugins | rich SDK (server + UI + host bridge) | providers + MCP |
| Server down | UI + orchestration + plugins + new work gone | only that machine gone |

## 4. The five patterns

### Pattern 1: Central server + host daemons (bb today), hardened

State that is actually central **[code/doc/prior]**: the SQLite DB (projects, threads, events, environments, host
enrolment, settings, automations), auth material (`auth.json`, better-auth sessions, secrets under
`<dataDir>/plugins/<id>/secrets/`), plugin server code and storage, themes, thread storage. The daemon holds:
agent processes, the in-memory event queue, the workspace on disk, its own `host-id`/`auth.json`.

**Hardening options**
- **A. Do not let the server die from the outside.** Power key: `services.logind.settings.Login.HandlePowerKey = "ignore"`
  (NixOS; name of the option differs by release **[unverified]**). Unit stop kills daemon: split
  `bb-server` and `bb-host-daemon` into separate units with `restartIfChanged=false`, per the restart report
  step 1/3 **[prior]**. Effort: hours. Removes the only failure that actually cost threads.
- **B. Continuous backup with Litestream.** Litestream streams the WAL to S3-compatible storage, SFTP or a file
  path; seconds-level RPO, async, one writer. Restore = `litestream restore` then start bb. It is **not a failover
  tool**. It needs the DB opened in WAL (bb does, **[code]**) and a long-lived process next to the DB. Caveats:
  (1) bb's data dir has more than the DB (auth, plugin secrets, host identity) so also sync `~/.bb` files;
  (2) the daemon acked events the replica has not yet seen are lost on the server side, and the daemon will not
  resend them; whether bb detects a sequence gap is **[unverified]**;
  (3) restoring on a second machine must change which server the daemons dial.
  Litestream details (version behaviour, supported sinks) are from my background knowledge, not checked this
  session **[unverified]**.
- **C. Cold standby.** Second small machine runs nothing (or a stopped bb) and holds the Litestream replica.
  Takeover: restore, start `bb-server`, move the stable name (Tailscale Serve hostname or a Tailscale Service
  that already exists in this repo for apps, see `my.stacks.vpn.services`) to it. Daemons reconnect forever, so they
  re-attach when the name answers; same `instanceId`, so threads stay active. RTO: minutes, manual. Effort: 1 to 2 days
  including a rehearsal.
- **D. Hot standby with LiteFS.** LiteFS gives a primary and read replicas via a FUSE filesystem and a
  Consul-like lease. I recall it being in maintenance mode and LiteFS Cloud being retired **[unverified]**. It does
  not make bb's multi-process writes safe by itself, and the server expects a single writer; promotion needs
  fencing (old primary returning). Effort and risk are out of proportion for a one-person fleet. **Not recommended.**
- **E. Active-active.** Not possible: SQLite single writer, server keeps in-memory state (pending
  interactions **[unverified]**), daemons dial one server.

| Aspect | Pattern 1 |
|---|---|
| Failure/blast radius | Server or its machine down: all UIs, orchestration, plugin servers, push, `bb` calls from agents, new threads gone. Agents run on, buffering in RAM. Daemon down: that machine's threads interrupted. |
| Latency | One hop to server; phone talks to one origin. Server-to-daemon RPC across Tailscale. |
| Mobile/Tailscale | Excellent: one URL (Serve) or bb connect; pairing exists. |
| Auth/multi-user | One auth domain, existing ACL + account model; shared-server works today. |
| Cross-machine orchestration | Native. |
| Plugins | One place to install; server half central, host half per machine. |
| Version skew | Exact equality; nearly every release forces daemon replacement. Fix is in bb (widen the list, capability flags) or by gating restarts on idle. |
| Effort | Lowest. Hardening A: hours; B: a day; C: 1 to 2 days. |
| Future fit | Good for composer/projects as bb plugins; blocks nothing, but ties them to bb. |

### Pattern 2: Per-machine servers + multi-server client (T3)

- **Cross-machine orchestration.** Not native. Options: an agent on A uses B's MCP (T3 supports it, OAuth + PKCE per
  agent), or the client copies work via handoff summaries. A "manager thread" over several machines would need a
  client-side or aggregator-side coordinator. Ownership across machines is hard because each environment's
  thread ids are local.
- **Unified thread list.** Client-side merge of N live subscriptions. Cost grows with N, and a freshly opened
  phone must connect to every environment before the list is complete (or keep a cached copy). A machine that is
  off shows as stale, not missing, only if the client caches **[inferred]**. T3 groups by repo identity (upstream
  remote) so clones on several machines appear together **[doc]**.
- **Notifications.** Direct/Tailscale connections give none when the app is closed; background push needs a
  relay. That is a small cloud dependency, but not on the data path.
- **Where plugins run.** On each machine's server. A plugin that wants a cross-machine view must be a
  client-side plugin or talk to N servers. Installing/updating a plugin = N installs.
- **Upgrade/version skew.** Best of the options: coarse epoch + capabilities; the client adapts to what each server
  advertises ("clients must use advertised capabilities", `remote.md`).
- **Blast radius.** One machine at a time. No server SPOF; the client is not a SPOF (any client works).
- **Costs.** Re-architecting bb to this shape is not possible (bb is closed around one server DB); adopting T3 means
  leaving bb's plugin SDK, its projects/manager-thread model and everything the owner has built as bb
  plugins (agent-artifacts, canvas-link, bbim).

| Aspect | Pattern 2 |
|---|---|
| Failure | Machine-local only. Client sees partial fleet. |
| Latency | Phone has N connections; per-machine direct paths are the shortest possible. Cold start slower (N handshakes). |
| Mobile/Tailscale | Works (routes); push needs relay. Phone must reach every machine; machines asleep are invisible. |
| Auth/multi-user | Per environment; each machine pairs separately. N pairings per device. Shared-server would carry its own scopes. |
| Cross-machine | MCP or client-mediated; no shared parent/child ownership. |
| Plugins | N installs, no cross-machine plugin state. |
| Version skew | Good (capabilities). |
| Effort | Adopt T3 as is: low. Build the equivalent: high. |
| Fit | The projects layer ("a project spans several repos and machines") has no home: nothing holds the grouping above environments except the client. |

### Pattern 3: Peer/federated servers (each a full server, metadata synced)

- **Consistency model.** Per-thread events: single writer (the machine that runs the agent), so replicate by
  `(thread_id, seq)` cursor, idempotent apply; this is eventually consistent with no conflicts. Thread
  metadata (title, archived, pin, project, ownership edges): last-writer-wins per field with a hybrid logical clock,
  or single-owner-per-thread (only the host machine mutates). Cross-thread relations (manager owns child on other
  host): the owner machine holds the edge, the other machine holds a reference record.
- **Failure modes.** Partitions are normal and fine (each machine is authoritative for its threads). Real hazards:
  clock skew in LWW, ghost threads after delete (needs tombstones), ordering of "owner archived => dependents
  archived" across machines (a saga, not a transaction), identity of users across servers.
- **Latency.** Local reads always; cross-machine view lags by replication delay (seconds over Tailscale).
- **Mobile.** Phone attaches to any one peer and sees the merged index, so the cold-start is one connection. If
  that peer is off, attach to another: a pleasant property.
- **Auth/multi-user.** Hardest part: every server needs to trust the other servers and the same users. Tailscale
  identity can carry this (tags/ACLs, whois headers) so peers authenticate by node identity.
- **Plugins.** Each peer runs them; plugin state either local or via a shared-state contract.
- **Version skew.** Worst: peer-to-peer metadata schema has to be compatible across arbitrary releases
  (needs a compat epoch like T3's).
- **Effort.** High: a sync protocol, tombstones, conflict policy, schema versioning, migration, testing under partitions.
- **Verdict.** Over-built for one owner and 2 to 4 machines unless the aggregator in pattern 5 is the same thing in smaller form.

### Pattern 4: Local-first / CRDT

- **Fit of the data.** Agent logs are append-only with a single writer: they need *replication*, not a CRDT. A CRDT library
  (Automerge) would hold large documents (history grows without bound; compaction needed) for little gain.
  Metadata could be LWW maps; a small custom HLC/LWW layer is simpler than a general CRDT **[inferred]**.
- **Product fit (from background knowledge, none run) [unverified].** Electric (Postgres to client sync engine),
  Zero (server-authoritative query sync with client cache) and Replicache (server-authoritative mutations) all need
  a central authority; they give instant, offline-tolerant *clients*, not authority-less servers. They would improve
  E3 (phone opens instantly from a local replica) and E2 (read-only access when the server is down), but not
  failover of writes. Automerge is true peer sync but heavyweight for logs.
- **Failure/blast radius.** Reading survives total server loss; steering (sending a prompt) does not unless it
  queues and applies later. A queued command to an agent whose context has moved on is semantically risky.
- **Latency.** Best on read; writes need the agent's machine anyway.
- **Mobile.** Strong: replica on device, instant list.
- **Auth.** Replicating thread content to a phone is a new data-at-rest surface; scoped partial replicas needed.
- **Plugins/version skew.** Schema becomes a replicated contract; migrations become distributed.
- **Effort.** High. Valuable mainly as a *client cache* layered on pattern 1 or 5, not as the topology.

### Pattern 5: Hybrid: per-machine authority + thin aggregator/relay off the critical path

Shape:
```
 phone / browser / desktop ---- (direct, Tailscale) ----> machine A authority (threads that run on A)
          |                                              machine B authority
          +--- (directory, push, search) ---> aggregator (optional): machine list, thread index
                                                          (metadata only), notifications, project registry
```
- **Authority per machine.** The event log lives where the agent runs (the daemon already sits there). The
  per-machine authority = the daemon plus a small API (T3's "server", bb's host daemon with its local HTTP API
  `docs/system-overview.md`).
- **Aggregator** = Tailscale's *coordination plane* (who exists, where, with which grants); the machines' WireGuard
  links are the *data plane*. If the coordination plane is down, existing connections keep working: that is the
  design property to copy. Contents of the aggregator: machine directory, thread index (id, title, status,
  last-activity, machine), project registry (the kb `#project` node), notification fan-out, search index for the
  projects layer. Rebuildable from the machines, so it needs backups, not replication.
- **Without the aggregator** a client degrades to T3's mode: connect to machines directly.
- **Compare with bb connect / T3 Connect.** Both are a coordination plane limited to *access* and *push*. The step
  from them to pattern 5 is adding the thread index and project registry to it.
- **Compare with Matrix / Nostr.** Matrix: rooms as threads, federation by event DAG replication, push gateway,
  E2EE, mature mobile clients. It gives the aggregator, replication and mobile for free, but brings a
  homeserver (Synapse/Conduit-class) to run, an event model that does not fit streaming tool output, and no concept of
  "agent's machine as authority". Nostr: signed events, dumb relays, trivial to implement a private relay; no ACLs, so
  you would add Tailscale in front. Both duplicate what Tailscale already provides (identity, ACL, transport) and
  add a second identity system **[inferred; neither was evaluated hands-on]**. Not recommended for this scale.
- **Cross-machine orchestration.** The aggregator brokers: it knows machine B has project X; a manager thread
  on A asks the aggregator for "spawn on B" which becomes an authenticated call to B's authority. This restores
  bb's cross-host spawn, with the owner of a child recorded on both sides.
- **Failure.** Machine down: its threads unavailable, others fine. Aggregator down: lose unified list, push, project
  search; direct access works. Client down: nothing.
- **Latency.** Direct to the machine; list from aggregator in one round trip, or cached on-device.
- **Mobile.** One origin (aggregator) for the list and push; tap a thread and connect directly to its machine.
- **Auth/multi-user.** Machine authorities keep their own scopes (T3 model); the aggregator holds only identities and
  routing, never session tokens (the T3 Connect rule: "relay never receives that session token"). Tailscale ACL tags
  express "this person may reach machine A".
- **Plugins.** Per-authority plugins for host-level things (providers, panels about one thread), aggregator plugins
  for fleet-level views (projects, composer library, canvas index).
- **Upgrade/version skew.** Each hop has a coarse compat epoch plus capability flags (T3's rule); the aggregator
  speaks the lowest common capability.
- **Effort.** Large if built from nothing: an authority protocol, an index, a client that talks to both.
  Moderate if assembled: bb daemon/ T3 server as authority is a *product choice*.

## 5. Pattern comparison table (1 = poor, 5 = excellent, my judgment [inferred])

| | 1 Central + daemons (bb) | 1+ hardened (cold standby) | 2 Per-machine + multi-client (T3) | 3 Peer federation | 4 Local-first / CRDT | 5 Hybrid authority + aggregator |
|---|---|---|---|---|---|---|
| E1 one place to see/steer all | 5 | 5 | 3 (client-only merge) | 4 | 4 | 5 |
| E2 works when server/machine down | 2 (agents run, UI gone) | 3 (minutes manual) | 5 for others, machine itself gone | 5 | 4 read, 2 write | 5 |
| E3 quick from any device/phone | 5 | 5 | 3 (N connections) | 4 | 5 | 4 |
| E4 notifications | 4 (Expo plugin) | 4 | 2 (needs T3 relay) | 3 | 3 | 4 |
| E5 cross-machine handoff | 5 | 5 | 2 | 3 | 3 | 4 |
| E6 plugins | 5 | 5 | 2 | 3 | 3 | 4 |
| E7 composer + project layer | 4 (bb plugins) | 4 | 2 (no registry above env) | 3 | 3 | 5 (registry in aggregator) |
| Blast radius | one big | one big, shorter | smallest | smallest | small | small |
| Version skew | 2 (exact) | 2 | 5 | 2 | 2 | 4 |
| Auth/multi-user | 4 | 4 | 3 (N pairings) | 2 | 2 | 4 |
| Effort to reach (from today) | 0 | low (days) | high to leave bb | very high | very high | medium to high (stages) |

## 6. Differentiators that decide it

1. **bb's plugin SDK and manager-thread model are the workbench.** The owner's tooling (agent-artifacts, canvas-link,
   bbim, the planned composer and projects plugin) is bb plugins **[prior, git log]**. Leaving bb for T3 forfeits that for the
   gain of machine independence, which is smaller than the pain it costs.
2. **The real outage was deployment, not topology.** The 10-minute event was a failed switch that stopped the unit and
   did not start it; the interruption of threads was the unit's cgroup **[prior]**. The power-key case is the same
   class: the server machine is also a person-operated machine. Fix: stop co-locating the fleet's
   coordinator with something people can turn off, or protect it.
3. **No product today separates "the machine that runs agents" from "the machine that is the directory".** bb forces the
   server to be a host too (primary host). A server-only, always-on, tiny VM (no agents) removes the power-key class
   entirely and costs one small machine **[inferred]**. This is bb with a better deployment, and it is the best
   price/benefit.
4. **A pi-based harness plus composer is naturally per-machine authority** (the pi process owns its session log and
   context assembly; pi sessions are JSONL trees **[prior]**). The composer core, projects registry and canvas index
   are *fleet-level* and belong in the aggregator layer. That is pattern 5, and it can be built incrementally
   *beside* bb: bb remains the authority/UI while the aggregator starts as a bb plugin plus kb.

## 7. Recommended target architecture

**"The workbench to have": bb as the daily workbench, deployed so the server cannot be taken down casually, with the
fleet-level layer (projects, composer registry, canvas links, notifications) built as host-independent services
that bb plugins call, not as bb-internal state. Treat T3 Code as a reference implementation to copy ideas from
(compat epoch, trial-and-commit upgrades, resume intents, relay-as-broker) and as an optional secondary client
for machines where an environment-local UI is preferable; do not adopt it as the primary.**

Reasoning against the owner's goals:
- E1/E5/E6/E7: only bb gives native cross-host spawn, manager threads and a rich plugin SDK today.
- E2: close the gap by deployment (separate always-on server, split units, standby), not by redesign.
- E3: Tailscale Serve already makes a phone one tap away; bb connect/Expo push exist.
- Future: the pi harness plugs in as a bb provider (fork of `provider-pi`, prior report option (a)); the composer
  and the projects layer are core libraries plus adapters, so they survive a later move to pattern 5.

Target layers:
1. **Authority per machine**: bb host daemon (own units, never restarted by a rebuild).
2. **Fleet server**: `bb-server` on a small always-on machine (not a person's workstation, no power-key
   exposure), data dir backed up continuously, a cold standby with the stable name documented.
3. **Fleet services (host-independent)**: the project registry (kb `#project` node), composer core, canvas-link index,
   recall federation. Their only contract with bb is the plugin SDK adapter. If bb is ever replaced, these move
   unchanged.
4. **Clients**: bb web/desktop/mobile over Tailscale Serve; optional T3 desktop attached to machines that run a T3
   environment, for people who want it. Not required.

### Migration path from today

| Stage | Change | Effort | Result |
|---|---|---|---|
| 0 (now, cheap) | `HandlePowerKey=ignore` (and lid/suspend off) on shared-server; split `bb-server` and `bb-host-daemon` units; `restartIfChanged=false`; run the server-only restart experiment from the restart report with the owner's go-ahead | hours | Server restarts, rebuilds and a power key no longer kill agents |
| 0.5 | Idle-gated daemon restart (`app-bb-restart-when-idle`); write the "behind its unit" marker (T3 `.restart-pending`) | a day | Upgrades become a choice |
| 1 | Litestream the bb DB (WAL) + rsync/restic the rest of the data dir (auth, plugin secrets) to a second place | 1 day | RPO of seconds for the DB, restore rehearsed |
| 2 | Cold standby on a second machine, takeover runbook, rehearse it once; the stable name = Tailscale Serve host or a Tailscale Service so daemons re-attach by themselves | 1 to 2 days | RTO of minutes without a hot standby |
| 3 | Move `bb-server` to a small always-on VM with no agents (shared-server keeps only a daemon) | 1 to 2 days + enrolling | The directory is no longer a person-operated workstation |
| 4 | Build composer core + projects plugin as host-independent cores with a bb adapter | 3 to 6 weeks (prior reports) | Fleet layer exists without topology change |
| 5 (only if a trigger fires) | Add the aggregator: thread index, notifications, search, hosted off the critical path; clients can attach to a daemon directly for degraded mode | weeks | Pattern 5 |
| later | Upstream or fork: widen `HOST_DAEMON_COMPATIBLE_PROTOCOL_VERSIONS`, adopt capability flags | upstream-dependent | Releases stop forcing daemon restarts |

**Triggers to move from stage 4 to stage 5**: (i) a second unplanned server outage after stage 3; (ii) a pi harness
that must run when bb is unavailable; (iii) phone cold start over Tailscale feels slow; (iv) a collaborator needs access to
only some machines.

## 8. How each pattern fits the owner's likely future

- **Pi-based harness reusing bb and T3 code.** bb's forkable `provider-pi` plugin and pi's extension hooks cover the loop and
  composer; T3's orchestration-v2 (event sourcing, outbox, resume) and compat epoch are the ideas to port. A harness with its own
  event log wants per-machine authority (patterns 2/5). Pattern 1 gets it by being a bb provider.
- **Context composer.** Needs the live truth from where the agent runs (pi extension or provider bridge), so it is host-side;
  the library of compositions is fleet-level and belongs in the registry. Hybrid fits best; pattern 1 fits as the first step.
- **Project layer** (`projects-layer-research.md`): a grouping above bb repos and machines, with recall over threads on all
  machines. In pattern 2 no server holds that; in pattern 1 or 5 the registry sits in kb and recall federates over
  `bb thread search`, Cognee, kb. Pattern 5's aggregator is the natural home for the recall index (option E there).

## 9. Open questions for the owner

1. Is there a machine that stays on (and is not a person's workstation) that can hold the server? A 5-euro VPS has a data-residency
   implication: thread content would leave the home/office network unless it is on the tailnet only.
2. How many people need access to which machines, and should they see each other's threads (shared-server model)?
3. Is a degraded mode during a server outage ("read what the agents are doing, steer one thread") required, or is "agents keep
   running; UI returns in minutes" good enough?
4. Does the owner want to depend on bb connect / Expo push (cloud) for notifications, or self-host push?
5. How strongly does the owner want to avoid being tied to bb's release cadence (36 commits/day, exact protocol)?
6. Would the owner accept T3 Code as an additional client on machines where it is more convenient, accepting two thread worlds?
7. Is the cold standby acceptable (manual minutes) or is automatic failover a hard requirement?

## 10. Unverified

- Everything about Litestream, LiteFS, Electric, Zero, Replicache, Automerge, Matrix, Nostr and Tailscale Services failover is
  from background knowledge, not checked in this session (no network searches done).
- Whether bb detects a gap between events the daemon considered delivered and what a restored DB contains.
- Whether the server holds in-memory state that is lost on restore (pending interactions, ephemeral queues). Prior report also unverified.
- Whether the co-located daemon on a server machine is special-cased, which would complicate stage 3 (server on a VM
  with no agents) and the unit split (prior report open item).
- Whether `bb thread spawn` across hosts works with a standby that has a restored DB and the same host enrolment (should, as
  enrolment is in `auth.json` + DB; untested).
- bb's multi-user model (accounts/ownership on shared-server) was not read in code.
- T3's plugin story and the exact client list merge behaviour (the sidebar code under `apps/web/src/components/sidebar` was only listed).
- NixOS option name for ignoring the power key varies by release.
- The 0.46.1 daemon behaviours (buffering numbers, instanceId reconciliation) come from the minified bundle read by the previous
  report; the open-source main (252) was not diffed against it.
- Line numbers: `protocol.ts:1-19` and `connection.ts:294` read directly; docs citations are by file and heading.
