# Research: a "Projects" layer for the owner's agent setup (bb + kb + Cognee + skl)

Date: 2026-10-24. Claims are tagged **[doc]** (read in a primary source this session), **[observed]**
(ran or read locally), **[inferred]** (my reading) or **[unverified]**.
Nothing in /Users/popemkt/.dotfiles was changed.

## 1. Summary

1. Anthropic ships TWO different things called Projects, and the quote in the brief mixes them.
   - **claude.ai chat Projects**: knowledge files with automatic RAG, per-project instructions,
     per-project memory, and RAG chat search that is scoped to the project. This is the "very good RAG on
     top of related threads" the owner means.
   - **Claude Code Projects** (public beta, Pro and Max only, cloud sessions): one coordinator conversation
     that starts parallel threads, with project instructions (16,000 chars), project memory (MEMORY.md plus
     topic files), a Library of files, and scheduled tasks (the renamed "routines") attached to the project.
     I found NO documented RAG or semantic search over a project's threads there. The coordinator "works
     from recent messages, recent threads, and project memory".
2. bb's "project" is a repository, not a topic grouping [observed: `bb guide` says "Project - maps to a
   repository. All threads belong to a project"]. There is no cross-repo grouping, no project instructions
   and no project memory in bb core. A Claude-style project is therefore a new layer, not a rename.
3. Nearly every building block exists: bb thread search and thread events, per-thread injection via
   `bb.agents.configure`, mention providers, bb automations (scoped to a bb project), kb for curated
   structured notes, Cognee for semantic/graph recall, skl for session search. What is missing is the
   grouping itself and a per-project index.
4. Recommended MVP: a **kb node per project as the registry** plus a small **bb plugin** that injects the
   project's instructions and a `project_recall` tool into member threads, with recall federated over bb
   thread search, Cognee (one dataset per project) and kb. Defer an own vector index until recall quality
   is the proven bottleneck. Details in section 6.

## 2. What Anthropic actually offers

### 2a. claude.ai chat Projects

| Feature | What is documented | Source |
|---|---|---|
| Project knowledge | Upload documents, text, code or other files; used as context for chats in the project [doc] | https://support.claude.com/en/articles/9517075-what-are-projects |
| Size limits | The article gives NO numeric limit. It says that when knowledge "approaches context limits" paid plans switch to RAG [doc] | same |
| RAG mode | Automatic on paid plans (Pro, Max, Team, Enterprise); "expand your project's capacity by up to 10x while maintaining quality responses"; Claude calls a "project knowledge search tool"; below the threshold the whole library stays in context [doc] | https://support.claude.com/en/articles/11473015-retrieval-augmented-generation-rag-for-projects |
| Re-sync | A third-party vendor says project RAG only takes manual uploads and does not follow changed sources [unverified, third party] | https://context-link.ai/blog/rag-for-claude (via search snippet) |
| Project instructions | Per-project instructions shape responses (tone, role, perspective) [doc] | https://support.claude.com/en/articles/9517075-what-are-projects |
| Project-scoped memory | "Each project has its own memory." Claude does not use memory from other projects; it can draw on non-project account memory unless "Use account memory" is turned off on the project page [doc] | https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context |
| Search across a project's chats | Past-chat search "uses Retrieval-Augmented Generation (RAG) and will appear as tool calls". Project chats are searched only inside their own project; paid plans only [doc] | same |
| Incognito | Incognito chats are not saved to history or memory and are not retrievable by search [doc] | same |
| Sharing | Team and Enterprise only; "Can view" and "Can edit"; org-wide or per person [doc] | https://support.claude.com/en/articles/9517075-what-are-projects |

### 2b. Claude Code Projects (public beta) [doc: https://code.claude.com/docs/en/claude-projects]

- Status: public beta on Pro and Max, rolling out gradually; not on Team or Enterprise yet.
- Shape: one long-running coordinator conversation plus threads. Each thread is usually a cloud session
  (can be sent to your own computer via Remote Control). A thread belongs to exactly one project and
  cannot be moved; a local session cannot be added to a project; a project belongs to one user and cannot
  be shared; no org controls in the beta.
- Project instructions: sent to each new thread and to the coordinator, up to 16,000 characters.
- Project memory: files with a `MEMORY.md` index; every cloud thread reads the index at start and opens
  topic files on demand; Claude writes them itself ("Auto memory" in settings); you can read, edit, delete
  them. Explicitly separate from the local auto memory and from repo CLAUDE.md files.
- Files: Library tab, up to 100 files and 2 GB in one pick, single file up to 480 MB, folders copy the
  first 100 files up to 200 MB, max 10 folders and Drive folders; uploads are copies and do not sync.
