# Context composer v1: design, levers per provider, spikes

Date: 2026-10-25. Builds on [2026-10-24-own-harness-and-context-composer.md](2026-10-24-own-harness-and-context-composer.md)
(its recommendation: a pure composer core plus thin bb and pi adapters). Claims are tagged **[measured]** (run here),
**[code]** (read in source), **[doc]** or **[unverified]**. bb source is upstream `get-bb/bb` main `86be007`
(2026-10-24); the installed bb is 0.46.1 on shared-server and 0.47.0 in the Mac app; plugin SDK types 0.6.49.
Nothing was installed on shared-server; pi 1.4.0 was already installed on the Mac.

v1 is an experiment. The code is `assets/bb-plugins/context-composer`.

## 1. What v1 is

The owner's idea: know everything that feeds an agent, compose it (take away skills, MCP servers, any artifact from
the agent-artifacts inventory), ask a small chat what a context does to the thread's trajectory and what to change
for a trajectory Y, then start agents with the composed context.

v1 ships:

1. **A composition model as data** (`core/`, no host imports, enforced by a test). Sources, artifacts (instruction,
   memory, skill, mcp-server, tool, hook, subagent, output-style, plus `system` and `conversation`, which no lever
   removes), each with an origin, a token weight (`reported` or `estimated`), active or not, deferred or not. A
   **manifest** stores only departures from the composition (exclude an active artifact, include an inactive one)
   plus added instruction text. `diff`, `totals`, `decideSource`.
2. **Compile targets** (`core/targets.ts`): bb Claude Code, bb Codex, bb pi, other bb providers, the `claude` CLI,
   the `codex` CLI. Each target owns its levers; `compile()` returns the env, arguments and instruction text, and
   labels every change `enforced`, `advisory` or `none`.
3. **Views over one model**: a list (by source or by kind) and a squarified treemap of token weight, both reading
   `weightTree()`; a kb export (`core/kb.ts`) so kb's outline, graph and canvas views render the same data. A new view
   is a renderer registered in `views/index.ts`.
4. **The bb adapter** (`server.ts`, `app.tsx`, `adapter/`): a **Context composer page** of its own (a nav panel,
   not tied to a thread) with the views, a plan card per target, added instructions, a spawn form and the trajectory
   chat; a **Compose context** thread-panel action that is only a shortcut into the page; `bb composer` for agents.
5. **Trajectory side chat**: a hidden advisor thread on the basis thread's provider, briefed with the composition,
   the manifest, the levers and the thread's last 12 messages. It answers with `composer-proposal` JSON blocks; an
   **Apply proposal** action on its messages applies one with one click.
6. **The pi adapter's first slice** (`pi/extension.ts`, experimental): enforces skills, tools, context files and MCP
   servers inside pi and writes a report of what pi really sends.

Evidence: a static render of `core/` over a real composition of this thread (350 artifacts, 33 sources) is at
`.kb/assets/overnight/2026-10-25/context-composer/treemap-preview.png`, with the kb outline it exports beside it. The
conversation (89k tokens) dwarfs every artifact; at session start the heaviest removable things are the project
CLAUDE.md files and the skill listing.

### Rule 1: a new plugin, reading agent-artifacts through its RPC

The concept agent-artifacts owns is the **inventory** (what is). The composer's concept is the **composition**
(what should be, and how a host can be made to honour it). Folding the composer into agent-artifacts would make one
plugin own two concepts, and it would collide with the owner's uncommitted agent-artifacts work. A separate plugin
that re-read bb's state would be a second inventory (a mirror). So: a new plugin, and its only way in is
agent-artifacts' `inventory` and `claude` RPC methods (`bb.sdk.plugins.callRpc`), mapped by `adapter/inventory.ts`.
Types come in with `import type` only, so nothing is bundled twice.

