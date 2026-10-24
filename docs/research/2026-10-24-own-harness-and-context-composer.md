# Research: own pi-based workbench vs bb, and the on-demand context composer

Date: 2026-10-24. Not legal advice. Claims are tagged **[observed]** (I ran or read it),
**[doc]** (a project's own docs say so), **[inferred]** (my reading) or **[unknown]**.
Sources were read from fresh clones in /tmp/rs (bb `5e1acd765` 2026-10-23, t3code, pi `136b87e`
2026-10-23, ultimate) plus the bundled SDK types in the bbim worktree. Nothing was installed;
shared-server was only read.

Note on the background docs: the two prior research files are not in the main checkout. They are on
branch `docs/research-pi` (and `docs/research-archive`), so I read them with `git show`.

## Summary

1. Licensing is a non-issue. bb, T3 Code, pi, omp and Ultimate are all MIT in their repos. bb's
   source is public at github.com/get-bb/bb. You may fork, modify and sell, as long as the licence
   and copyright notice stay with the copies. One oddity: the published `bb-app` npm package carries
   no licence field and no LICENSE file; the repo is the licence source.
2. "bb is slowing down" is not supported by the activity data. The repo took 820 commits in October
   up to the 23rd, 994 in September, and merged 1,002 PRs in September. The one real dip was July
   (389 commits). The npm release rate did fall (12 to 13 versions a month in May and June, 5 so far
   in October), but that is a packaging cadence, not a development one. The risk to watch is
   concentration: three humans (Michael Yong, Sawyer Hood, brsbl) plus Codex-authored commits.
3. The composer. A bb plugin can show the inventory and can ADD tools, skills and instructions to
   a thread, but it cannot see the request a provider sends and it cannot remove skills, MCP servers
   or tools that belong to someone else. Pi can do the whole thing: a host that embeds pi owns the
   resource loader (skills, context files, extensions, MCP) and sees or rewrites the system prompt,
   messages, tools and the serialized provider request. So the composer is fully possible on pi, only
   partly possible on bb as it ships, and fully possible on bb if the composer lives in a pi-backed
   provider that is a fork of bb's own `provider-pi` plugin, which is MIT and explicitly kept
   forkable.
4. Own harness cost. bb is about 860k lines of non-test TypeScript (plus 760k of tests). T3 Code is
   of similar order. A matching single-user pi workbench is a much smaller thing: Ultimate is about
   80k non-test lines and exists as a working proof (one author, 488 commits since 2026-10-19 in the
   public history). I estimate 6 to 12 weeks part-time to reach parity on what you use daily, and
   4 to 8 months for real bb parity including mobile, plugin ecosystem and machines. Details below.
5. My read: do not start with (c). Build the composer core as a pure library with a pi adapter now
   (it is useful in every option), ship it first as option (a), a fork of bb's `provider-pi` plus a
   bb thread panel, and keep (c) as a later decision once the composer has proven itself and a real
   bb limit blocks you.

## 1. Licensing and reuse

| Project | Licence | Evidence | Source public |
|---|---|---|---|
| bb | MIT, "Copyright (c) 2026 Michael Yong" | /tmp/rs/bb/LICENSE; `gh api repos/get-bb/bb` gives `license.spdx_id: MIT`; root package.json `"license": "MIT"` | https://github.com/get-bb/bb (4,586 stars, 692 forks) |
| T3 Code | MIT, "T3 Tools Inc." | /tmp/rs/t3code/LICENSE | https://github.com/pingdotgg/t3code (29.7k stars) |
| pi | MIT, "Mario Zechner" | /tmp/rs/pi/LICENSE; repo now at earendil-works/pi | https://github.com/earendil-works/pi (117k stars) |
| omp | MIT | `gh api repos/can1357/oh-my-pi` | https://github.com/can1357/oh-my-pi (36k stars) |
| Ultimate | MIT, "Daniel Griesser" | /tmp/rs/ultimate/LICENSE | https://github.com/HazAT/ultimate (188 stars) |

What MIT allows: use, copy, modify, merge, publish, distribute, sublicense and sell, including in a
closed-source or commercial product, with no copyleft and no obligation to publish changes. The one
condition is that the copyright notice and licence text travel with copies or substantial portions.
It carries no warranty and grants no trademark rights.

Specifics worth knowing:
- `npm view bb-app license` prints nothing, `package.json` in the installed copy on shared-server
  (`~/.local/lib/node_modules/bb-app/`, version 0.46.1) has no `license` field, and the directory has
  no LICENSE file (ls shows app, dist, host-daemon, node_modules, package.json, README.md, server).
  So fork from the repo, not from the npm tarball. `bb-app` and `@get-bb/plugin-sdk` both list
  `repository: git+https://github.com/get-bb/bb.git`.
- I found no trademark or brand clause in bb's or T3 Code's README or CONTRIBUTING (grep for
  licen/trademark/brand/CLA). Names and logos are not licensed by MIT anyway, so a fork should
  rename and re-brand. [inferred]
- bb's repo also contains hosted-service pieces (`apps/connect`, `apps/ai-gateway`, `apps/web`,
  the "bb connect" tunnel). They are MIT as code, but the hosted service is the vendor's; a fork
  that wants mobile access outside your own network would use its own tunnel. You already use
  Tailscale, so that is not a blocker. [inferred]