- Context handling: "the conversation works from recent messages, recent threads, and project memory
  rather than its full history". So long-horizon recall is by memory notes, not by retrieval over
  transcripts.
- What threads load from a repo: CLAUDE.md and `.claude/rules/` at the root only; NOT skills, agents,
  `.mcp.json`, hooks or `.claude/settings.json`. Connectors come from the claude.ai account.
- Scheduled tasks inside a project appear on its Scheduled tasks tab and run as threads in that project.
- Limits: 200 new threads per day across projects; usage shares the plan limits; new projects default to
  Opus at high effort for threads.

### 2c. Scheduled tasks (formerly "routines") [doc: https://code.claude.com/docs/en/web-scheduled-tasks]

Research preview. A saved prompt plus repositories plus connectors, run on Anthropic cloud with triggers:
schedule (min interval 1 hour, custom cron), API (`/fire` endpoint under the
`experimental-cc-routine-2026-04-01` beta header, bearer token, optional `text` payload wrapped as untrusted
data) and GitHub events (pull request, release). Runs are full sessions. Limits: 100 scheduled runs an hour
per account, 30 manual or API fires an hour per task. Local alternatives: Desktop scheduled tasks (min 1
minute, only while the app is open) and `/loop` (https://code.claude.com/docs/en/desktop-scheduled-tasks).
Routines was renamed scheduled tasks but the URL, `/routines` alias and API keep the old name.

### 2d. Claude Code on your machine [doc: https://code.claude.com/docs/en/memory]

- CLAUDE.md scopes (managed, user, project, local), `.claude/rules/` with `paths:` frontmatter, `@` imports
  (depth 4), AGENTS.md read when no CLAUDE.md exists (v2.1.277+).
- Auto memory: per repository (derived from the git repo, shared across worktrees),
  `~/.claude/projects/<project>/memory/`, machine-local, `MEMORY.md` first 200 lines or 25 KB loaded each
  session, topic files read on demand. `autoMemoryDirectory` can redirect it and
  `CLAUDE_CODE_PROJECT_DIR_NAME` can make several launches share one directory. This is the only local,
  grouping-like knob Anthropic documents, and it is keyed by repo, which matches bb's definition of project.
- No local semantic search over past sessions is documented. Transcripts are deleted after
  `cleanupPeriodDays` [doc], so any ingestion must copy them out.

### 2e. What changed in 2025-2026 (as far as I could verify)

- Project RAG is described as launched for paid plans (RAG article above; date not confirmed [unverified]).
- Project-scoped memory and chat-search RAG are in the help center for paid plans (dates not confirmed).
- 2026: Claude Code Projects (beta), routines renamed to scheduled tasks, and the Routines API trigger under
  a dated beta header `2026-04-01`.

## 3. Comparables

| Product | What it has | Confidence |
|---|---|---|
| ChatGPT Projects | Project files (per-plan caps; third parties say 5 free, 25 Plus, 40 on higher tiers), project instructions, and a project-only memory mode that draws only on chats inside the project (sharing a project forces that mode, per one third-party read of OpenAI docs) | [unverified: OpenAI help pages were not reachable; figures from fast.io, elephas, memorylake] |
| Cursor | Embedding index of the codebase (not of chat history). Chat-history search exists only as community tools, for example a BM25 CLI over Cursor, Claude Code and Codex logs exposed over MCP | [unverified, forum post] https://forum.cursor.com/t/i-made-a-cli-to-search-all-my-cursor-chats-at-once-and-claude-code-codex-ones-too/170364 |
| T3 Code | Multi-project session management, git worktrees, PR and diff review. A fork (t3code-opencode) runs OpenCode sessions under the T3 UI. No project memory or session RAG found | [unverified] |
| OpenCode | Sessions per project directory; nothing found on RAG over sessions | [unverified] |
| Conductor | Unit of work is a git-worktree workspace with its own terminal, diff and checks; no grouping above the workspace and no session search found | [unverified] https://www.conductor.build |
| Notion agents (in this environment) | `notion-search-sessions`, `notion-query-sessions`: search over agent sessions inside a workspace | [observed as tool names only] |
| skl (owner's) | `search_sessions`, `ask_sessions` (answers with cited ranges), bookmarks, over local agent sessions | [observed as tool descriptions] |

Takeaway: nobody found offers a user-defined project grouping with semantic retrieval over mixed-provider
agent sessions. The closest are Anthropic's claude.ai chat Projects (chats only) and community BM25 tools.

## 4. Existing building blocks in the owner's setup

### bb
- **Project = repository** [observed]. `bb project` has list, create, show, update, delete, source,
  attachment, history (prompt history), files, content, paths, commands. No instructions, memory,
  grouping, tags, or members commands. `bb project attachment` stores server-managed attachments (a
  possible Library analogue, unverified for retrieval).
- **Threads**: `bb thread search <query>` returns `{active: {total, results}, archived: ...}` with
  `--limit` per group [observed]. The query schema is just `query` and `limitPerGroup` (no project filter
  in the schema, SDK d.ts `threadSearchQuerySchema`). Whether it is lexical or semantic is not documented
  [unverified; assume lexical]. `bb thread output` returns the final output of a thread. Thread lists can
  be filtered by project via `ThreadListArgs.projectId` (SDK).
- **Events**: plugins get `experimental_thread.events` (debounced to at most once a second per thread, with
  latest sequence and thread DTO; reading history does not re-emit) and lifecycle events through
  `bb.events.on`; there is a timeline query with `afterSequence` for incremental reads [SDK d.ts]. This is
  the ingestion hook, with the caveat that the event is experimental.
- **`bb.agents.configure(ctx => ({tools, skills, instructions}))`** [SDK d.ts]: runs when the provider
  session next starts or resumes; context has thread, project (id, name, git remote), host, provider,
  origin and `pluginMetadata`; `instructions` is truncated to 4,096 chars; tools and skills must be the
  plugin's own. Additive only, and not mid-session [observed in the earlier composer report].
- **`pluginMetadata`**: a JSON object per thread, namespaced to the plugin, seedable at `threads.spawn`
  and fork, readable in `configure` [SDK d.ts]. This is a natural carrier for `{projectLayerId}` on threads
  the plugin spawns. Whether metadata can be set on EXISTING threads is not confirmed [unverified].
- **`message.dispatch` hook**: sees prompt text, thread, project; decisions are only proceed, wait, reject.
  It cannot amend the message [SDK d.ts]. So a pre-turn context pack cannot be injected by this hook.
- **Mention providers** (`registerMentionProvider`, triggers `@ # $ ! ~`): server-side `search` (2 s
  timeout) and `resolve(itemId)` returning agent-visible, user-hidden context at send time [SDK d.ts].
  This is the supported way to attach a context pack on the user's request, for example `#proj-name`.
- **Automations** (skill `bb-global-skills:automations`): `bb automation create --project <id>` with
  schedule flags; two modes, `agent` (spawn a thread or re-prompt a target thread) and `script` (server
  side, silent when nothing to report). Scoped by bb project, may target a thread. Automation-spawned
  threads cannot create automations [doc in skill]. So routines already exist per repo.
- **Plugin panels/CLI**: `bb.cli` commands, thread panels, nav panels, homepage sections for a UI
  (agent-artifacts and bbim are working examples in the dotfiles repo) [observed].

### kb (graph store) [observed: CLAUDE.md, kb DESIGN.md]
- Nodes with tags and fields, datalog queries, `kb search` (case-insensitive substring over text/props,
  explicitly "no text similarity and no embeddings", DESIGN.md ~line 1966), MCP server, outliner UI, and a
  `#rule`/`#gap` convention. Good for curated, structured, referenceable project data: a `#project`
  tag with fields `instructions`, `repos`, `routines`, and decision/memory notes that mention it.
- It is NOT a semantic index. Fine as the registry and the "project memory" store.

### Cognee [observed: docs/cognee.md, docs/cognee-agent-hooks.md]
- Self-hosted service (authenticated, behind Tailscale) with an MCP gateway. `cognee-agent-setup` installs
  lifecycle hooks for Claude Code and Codex: prompt triggers recall, tool and response events are
  uploaded, session end flushes and "improves". Session ids are prefixed by agent. Hooks for Cursor, OMP,
  Hermes are only proposed. There is a node_set/dataset filter ("user, project, agent") in the plugin
  skills. Semantic and graph recall already works for Claude Code and Codex sessions.
- Gaps: pi threads have no adapter; "project" in Cognee today is a data category, not a bb project; per
  project dataset routing is unverified.

### skl [observed: tool descriptions]
`search_sessions`, `read_session`, `ask_sessions` (answer with cited ranges), bookmarks, over local agent
sessions, plus synced sessions on Skillsync. Local-session scope; retrieval method (lexical or semantic)
not documented here [unverified]. Likely the cheapest "RAG over past sessions" already available; it is
not project-scoped.

### Prior research (in worktree branch copies; not yet in main) [observed]
`docs/research/2026-10-24-own-harness-and-context-composer.md` (via
/Users/popemkt/.dotfiles/.claude/worktrees/agent-a05f03580863e9efb/docs/research): the composer is additive
only on bb as shipped (inventory yes; remove or rewrite no), fully possible on pi or a forked
`provider-pi`. `...-spatial-scratchpad-options.md` was skimmed only for retrieval mentions; none found.

## 5. Design options

Common requirement: "project = a grouping with knowledge, instructions, memory, routines and recall over
its own threads", across Claude Code, Codex and pi threads, over potentially several bb repos.

Axes decided once for all options:
- **Grouping**: a bb project is a repo, so a Claude-style project needs its own id. Store it in kb as a
  `#project` node (members: bb project ids, optionally thread ids or tags). Carry it on threads via
  `pluginMetadata` where the plugin spawns them, and map the rest by bb project id.
- **Reach to the agent** (ordered by how supported it is): `agents.configure` instructions (4 KB, session
  start) > plugin agent tool (any time, the agent decides) > mention provider (user decides, per message)
  > skills. A pre-turn automatic pack is NOT possible in bb as shipped (dispatch hook cannot amend); it
  needs a forked provider-pi or an MCP/hook route in Claude Code and Codex.
- **Privacy**: anything ingested copies transcripts out of provider storage (which Claude Code deletes
  after `cleanupPeriodDays`). Redact secrets, cap sizes, keep it on the owner's Tailscale-only services;
  on a shared host (`/etc/dotfiles/shared-host`) index per person, not per host [inferred].

| # | Option | Ingestion | Store | Reach | Effort | Retrieval quality | Composes with the context composer |
|---|---|---|---|---|---|---|---|
| A | Instructions-only layer | none | kb `#project` node | `agents.configure` instructions (4 KB) and skill | S (days) | None for history; good for rules and pointers | The project block is one named layer the composer lists and can toggle; trivial |
| B | Search-as-tool, no index | none | bb thread search (and skl) scoped by project's repos | plugin tool `project_recall` and `bb thread search` | S-M | Lexical only, recent hits, no ranking by meaning; scoping is by repo or title, not true project | Tool shows up in inventory; composer can enable or disable it per thread |
| C | kb distilled memory | agent or automation writes decisions, summaries, links to threads into kb at thread end | kb nodes tagged with the project, datalog and substring search | tool `project_recall`, mention provider `#proj`, kb MCP | M | High precision, curated, linkable; recall depends on distillation discipline; no fuzzy match | Best fit: a kb query result IS a composer source, and kb nodes are referenceable |
| D | Cognee dataset per project | existing Cognee hooks for Claude Code and Codex; new adapter for pi (proposed in cognee-agent-hooks.md) | Cognee graph and vectors, dataset or node_set per project | Cognee MCP or hook recall; wrap in `project_recall` | M (hooks exist; dataset routing and pi adapter are the work) | Semantic plus graph; good on cross-session synthesis; quality depends on Cognee's cognify and on dataset scoping | Recall output becomes a composer source; hook recall already injects before the turn on Claude Code and Codex, which the composer cannot see or remove (inventory gap) |
| E | Own vector index fed by bb events | plugin ingests `experimental_thread.events` incrementally via timeline query, chunks per turn | sqlite plus local embeddings (for example the Ollama already used by Cognee) in the plugin's storage | plugin tool, mention provider, UI panel | L (weeks) | Best control: provider-agnostic, project-tagged, hybrid lexical plus vector, citations to thread and sequence | Cleanest: the composer asks the same index for a pack and shows exactly what was added |
| F | Claude Code Projects itself | n/a | Anthropic cloud | n/a | none | Not usable: cloud-session-centric, GitHub-only, no pi/Codex, no local bb threads, no documented thread RAG, single user | None |
| G | Hybrid (recommended) | B now, C by agent habit, D where hooks exist, E later | kb registry plus federated recall | one tool, one mention provider | M | Each backend covers what the others miss; one interface hides which one answered | One `project` layer in the composer with sub-sources |

Routines and automations per option: attach the project id to `bb automation` records by naming
convention (name prefix or a field in the kb `#project` node listing automation ids) since automations are
scoped to a bb project; an "agent" automation can re-prompt a project's coordinator thread (a designated
thread, the nearest analogue of Claude's project conversation) [inferred]. A `script` automation can run
the incremental ingest for options D/E.

## 6. Recommended MVP

Goal: smallest thing that makes "project" real and gives useful recall, without committing to an index.

1. **Registry in kb**: a `#project` tag with fields `goal`, `instructions` (the 16k-char style brief),
   `repos` (bb project ids), `coordinator` (optional thread id), `automations` (ids), `cogneeDataset`.
   Project memory = notes that mention the project node (decisions, pitfalls). Edit through existing kb UI
   and MCP. No new store.
2. **One bb plugin `projects`** (additive, so inside what the SDK allows):
   - `agents.configure`: for threads whose bb project is in a registered project or whose
     `pluginMetadata.projectId` is set, inject a short instructions block (goal, repos, "call
     `project_recall` before re-deriving past decisions") under the 4,096-char cap, and register the tool.
   - Agent tool `project_recall(query, scope?)`: federates (a) `bb thread search` filtered to member
     repos' threads, (b) kb search and datalog on the project's notes, (c) Cognee recall on the project's
     dataset when configured, returning ranked snippets with thread id, sequence and source.
   - Mention provider `#project`: lists projects; `resolve` returns the instructions plus the current
     memory notes as a user-requested pack.
   - `bb.cli` command `bb projectlayer ...` (list, show, assign thread) so agents and scripts can use it.
3. **Memory habit by automation**: an `agent` automation per project that runs at thread end or nightly
   and writes distilled decisions into kb (option C); it is the equivalent of Claude's project memory
   writer. Keep it opt-in.
4. **Defer** the own index (E) and the pi adapter. Decide after two weeks of use whether `project_recall`
   misses are a recall problem (then E) or a discipline problem (then better distillation).

Acceptance test: from a thread in repo A of a two-repo project, ask "what did we decide about X in the
repo B thread last week" and get the right thread cited; instructions edited in kb show up in the next new
thread; a nightly automation adds notes without anyone prompting.

Composer fit: expose the project as a single named layer with its sources (instructions block, memory
notes, recall tool). The composer cannot remove Cognee hook injection or provider-native memory on Claude
Code or Codex (known limit from the prior report); it can only list them. Pi threads can get the full
treatment later.

## 7. Open questions for the owner

1. Is the target the claude.ai chat Projects experience (RAG over files and chats) or the Claude Code
   Projects experience (a coordinator plus parallel threads)? The MVP serves the first; the second would
   need a designated coordinator thread and spawn-on-demand logic.
2. Is a project allowed to span several bb repos and machines (laptop, shared-server)? That decides whether
   the registry in kb must be synced and whether ingestion runs per host.
3. Should recall cover the owner's non-bb sessions (skl's local sessions)? Then skl is a fourth backend.
4. Who edits project memory: only the owner, or an agent automatically? Anthropic's choice is the agent,
   with a visible editable UI.
5. Privacy line: may full tool outputs be indexed, or only prompts and assistant messages?
6. Does the owner want the project layer visible in the bb sidebar (grouping threads), which would need UI
   work in the plugin (sidebar sections exist in the SDK) beyond the MVP?

## 8. Unverified

- Whether `bb thread search` is lexical or semantic, how it ranks, whether it can filter by project, and
  its size limits (only the query and limit args are visible).
- Whether `pluginMetadata` can be written to an existing thread, or only at spawn or fork.
- Exact payload and cost of reading a thread's full transcript incrementally (timeline query exists;
  throughput and retention not tested).
- `experimental_thread.events` is marked experimental; shape may change (`docs/api_to_audit.md` is
  referenced in the SDK).
- Cognee: per-project dataset routing from the lifecycle hooks, and recall quality on code-heavy sessions.
- skl's retrieval method and project scoping.
- All ChatGPT Projects numbers, Cursor, T3 Code, OpenCode and Conductor session-search claims (third-party
  or absent; official pages not reached).
- Dates for when Anthropic launched project RAG, project-scoped memory and chat-search RAG.
- Whether Claude Code Projects has any retrieval over thread transcripts beyond what the docs state.
- The 16,000-character instruction limit and the beta status are from the docs fetched on 2026-10-24 and
  may change; the feature is a rolling beta.

## Sources

- https://support.claude.com/en/articles/9517075-what-are-projects
- https://support.claude.com/en/articles/11473015-retrieval-augmented-generation-rag-for-projects
- https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context
- https://code.claude.com/docs/en/claude-projects
- https://code.claude.com/docs/en/web-scheduled-tasks
- https://code.claude.com/docs/en/desktop-scheduled-tasks
- https://code.claude.com/docs/en/memory
- Local: bb 0.47.x CLI (`bb guide`, `bb project`, `bb thread search`), bundled-types/bb-plugin-sdk.d.ts
  (worktree agent-a6d21bbdef21dbbc4), /Users/popemkt/.dotfiles/docs/cognee.md and cognee-agent-hooks.md,
  /stuff/workspace/repos/kb/DESIGN.md, the 2026-10-24 composer report.