**Overlap with the uncommitted agent-artifacts work** (`lib/cache.ts`, `lib/signals.ts`, edits): it renames the
Claude env item field `secret` to `masked`, merges permission and hook arrays across settings layers, changes
`reachesAgent`, and adds realtime signals. The composer reads none of the env items, and the rest changes values, not
shapes it depends on, so it merges cleanly. Once that work lands, the composer could subscribe to its
`INVENTORY_CHANNEL` signal to refresh instead of polling.

## 2. Levers per provider: what is honoured

`enforced` = the host removes or adds it. `advisory` = the agent is told, the artifact stays loaded. `none` = no lever.

| Change | bb Claude Code | bb Codex | bb pi | bb other (ACP) | `claude` CLI | `codex` CLI |
|---|---|---|---|---|---|---|
| Add instruction text | enforced (`agents.configure`, appended, max 4096 chars) | enforced (developer instructions) | enforced | enforced | enforced (`--append-system-prompt`) | prepended to the prompt |
| Drop all CLAUDE.md + MEMORY.md | enforced, `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` [measured] | n/a | n/a | n/a | enforced (env) | n/a |
| Drop auto memory only | enforced, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` [measured] | advisory | advisory | advisory | enforced | advisory |
| Drop bundled skills | enforced, `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1` [measured] | advisory | n/a | advisory | enforced | advisory |
| Drop everything the provider loads | enforced*, `CLAUDE_CODE_SAFE_MODE=1` [measured outside bb] | advisory | n/a | advisory | enforced | `CODEX_HOME` (see 4) |
| Drop one skill, MCP server, hook, subagent | advisory | advisory | enforced* (pi extension) | advisory | MCP: `--disallowedTools mcp__<server>` enforced; subagent `Agent(name)`* | MCP: `-c mcp_servers.<n>.enabled=false`* |
| Drop one instruction file | advisory | advisory | enforced* (context files) | advisory | advisory | all AGENTS.md: `-c project_doc_max_bytes=0`* |
| Drop a bb plugin's tool or skill | advisory | advisory | enforced* (tools by name) | advisory | n/a | n/a |
| Drop bb's own AGENTS.md | advisory | advisory | advisory | advisory | n/a | n/a |
| Conversation | a fresh spawn drops it, a fork keeps it | same | same | same | n/a | n/a |

`*` experimental: measured outside bb, or read in source only. The table is the data in `core/targets.ts`; the tests
pin it. Group switches apply only when every member of the group is excluded; otherwise the members fall back to
advisory, so a switch never removes something the manifest keeps.

How the bb levers reach the agent:
- **Instructions**: `agents.configure` reads the spawned thread's `pluginMetadata` (the compiled text). Applied at
  session start, appended, truncated by bb at 4096 characters; `compile()` summarises names to stay under it.
- **Env**: `bb.providers.experimental_contributeEnv("claude-code" | "pi", resolver)`. The resolver gets the thread id,
  reads the thread's own record and passes on only the env names the record's target compiles. Metadata is writable by
  anyone, including the thread's agent, so a forged `ANTHROPIC_BASE_URL` in it is dropped (tested). [code: contributed
  env is merged into the claude child's env (`provider-claude-code` bridge.ts:1725-1744), re-resolved per command, and
  a changed set rebuilds the session (1752-1777).]
- **Codex gets no env**: contributed env does not reach Codex's app server; it only becomes
  `shell_environment_policy.set.*` for commands the model runs [code: provider-codex session-params.ts:618-628,
  bridge.ts:390-403]. Every Codex drop is advisory until there is a forked provider.

## 3. Spikes

### 3.1 Does provider-pi forward `experimental_contributeEnv` to the pi child? Yes [code], not run in bb.

Path on bb main: the runtime resolves contributed env into `resolvedEnvironment.envVars` (packages/agent-runtime
runtime.ts:1555-1590) → provider execution context `envVars` → provider-pi `buildPiSessionParams` puts
`buildShellEnvOverrides(envVars)` into `shellEnvOverrides` (session-params.ts:66-76; the only filter is a valid shell
name) → `buildPiChildEnv({...shellEnvOverrides, PI_BB_TOOLS_FILE})` is the child's env (rpc-session.ts:299-302,
rpc-child.ts:100-110). `BB_THREAD_ID` is set the same way, so a pi extension knows its thread. A changed env set is
compared at bridge.ts:1000-1006 and relaunches the child. The argument list passes `--extension <bb's>` and `--skill`
paths but never `--no-extensions`, so user extensions in `~/.pi/agent/extensions` load. Not checked against 0.46.1,
and no pi thread was started in bb (none may be spawned tonight; pi is not installed on shared-server).