- The bundled third-party dependencies carry their own licences (Electron, Codex and Claude SDKs).
  Claude/Anthropic usage terms are a separate matter, covered in the prior doc.
- Pi Durable is marked experimental, API "changes without notice" (packages/durable/README.md).

## 2. bb health and activity

Release cadence (`npm view bb-app time --json`, stable versions only, 55 stable releases since
0.0.1 on 2026-05-16, plus 103 nightlies):

| Month | Stable releases |
|---|---|
| 2026-05 | 12 |
| 2026-06 | 13 |
| 2026-07 | 9 |
| 2026-08 | 7 |
| 2026-09 | 9 |
| 2026-10 (to the 24th) | 5 |

Latest 0.47.1 on 2026-10-24; recent spacing is about weekly (0.45.0 Oct 2, 0.46.0 Oct 9, 0.46.1
Oct 15, 0.47.0 Oct 23, 0.47.1 Oct 24).

Repository activity (full history, `git log` on a full clone; GitHub search for PRs):

| Month | Commits | Merged PRs |
|---|---|---|
| 2026-03 | 1,528 | not queried |
| 2026-04 | 808 | not queried |
| 2026-05 | 770 | not queried |
| 2026-06 | 779 | 333 |
| 2026-07 | 389 | 389 |
| 2026-08 | 901 | 892 |
| 2026-09 | 994 | 1,002 |
| 2026-10 (to the 23rd) | 820 | 376 (from the 10th) |

Total 7,101 commits since 2026-02-11. Repo state: 720 open issues, 223 issues opened since Oct 10,
pushed minutes before I checked, 100+ contributors.

Who writes it, last 30 days: Michael Yong 518, brsbl 184, Sawyer Hood 158, a `bb-slop-cop[bot]` 55,
then a long tail of single-digit contributors. All-time, "OpenAI Codex" is the top author
(2,803), Yong 2,051, Hood 1,366. So it is a small core team working heavily with agents.

Verdict on "slowing": against. Output in Aug to Oct is more than double July's, and 36 commits a day
in October. What may look slower from outside is the npm cadence (from several versions a week to
about one a week) and a UI that is feature-complete for the owner's use. The real risks are
(1) bus factor of about three humans, (2) 720 open issues, (3) the product is changing fast, so a
fork drifts quickly. Compare with pi: 117k stars, weekly commit counts of 100 to 240.

## 3. The context composer: bb plugins vs pi

### 3a. What a bb plugin can do (SDK types: bundled-types/bb-plugin-sdk.d.ts, package version 0.6.49; public docs in bb repo `docs/provider-plugin-api.md`)

| Need | bb plugin API | Verdict |
|---|---|---|
| See what is in a thread's context | None for the real payload. `agent-artifacts` rebuilds an inventory from bb state (`bb.sdk`: thread, providers, skills, plugins, files) and, for Claude Code, a side probe that starts the Agent SDK with a never-yielding prompt and asks for init, agents, MCP status and context usage (assets/bb-plugins/agent-artifacts/README.md, `lib/inventory.ts`, `lib/claude.ts`, `host.ts`) | Inventory yes, exact bytes sent no. It is a reconstruction ("precedence rules it applies", "assumed by analogy" for provider-native skills) |
| See the full request a provider sends | `message.dispatch` is the only hook (d.ts 22883 to 23060 and `PluginHookSignatures` ~23047). Context holds the prompt text, thread, project, host, requested model, attempt kind. Decisions: `proceed`, `wait`, `reject`; the doc says "There is deliberately no 'handled it myself' answer and no amendment arm" | No. It sees the user message, not the system prompt, skills or tools |
| Add tools, skills, instructions per thread | `bb.agents.configure(ctx => ({tools, skills, instructions}))` (d.ts 23410 to 23500, 23852 to 23871). Ctx carries thread, project, host, provider, `pluginMetadata`, and origin (fork or side chat). `registerTool`, `contributeInstructions` | Yes, but only the plugin's OWN registered tools and manifest skills, instructions truncated to 4,096 chars, applied "when the provider session is next started or resumed", not mid-session |
| Remove skills, MCP servers or tools that are not yours | Not in the API. No per-thread skill disable or MCP selection in the thread create/fork schemas (`createThreadRequestSchema` ~12802, `forkThreadRequestSchema` ~13004). Claude Code bridge hard-codes `settingSources: ["user","project","local"]` (plugins/provider-claude-code/src/bridge/sdk-session.ts:264), so MCP servers and hooks come from Claude's own settings | No, for Claude Code and Codex threads |
| Pass options into a provider process | `PluginProviderDeclaration.deriveProviderOptions(ctx)` (d.ts 23609 to 23850): sync, called on every session and turn command, JSON up to 64 KiB, reaches the bridge as `options.providerOptions`. But it only applies to providers the plugin itself registered | Yes, for a provider you own |
| Pass env into a provider | `bb.providers.experimental_contributeEnv(providerId, resolve)` (d.ts 23933): resolver gets `{threadId, projectId, hostId}` and returns env entries, for any provider id; `env.passthrough` for daemon vars | Yes, experimental. Whether `provider-pi` forwards it to the pi child is a spike item |
| Start a thread with a custom context | `bb.sdk.threads.spawn` takes provider, model, reasoning, permission mode, environment, `input`, `pluginMetadata`, `parentThreadId`, `sessionOptions`; fork takes `agentContextSeed`, `pluginMetadata`, `sourceThreadId` (d.ts 12802 to 13251). `pluginMetadata` is readable in `agents.configure` | Yes, in the additive sense. The metadata is a channel, not a context editor |
| Show it in the UI | `threadPanelAction` tab and header chip (what agent-artifacts uses), thread panels, nav panels, fixed tabs, CLI commands via `bb.cli` | Yes |