### 3.2 Can a pi extension push the real system prompt and payload back to a panel? Yes [measured], via a file.

Measured on the Mac with pi 1.4.0, outside bb, an invalid API key so no tokens were spent, `PI_CODING_AGENT_DIR`
pointed at a scratch dir so the owner's auth was not touched:
- `before_agent_start` sees `systemPromptOptions` (keys: customPrompt, forceSystemPrompt, selectedTools, hiddenTools,
  toolSnippets, toolGuidelines, promptGuidelines, appendSystemPrompt, sections, cwd, contextFiles, skills),
  `ctx.getSystemPrompt()`, `pi.getActiveTools()` and `pi.getAllTools()`, and the env (`BB_THREAD_ID` included).
- `before_provider_request` sees the exact serialized payload: keys model, messages, max_tokens, stream, betas,
  system, tools, thinking; 43.6 KB for "say hi" with the owner's 104 skills listed.
- Subtraction works: filtering `systemPromptOptions.skills` to one and `pi.setActiveTools(["read"])` cut the payload
  from 43.6 KB to 4.0 KB, with one skill and one tool left [measured].

So `pi/extension.ts` enforces a manifest and writes `~/.pi/agent/composer-reports/<BB_THREAD_ID>.json` per request.
Getting it to the panel: a `bb.host` entry in the plugin reads the report on the workspace's host (the same pattern as
agent-artifacts' Claude probe). The bridge's own channel (`extension.state`, `extensionKinds`) belongs to bb's provider
extension and is not open to a user extension [code]; a forked provider-pi could forward reports over it live.
First run of the unchanged pi CLI tried to refresh a stored Anthropic OAuth credential in `~/.pi/agent/auth.json`
when given an API key; it failed harmlessly, and later runs used a scratch agent dir.

### 3.3 What can be subtracted for Claude Code and Codex? Section 2, plus a clean session in section 4.

Measured with Claude Code 2.1.310 through the Agent SDK, a session that never gets a prompt (no model call), in this
worktree; startup context in tokens (MCP tool weight is deferred and not in the total):