So: the inventory, the side chat, and "spawn more agents with a composed context" are all buildable
as a bb plugin today for the additive half. Subtractive control (the heart of "remove parts of
the context") is only possible in a provider the plugin registers itself.

The bb docs frame it the same way: provider plugins own "everything a provider touches",
with a small core (provider-plugin-api.md principle 1, "Zero first-party privilege").

### 3b. What pi gives a host (docs under packages/coding-agent/docs of earendil-works/pi, v1.4.0)

- The SDK lets the host own discovery. `createAgentSession({ resourceLoader, settingsManager,
  sessionManager, tools, noTools, excludeTools, customTools, ... })` (docs/sdk.md); "Supply a custom
  `ResourceLoader` when the host owns resource storage and discovery completely." Skills can be
  filtered, merged or replaced (`skillsOverride` in examples/sdk/04-skills.ts); context files
  (AGENTS.md style) added or replaced (examples/sdk/07-context-files.ts); extensions loaded from files
  or inline factories.
- CLI flags do the same as a subprocess: `--no-extensions`, `--no-mcp`, `--no-skills`,
  `--no-prompt-templates`, `--skill <path>`, `--extension <path>`, `--no-tools`,
  `--exclude-tools 'mcp__*'` (docs/cli.md lines 123 to 212).
- Extension hooks (docs/extensions.md): `input`, `before_agent_start` (mutable
  `systemPromptOptions`, active tools, extra message), `context` (filter messages),
  `context_with_system` (whole transcript including system), `before_provider_headers`,
  `before_provider_request` (change the serialized payload), `after_provider_response`,
  `provider_stream_event`, `tool_call` (mutate or block), `tool_result`, `agent_before_settle`,
  `agent_settled`, and session events including `session_before_fork`. Order per model request is
  context, context_with_system, before_provider_headers, before_provider_request.
- Tools: `registerTool` with exposure levels (`direct`, `model-only`, `codemode`, `deferred`,
  `hidden`), `pi.setActiveTools()`, `pi.getAllTools()`, `prepareLoadout`. Tools cannot be
  unregistered, but can be hidden or deactivated.
- MCP is built in: `pi.registerMcpServer(name, cfg)` and `pi.unregisterMcpServer(name)` at runtime,
  plus `mcp.json`.
- Sessions: a tree (`get_tree`, `fork`, `clone`, `switch_session`, `get_entries`) in JSONL
  (docs/session-format.md), and RPC commands `fork`/`clone` (docs/rpc-commands.md lines 610 to 666).
- Pi can report its own composition: `session.systemPrompt`, `getActiveToolNames()`,
  `pi.getAllTools()`. Because the host sees the system prompt and the provider payload, the
  inventory can be exact rather than inferred.

Caveat: the pi context the composer would show is pi's. Claude Code and Codex remain black boxes
under the bb providers whatever you build, except where they expose probes.

### 3c. Which host makes the composer possible, and how fully

| Capability | bb (as shipped) | bb + forked pi-provider plugin | Own harness on pi |
|---|---|---|---|
| Inventory of context | Approximate (agent-artifacts) | Exact for pi threads (system prompt, tools, skills, payload), approximate for others | Exact |
| Prediction side chat | Yes (side-chat plugin; its origin is `fork`, `pluginId: "side-chat"` in `agents.configure`) | Yes | Yes |
| Remove skills, MCP, tools per thread | No (Claude/Codex); additive only | Yes for the forked provider via `deriveProviderOptions` into `--skill`/`--no-skills`/`--no-mcp`/extension flags, or hot via a pi extension | Yes, hot, per turn |
| Per-turn edits | No | Yes, in a pi extension (`before_agent_start`, `context`, `setActiveTools`) | Yes |
| Spawn child agents with composed context | Yes, via `threads.spawn` plus metadata | Yes | Yes, plus pi's own fork/durable primitives |
| Works across vendors | Yes, all bb providers get the panel, only the pi one gets composition | Same | Only the harnesses you integrate |

One bb-specific constraint: bb pins pi at `0.84.0` in `plugins/provider-pi/package.json:46` ("Pi
extensions import the host's Pi modules", docs/repository-overview.md) while pi itself is 1.4.0 and
Ultimate uses 1.4.0. A fork would own that upgrade. [observed]

## 4. Cost of the "own harness" path

### What exists, measured

Non-test TypeScript lines (git ls-files, filtered; tests excluded unless noted):

| Area | bb | T3 Code | Ultimate (pi-based) |
|---|---|---|---|
| Whole repo | ~863k (plus ~764k tests) | ~3.3M (probably inflated by generated or vendored code; treat as order of magnitude) | ~80k (about 127k incl. tests) |
| Web app / UI | apps/app 236k, packages/shared-ui 16k, thread-view 19k | apps/web 264k | web 9k + extensions/*/web.tsx |
| Server | apps/server 101k | apps/server 234k | server 5k + extensions (61k, the product) |
| Host daemon (machines) | apps/host-daemon 26k, host-workspace, host-watcher | in apps/server | n/a (single process, "multi-instance over Tailscale") |
| DB / event log | packages/db 23k, domain 12k, server-contract 8k | contracts 26k | pi-durable (SQLite) |
| Plugin system | packages/plugin-sdk 26k, plugin-registry, plugin-build, 40+ plugins | none (providers are packages) | extensions with `server.ts`/`web.tsx` tiers |
| Mobile | apps/mobile 15.5k | apps/mobile 134k | responsive web only [inferred from AGENTS.md "on phones"] |
| CLI | apps/cli 20k | apps/cli in server | `bin/cli.ts` |
| Providers | provider-pi 7k, claude-code 12k, codex 15k, acp 13k bridge | provider-pi 6k, acp 14k, effect-codex 61k | pi only (+ pi-claude-code) |

Ultimate's public repo history starts 2026-10-19 with 488 commits by one author; the history may
be squashed, so I cannot give his elapsed time. [unknown]

### What pi/omp already provide

- pi: session tree and JSONL store, compaction, fork/clone, RPC (NDJSON over stdio), JSON mode, SDK,
  extension system with TUI, MCP and codemode built in, skills, prompt templates, packages, a
  multi-provider LLM layer (pi-ai), `chord` (hot-reloadable document host) and `durable`
  (crash-resilient, concurrent, forkable conversations, experimental). No web UI, no ACP, no
  worktree or machine management. [observed: packages list and grep for ACP found nothing in docs]
- omp: pi fork with subagents (`task`), an Agent Hub, `omp --mode rpc`, `--mode rpc-ui`, `omp acp`
  (editor-drivable), SDK for Node, plus 4,226 open issues and a contribution policy that flipped.
  [doc: omp README sections 05, 14 and "Four entry points"]
- bb's existing coverage of both: `provider-pi` (RPC mode), `acp-omp`.

### Effort table (a solo owner working with AI agents; calendar time, part-time = about 15 to 20 focused h/week)

Assumptions: reuse bb and Ultimate code where licences allow; Node/TypeScript stack; single user
(plus maybe a few machines); no hosted multi-tenant service; no Windows; Claude Code and Codex
integration limited to what bb's bridges already do, i.e. you would keep using them via bb or fork the
bridges. Ranges are my judgment, calibrated on Ultimate's 80k lines and bb's size, not measured.

| Capability needed to match daily bb use | Reuse source | Effort to first usable | Effort to bb-grade |
|---|---|---|---|
| Machines and host daemons (run agents on other boxes, over Tailscale) | bb apps/host-daemon (26k) and host-daemon-contract; Ultimate multi-instance | 1 to 2 weeks (fork or thin SSH/Tailscale runner) | 4 to 6 weeks (reconnect, versions, permissions) |
| Threads and event log (store, replay, timeline, queueing, restart-resume) | pi sessions + durable; bb packages/db and thread-view for UI semantics | 1 to 2 weeks | 3 to 5 weeks |
| Worktrees and environments | bb environment-git-worktree plugin; Ultimate workspaces extension (lander, 1k+ lines) | 1 week | 2 to 3 weeks |
| Plugin system (panels, CLI, tools, hooks, providers) | pi extensions + Ultimate's tiering; bb plugin-sdk if forking bb | 1 to 3 weeks (reuse pi's) | 8 to 16 weeks if you want bb's SDK contract, registry and hot reload |
| UI (timeline, composer, diff, panels, search) | Ultimate web (9k + extension web), bb apps/app (236k, too big to adopt wholesale) | 3 to 5 weeks | 8 to 14 weeks |
| Mobile access | Responsive web over Tailscale | 1 week | bb's Expo app is 15k lines; native parity 6 to 10 weeks |
| CLI control of threads | pi RPC, Ultimate bin/cli, bb apps/cli (20k) | 1 week | 2 to 3 weeks |
| Context composer on top | Part of the above, new code | 2 to 4 weeks | 4 to 8 weeks |
| Providers other than pi (Claude Code, Codex, ACP) | bb provider bridges (MIT) or pi-claude-code | 1 to 2 weeks each | ongoing; vendor changes break them |
| **Total, working alone** | | **about 6 to 12 weeks** | **about 4 to 8 months** |
| Maintenance afterwards | pi, durable and omp all move weekly | 0.5 to 1 day per week | |

Alternative baseline: fork bb wholesale (route b). Cost is mostly learning and carrying 860k lines
that move 36 commits a day; rebasing onto upstream gets harder every week. A fork that adds a
`pi-full` provider and a composer panel is the same work as option (a) below but with all of
upstream's merge burden. I would not fork the host; fork single plugins.

Ultimate as architecture reference: forest of conversation trees, coordinator + subagents, one
worktree per branch, lander agent, supervisor that holds the port for hot reload, `note` versus
turn messages, side chats, extensions with a tiered core and `server.ts`/`web.tsx`/`api.ts` split
(AGENTS.md "Layers and how they reload"). It is also a warning: the author says "at your own risk",
and it depends on Pi Durable, which declares itself experimental.

## 5. Hybrid paths

### (a) bb provider plugin wrapping pi, composer on pi hooks, panel in bb

Shape: copy `plugins/provider-pi` (MIT, listed in scripts/forkable-plugins.json, so it builds
outside the monorepo with only published `@get-bb/plugin-sdk`) as a new provider id, for example
`pi-composed`. Its `deriveProviderOptions` turns the composition manifest into `--skill`,
`--no-skills`, `--no-mcp`, `--exclude-tools`, `--extension` arguments for the spawned
`pi --mode rpc`. A pi extension (the composer runtime) logs the real system prompt, tools and
provider payload from `before_agent_start`/`context_with_system`/`before_provider_request` back
over the bridge for the panel. The panel is a thread tab like agent-artifacts (1,270 lines app.tsx).
Spawn uses `threads.spawn` with `pluginMetadata`.
- Cost: 3 to 6 weeks to a working version. 
- Gain: exact inventory and subtractive control for pi threads, everything else in bb unchanged.
- Limits: only pi threads are composable; bb pins pi 0.84.0 so you upgrade the fork; `experimental_`
  APIs may change; bb process-start semantics (tools apply at session start).
- Cheaper variant with no fork: put the composer pi extension in `~/.pi/agent/extensions`; bb's
  provider spawns plain `pi`, so user extensions load [inferred from the arg list in
  rpc-session.ts:266 to 295, which does not pass `--no-extensions`]. Feed it a manifest through
  `experimental_contributeEnv` or a file. Needs a spike to confirm the env reaches the child.

### (b) Standalone composer service for bb and a future harness

A small service (or library plus CLI) that holds the composition model: sources, inventory,
manifests, diffing, the prediction side chat, and "compile" targets. Adapters:
bb plugin (UI and spawn), pi extension (live truth and enforcement), Claude Code (read-only probe,
as agent-artifacts already does, and write via generated settings for new sessions).
- Cost: library 2 to 3 weeks; each adapter 1 to 2 weeks.
- Gain: the same work serves bb now and your own harness later.
- Limit: for Claude Code and Codex it can compose only what their config files allow at
  session start.

### (c) Own harness

See section 4. Takes the composer out of "what the host permits" entirely, but is the only option that
costs months.

### What carries over (build once)

| Piece | Where it lives | Reused by (a) | (b) | (c) |
|---|---|---|---|---|
| Composition model (types: source, artifact, manifest, diff, compile) | pure core package, no host imports | yes | yes | yes |
| Inventory readers (CLAUDE.md, AGENTS.md, skills, MCP configs, hooks) | core, adapted from agent-artifacts `lib/inventory.ts` and `lib/claude.ts` (pure, tested) | yes | yes | yes |
| Prediction side chat (prompt, evaluation loop) | core + provider-agnostic LLM call | yes | yes | yes |
| Pi adapter (extension + SDK/CLI arg compiler) | adapter | yes | yes | yes, becomes the native path |
| bb adapter (panel, `threads.spawn`, metadata, CLI) | adapter | yes | yes | no |
| Own UI and runtime | harness | no | no | yes |

This matches the pattern you already use in bbim (a core with no host imports plus thin adapters).
The decision rule: whatever is host-independent goes into the core; anything that imports
`@get-bb/plugin-sdk` or `@earendil-works/pi-coding-agent` goes in an adapter.

## Options compared

| | (a) bb + pi-composed provider | (b) standalone composer | (c) own harness | Fork bb whole |
|---|---|---|---|---|
| Composer completeness | Full on pi threads, additive elsewhere | Depends on adapters | Full | Full on pi, same as (a) |
| First usable | 3 to 6 weeks | 2 to 3 weeks (library) + adapter | 6 to 12 weeks | 3 to 6 weeks + merge burden |
| Parity with daily bb | Already there | Already there | 4 to 8 months | Already there |
| Ongoing cost | Pi version bump, bb API drift | Adapter upkeep | Everything | Upstream rebase (36 commits/day) |
| Risk | Medium (experimental SDK parts) | Low | High (Pi Durable experimental, solo maintenance) | High |
| Reversible | Yes | Yes | Hard | Hard |

## My read

- The composer is the new idea; the harness is a means. Build the composer core and pi adapter
  first (path b-core), because that is the same code in every future.
- Ship it through (a): a fork of `provider-pi` plus a thread panel. That gives you exact inventory
  and subtraction on pi threads, and the bb plugin SDK already gives you panel, CLI, spawn, side-chat
  and the whole rest of the workbench you use. 3 to 6 weeks, reversible.
- Decide on (c) after that. The signal to build it is a concrete bb limit that blocks the composer
  on a real thread: for instance wanting per-turn context edits while a thread runs, or composing
  Claude Code threads, or needing durable multi-conversation behaviour. Ultimate is proof that (c) is
  reachable (80k lines), but it is a few months of ownership, and it moves under pi's experimental
  durable layer.
- "Slowing bb" is not a reason to leave. It is a reason to keep your assets portable, which the
  core-plus-adapters split does.
- Subscription terms still matter. Running Claude through pi on an OAuth token is the grey zone
  from the prior doc; the composer on pi should target API keys or Codex login, and keep Claude
  subscription use in the real `claude-code` provider.

## Open questions

- Does `provider-pi` forward env contributed by `experimental_contributeEnv` to the pi child
  (`buildPiChildEnv`, rpc-session.ts)? This decides whether the no-fork variant works.
- Does bb's bridge protocol allow a provider to push arbitrary payloads back to the panel
  (the composer's "what was actually sent" log)? `extensionKinds` and `extension.state` look
  designed for it (provider-plugin-api.md), unverified.
- Can a fork run pi 1.4.0 given the bb extension imports pi modules (pinned 0.84.0)?
- Would bb accept a PR that adds a per-thread skill and MCP selector? The team is small and
  active, and "bb-slop-cop" and Codex author commits, so an upstream contribution might be cheaper
  than a fork. Not asked.
- How much of Claude Code's real payload can the Agent SDK probe expose (system prompt text,
  skill listing)? The existing probe returns init, agents, MCP status and context usage only.
- Is a prediction side chat actually good enough to steer? That is a product question, not
  a platform one; worth a prototype on exported pi sessions before choosing a host.

## What I could not verify

- Ultimate's real build time (history starts 2026-10-19; may be squashed or re-initialised).
- T3 Code's 3.3M-line figure: probably includes generated or vendored files; I did not audit it.
- Effort ranges are estimates from line counts and one comparable project, not measured.
- Whether the bb panel can display pi payloads live with acceptable overhead.
- Real-time behaviour of `agents.configure` on a running pi session (the doc says tools apply at
  next session start, so mid-thread composition needs the pi-side extension).
- bb's pre-release (nightly) policy and whether APIs marked `experimental_` are stable; see
  docs/api_to_audit.md in the bb repo (not read in full).
- The npm tarball's missing licence field: I did not check older versions or ask the maintainers
  whether it is intentional.
- Legal conclusions are a summary of plain MIT terms, not advice.

## Sources

- bb repo (clone at /tmp/rs/bb, commit 5e1acd765): LICENSE, package.json, docs/provider-plugin-api.md,
  docs/forkable-plugins.md, docs/repository-overview.md, scripts/forkable-plugins.json,
  plugins/provider-pi/{PLUGIN_OVERVIEW.md,src/bridge/rpc-session.ts,package.json},
  plugins/provider-claude-code/src/bridge/sdk-session.ts.
- npm: `npm view bb-app time --json`, `npm view bb-app license repository`.
- shared-server, read only: ~/.local/lib/node_modules/bb-app/package.json (0.46.1), directory listing.
- GitHub API: repo metadata for get-bb/bb, pingdotgg/t3code, earendil-works/pi, can1357/oh-my-pi, HazAT/ultimate;
  PR search counts; contributors.
- Plugin SDK types: /Users/popemkt/.dotfiles/.claude/worktrees/agent-a6d21bbdef21dbbc4/assets/bb-plugins/bbim/node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk.d.ts
  (lines 22883 to 23060, 23410 to 23520, 23595 to 23940, 12802 to 13251, 21431).
- Pi docs: packages/coding-agent/docs/{extensions.md,sdk.md,cli.md,rpc-commands.md,session-format.md},
  packages/durable/README.md, examples/sdk/04-skills.ts.
- omp README (via `gh api repos/can1357/oh-my-pi/readme`); Ultimate AGENTS.md and README.
- agent-artifacts plugin: /Users/popemkt/.dotfiles/assets/bb-plugins/agent-artifacts/{README.md,host.ts,lib/}.
- Prior research on branch docs/research-pi: docs/research/2026-10-24-bb-vs-pi-omp-harness.md and
  2026-10-24-t3code-restart-research.md (T3 only used for the package list here).