| Env | Total | Memory files | Skills | Subagents | MCP servers |
|---|---|---|---|---|---|
| none | 26,190 | 4 (user CLAUDE.md, RTK.md, project CLAUDE.md, MEMORY.md) | 154 | 14 | 11 |
| `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` | 18,024 | 0 | 154 | 14 | 11 |
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` | 25,617 | 3 (no MEMORY.md) | 154 | 14 | 11 |
| `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1` | n/a | 4 | 143 | 14 | 11 |
| `CLAUDE_CODE_SAFE_MODE=1` | 15,025 | 0 | 13 built-in | 0 | 0 |
| `ENABLE_CLAUDEAI_MCP_SERVERS=false` | 26,238 | 4 | 154 | 14 | 11 (inconclusive: none of the 11 may be claude.ai) |

Whether safe mode also drops bb's injected skill plugin and its in-process `bb-bridge` MCP server (both passed as SDK
options, not settings) is **unverified**; if it does, a safe-mode thread loses bb's own tools. That is why the
safe-mode lever is marked experimental.

## 4. Spawning from a composed context

**What v1 does**: `threads.spawn` in the basis thread's environment (`{ type: "reuse" }`), on the provider and
model the person picks, with `pluginMetadata` holding the compiled record (manifest id and title, target, compiled
instructions, compiled env, ids dropped and added). `agents.configure` and the env resolvers read that record; the
lineage list on the page reads it back with `threads.list({ originPluginId })` and
`experimental_listPluginMetadata`. The thread starts without the basis thread's conversation.

**A truly clean Claude Code session** (only what is injected) needs options a bb plugin cannot pass:
- Agent SDK `settingSources: []` (no user, project or local settings; CLAUDE.md needs `"project"`), `strictMcpConfig`
  with `mcpServers`, `tools` / `disallowedTools`, `skills`, `plugins`, `systemPrompt` as a plain string; CLI
  equivalents `--setting-sources`, `--strict-mcp-config --mcp-config`, `--tools`, `--disallowedTools`,
  `--disable-slash-commands`, `--system-prompt`, `--plugin-dir`, `--safe-mode`, `--bare` (API-key auth only).
- bb's Claude bridge hard-codes `settingSources: ["user","project","local"]` (provider-claude-code
  sdk-session.ts:264), passes only its own `bb-bridge` MCP server and `allowedTools`, and core forces
  `instructionMode: "append"` (thread-runtime-config.ts:288) [code]. `providerOptions` come only from the provider's
  own `deriveProviderOptions`; `sessionOptions` are ignored by Claude.
- Reachable from a plugin today: env only (section 2). `CLAUDE_CONFIG_DIR` also reaches the child, which could point a
  thread at a generated config dir (only the chosen skills, settings, MCP servers); but a macOS keychain login is
  probably keyed per config dir, bb's own skill filter reads the bridge's env not the child's, and resume looks in the
  config dir [unverified]. Not used in v1.
- **Needs a small custom provider**: a fork of `provider-claude-code` (listed in bb's `scripts/forkable-plugins.json`;
  builds with only the published SDK) with a new provider id that sets `settingSources`, `strictMcpConfig`,
  `disallowedTools` and `skills` from its own `deriveProviderOptions`, fed by the manifest. A gap node records it.

**A clean Codex session**: profiles (`-p` loads `$CODEX_HOME/<name>.config.toml`), `-c key=value`
(`mcp_servers.<n>.enabled`, `features.*`, `project_doc_max_bytes`, `skills.config` entries with a name selector) and a
clean `CODEX_HOME` (drops `~/.codex/AGENTS.md`, skills, MCP config). A fresh `CODEX_HOME` has no login until
`auth.json` is copied or an API key is set. bb passes Codex no plugin env or `-c` flags beyond its own [code], so it
also needs a forked `provider-codex`. Key effects come from binary strings, not runs [unverified].

**What other bb orchestration plugins do** (checked so the composer reuses a mechanism, not invents one):

| Plugin | Spawn | Controlled context |
|---|---|---|
| workflows (built in) | `threads.spawn` hidden, `pluginMetadata`, `environment: reuse` (service.ts:949-967) | `agents.configure` keyed on its metadata: its own tool, `skills: []`, short instructions. Closest to a blank slate a plugin can make, and the pattern v1 follows |
| crew (sajov/bb-plugins) | `threads.spawn` with metadata and `executionInputSources: explicit` (thread-port.ts:285-310) | `configure` maps metadata to a member's tools and 4 KB of instructions |
| graph-studio (sajov) | `threads.spawn` visible, `environment: reuse` (server.ts:811-830) | none: foreign skills are only named in the prompt (its README says plugins can only configure their own) |
| side-chat (built in) | `threads.fork` hidden with an agent-only `agentContextSeed` (server.ts:112-139) | the forked conversation plus a seed; the advisor here spawns instead, so the brief is the whole context |
| lanes (grrowl/bb-lanes) | never spawns; a monitor | n/a |

None starts from a true blank slate; all are additive. The composer uses workflows' and crew's mechanism
(metadata + `configure` + explicit execution inputs) and adds contributed env.

## 5. Surfaces: a page of its own

SDK 0.6.49 offers `navPanel` (a sidebar page at `/plugins/<id>/<path>/*`, props `{ subPath }`), `fixedTabs` on a nav
page, `homepageSection`, sidebar footer actions, and `experimental_appOverlay`; there are no separate windows. The
composer is a `navPanel` ("Context composer"); `thread/<threadId>[/<manifestId>]` deep-links a composition. The
thread-panel action **Compose context** shows the heaviest artifacts and opens the page
(`useBbNavigate().toPluginPanel`). Upstream main replaces `threadPanelAction` and fixed tabs with `experimental_tab`
(not in 0.6.49); the old slots still load on 0.47 with a warning, so a later SDK bump will touch this.

## 6. Storage

| Data | Store | Why |
|---|---|---|
| Which thread came from which composition | the spawned thread's **plugin metadata** | It is also what `agents.configure` and the env resolvers read at session start, so one record serves the agent and the lineage list; it lives and dies with the thread; queryable by `threads.list({ originPluginId })` + `experimental_listPluginMetadata`. 256 KiB per namespace. Untrusted, so parsed field by field. |
| Saved manifests | the plugin's **SQLite** (`bb.storage.database()`, `<dataDir>/plugins/context-composer/data.db` on the bb server) | Durable, server-side (one copy, whatever machine the browser or daemon is on), SQL-queryable, migrated append-only. KV (256 KB values, prefix list) would also do, but SQL keeps "manifests by basis or date" a query. |
| The open advisor thread per basis thread | plugin **KV** | A pointer, one key per basis thread. |
| Durable, visual, versioned copy | **kb**, by export | kb is the owner's viz engine and its store is a git-tracked file; the export is the sync format (section 7). |

Not chosen: `thread-storage` (bb's per-thread files, not a plugin API for structured data); host-entry data dirs
(`~/.bb/plugins/<id>/host-data` on each daemon: per machine, so a manifest saved on one would be invisible on another);
kb as the primary store (needs kb reachable from the bb server and a schema-stable kb; export first, see section 7).

Backup: nothing backs up `~/.bb` today. `docs/backup-strategy.md` puts agent state under regular backup (Time Machine
on the Mac), and shared-server, which runs the bb server and so holds `data.db`, has no backup declared (restic is
only planned). Saved manifests on shared-server are therefore not backed up; the kb export is the way to keep one. A
gap node records it.

## 7. kb: render the composition, and whether to import kb's view libraries

**Export (shipped)**: `core/kb.ts` emits a Tana-Paste outline (one `#ctx-composition` node, `#ctx-source` nodes, one
`#ctx-artifact` node per artifact with fields `ctx-kind`, `ctx-tokens` (number), `ctx-source-of` (ref to its source),
`ctx-decision`, `ctx-lever`) and the idempotent schema commands (`kb tag define`, `kb field define/type/target`).
Tags and fields are never minted implicitly by `kb add --outline`, hence the commands. The page's **Copy for kb** and
`bb composer --kb` produce both; paste into `kb add --outline` (or `kb --root <scratch>` for a separate store). Every
ref resolves to a source item in the same outline (tested). kb's outline, graph and canvas views then apply as they
do to any node.

Re-exporting appends (`node.addTree` has no replace), so a re-export makes a second composition node: version by
title for now.

**Importing kb's views into the composer**: feasible but not sensible yet.
- What kb exports today: nothing publishable. Every package is `private: true`, ships raw TypeScript
  (`exports: "./src/index.ts"`), uses `catalog:`/`workspace:` versions; kb ships only as a CLI release. The view
  packages are `extension/graph-ui` (sigma + graphology + ForceAtlas2 in a worker; 3D via three.js through
  `kit/scene-gpu`, WebGPU and WebGL), `canvas-ui` (three), `outline-ui`, `code-ui` (quickjs), all on React 19 and
  kb's plugin kernel.
- The view contract is clean (`Component({ params, host: ViewHost })`, never a store), but `ui-sdk` pulls in
  `@kb/query`, contracts, plugin and sandbox, and views read through a kb runtime or server.
- Cost: a standalone 2D graph fed from an in-memory `{nodes, edges}` adapter, about 1 to 2 weeks; full graph or
  canvas through the kernel, 3 to 5 weeks (publishing the closure, bundling TS, effect's RC pin). Blockers: bundle size
  (sigma, three, quickjs, effect), CSS tokens colliding with bb's Tailwind, one React and one three instance, no
  stability contract while kb fast-forwards. It is a kb-repo change under kb's AGENTS.md.
- **Recommendation**: v1 exports to kb; the composer keeps its own light views (list, treemap) over `core/views.ts`.
  The cheap next step for a live graph is to show the exported nodes in the kb tab bb already frames (the kb plugin's
  `ui.navigate` to the composition node). Package kb's 2D graph only when a composer view needs live interaction kb's
  tab cannot give, and do it as a kb project with its own contract tests. Both, once the outline schema has settled:
  the export is then the single exchange format any embedded view reads.

## 8. What to watch for (v1 as an experiment)

- **Does advisory text steer?** Watch spawned threads for use of "unavailable" skills and MCP servers. If they use them
  anyway, advisory drops are noise and only enforced levers matter.
- **Does the trajectory chat help?** Count proposals applied versus ignored, and whether a composed thread's first
  turns go where the advisor said. The brief is about 15k tokens for this thread (61k characters); trim descriptions
  if the advisor's answers get generic.
- **Safe mode in bb**: does a `CLAUDE_CODE_SAFE_MODE=1` thread keep bb's tools? If not, never offer it without a
  warning.
- **Weights**: MCP tools are deferred behind tool search, so they weigh 0 at session start and their full weight is
  shown "on demand"; bb's plugin tools and bb's own skills are size estimates. Check them against the provider's
  context breakdown after a few composed threads.
- **API drift**: `experimental_contributeEnv`, `experimental_listPluginMetadata` and the `threadPanelAction` slot are
  experimental or being replaced upstream (`experimental_tab`).

Not run end to end tonight: the page in a live bb, a spawn, the advisor thread, and the env reaching a real thread.
The server was driven in bb's fake plugin host (`@get-bb/plugin-sdk/testing`): compose, spawn arguments and record,
`agents.configure`, the env resolvers, the advisor's spawn and resume, `bb composer` (tests/server.test.ts).

## 9. Next steps toward the pi adapter

1. Install `pi` on one machine bb drives (the Mac), link `pi/extension.ts` into `~/.pi/agent/extensions`, spawn a pi
   thread from a composition, and confirm `PI_COMPOSER_MANIFEST` and `BB_THREAD_ID` arrive (spike 3.1 end to end).
2. Add a `bb.host` entry that reads `~/.pi/agent/composer-reports/<threadId>.json` on the workspace's host, and show
   "what pi actually sent" beside the composition: the exact inventory replaces the reconstruction for pi threads.
3. Composition from the pi report itself: an adapter `adapter/pi.ts` that builds a composition from the extension's
   report (skills, tools, context files, payload bytes), the second implementation of the same model; then one
   contract test suite over both adapters.
4. Fork `provider-pi` (MIT, forkable) only when a live channel is needed (per-turn edits from the panel, reports over
   the bridge instead of a file), and bump its pinned pi 0.84.0 to 1.4.0 there.
5. In parallel, decide the forked `provider-claude-code` (section 4) once advisory drops prove insufficient.

## Gaps recorded in kb

- Per-item removal on bb Claude Code and Codex threads needs forked providers (settingSources, strictMcpConfig,
  disallowedTools; Codex `-c` and `CODEX_HOME`).
- The bb server's plugin data (saved manifests) has no backup on shared-server.
- Composer v1 has not run in a live bb (page, spawn, advisor, env on a real thread).
- pi enforcement is unproven inside bb (extension not installed; pi not on shared-server).
