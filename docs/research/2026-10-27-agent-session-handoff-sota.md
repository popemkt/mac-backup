# Agent session handoff: what other tools do, and what it means for the bb import plugin

Date: 2026-10-27. Research only; no code. It checks the design in PR #88
(`docs/research/2026-10-27-claude-session-import.md`, branch `docs/claude-session-import`): a handoff that starts a new
bb thread seeded with a cleaned transcript, with the full transcript as a file and a read-only "Original session"
panel. Claims are tagged **[measured]** (run here), **[code]** (read in source), **[doc]** (vendor documentation read
today), **[secondary]** (a third-party write-up, not confirmed against the vendor) or **[unverified]**. Local facts come
from this Mac (skl 0.35.4) and from shared-server (bb 0.46.1, `~/.local/lib/node_modules/bb-app`). Upstream facts come from
the repositories named in section 10, read through `gh` on 2026-10-27. Nothing was installed, restarted or posted.

## 1. Short answer

Nobody has a better trick for the hard part than the one #88 already rejects: **a session can be continued natively only
by the harness that wrote it, or by a tool that rewrites it into that harness's own store.** Every tool that shows an
imported session's history inside its own UI (T3 Code, Codex, Zed, VS Code) is a core feature of that app, not a plugin.
What the survey adds is five things:

1. **Skillsync's `skl` is a working example of the rewrite route**, built on an open library, `txcript` (Apache-2.0, 17
   readers, Rust, npm WASM). `skl continue --with claude_code` mints a new native Claude session in the right project
   dir. It cannot help bb today, because bb has no way to bind a session id (get-bb/bb#3260). It does help later: it is
   the cross-harness half of adoption, and it is the cheapest second reader for the plugin.
2. **"Agent host protocol" is a real, named thing**: Microsoft's Agent Host Protocol (AHP), shipped with VS Code. It is
   about N clients sharing host-owned sessions. It has no import of a foreign session, so it is no route around #3260.
   Its *side chat* (history as agent context, not copied into the visible turns) is the same split #88 chose.
3. **ACP `session/load` does replay history, but bb throws the replay away** and calls `session/load` only for an id it
   already owns. It is a good *reader* route (Zed's "Import Threads" does exactly that) and a poor adoption route. One
   plugin-only adoption route exists, a plugin-owned ACP provider that resumes Claude through `claude-agent-acp`'s
   `_meta.claudeCode.options.resume`; it is unproven, and it costs the builtin Claude provider's features (spike S6).
4. **The failure modes of real importers are documented in Codex's issue tracker**, and #88 mostly avoids them. It
   misses two: role misattribution of injected blocks, and a re-sync story.
5. **The research on what to keep is consistent with #88's cuts** (mask tool output; keep decisions, files, errors and
   next steps), with one sharp warning: *the file trail is the part every summariser loses*, so build it
   deterministically from tool calls instead of hoping a summary has it.

## 2. Skillsync, `skl` and `txcript`

**What it is.** Skillsync is a startup (YC W26 per a [secondary] review) whose product is a macOS app, a CLI (`skl`), an
MCP server and a cloud for sharing sessions and agent skills. The local MCP server `skl mcp` here is the `skl` binary
(`~/.local/bin/skl`, 20 MB, 0.35.4). Its session engine is **`txcript-cli 0.14.4`** [measured: `strings` on the binary],
the open-source `skillsynchq/txcript` ("Pandoc for AI chats", Apache-2.0; crate `txcript`, npm `txcript` 0.14.4, 2026-09-13)
[doc]. The binary carries txcript's source paths (`src/harness/claude_code.rs`, `src/transcript.rs`, `src/text.rs`). The
parts that talk to Skillsync (login, sync, memory, remote) are not in that repo [unverified: the CLI's own source].

**Normalisation.** Each harness has a reader and, for 12 of 17, a writer. Every reader goes into one canonical model,
`Transcript<Common>`: messages, reasoning, tool calls and results, images, metadata (id, cwd, branch, model, title),
usage, and read-side lineage (fork, spawn). A target writer turns the model back into the target's native store
[doc: txcript README, `docs/formats/README.md`]. Claude Code's format is "the least exotic": each line already wraps an
Anthropic Messages payload, so the canonical model is shaped like it. The interchange file, **Simple**, is a JSON
document `{ id, cwd, git_branch, title, model, messages: [{ role, content: string | blocks }] }` with `text`, `thinking`,
`tool_use`, `tool_result`, `image` and `artifact` blocks. It has no system-prompt slot on purpose: "no harness transports a
system prompt through conversion" [doc: `docs/formats/simple.md`]. Any agent can emit it, so it is the closest thing to an
open session-interchange format.

**Rendering and compression (`read_session`).** None. `skl view` and the MCP `read_session` print one compact text form:
a `[session]` header (id, start, cwd, branch, model), then numbered `── #N ──` blocks of `[user]`, `[thinking]`,
`[tool N Name]` plus its JSON input, and `[result N]` with the output. It drops signatures, usage and bookkeeping, and
nothing else. On a real 1.4 MB Claude session it printed 313 KB, with thinking and **every tool result in full** (the
longest line was 207,388 characters) [measured]. Its answer to size is random access: a read over **100,000 bytes** is
refused with suggested ranges (`13f7ca46#1-50`, `#51`, `#52-75`) [measured], and a `#a-b` range never cuts a tool call from
its result. The caller is the summariser. A separate command, `skl search` / MCP `ask_sessions`, asks a hosted model a
question and returns cited ranges; it needs a login, and "only the specific excerpts the search reads leave the machine"
[doc: `skl guide`].

**Sharing.** `skl sync <id> [--workspace <slug> | --private]` uploads one session to Skillsync, an explicit act the guide
tells agents never to do on their own. `skl remote list/view/continue` reads your own and workspace-shared sessions; the
workspace listing carries "the author's tags and the server's key points" (server-written summaries) [measured: the MCP
tool description]. Upload format and encryption were not checked [unverified]. A third layer, `skl memory`, loads
workspace notes and learned skills into new sessions through a SessionStart hook. That is cross-session knowledge, not
handoff.

**Handoff.** Yes, it is the product: `skl continue <id> [#range] [--with <harness>] [--out <dir>] [--no-resume]`.
Same harness: resume the original in place. Another harness, or a Simple file: write a **new** session with its own id,
then launch the harness in the recorded cwd (replaced by the current directory when it does not exist on this machine);
"the source is never modified" [doc: `skl continue --help`]. `skl export <id> --out run.json` makes the Simple file to carry
to another machine; `skl crop` is an interactive timeline editor that removes messages (a tool call and its result go
together). I ran `skl continue 13f7ca46#1-12 --with claude_code --out <dir>`: it wrote a 12-line JSONL native session in
`<dir>/-Users-popemkt--dotfiles/` with a printed `claude --resume <id>` [measured].

**Fidelity and limits.** Same-harness trips keep every record; cross-harness trips lose what the target cannot hold.
Documented Claude-writer caveats [doc: `docs/formats/claude-code.md`]: bookkeeping lines and unmodeled blocks are gone;
entry ids become UUIDv5; `tool_result.content` must be a string or block array or `claude --resume` fails to load;
non-object tool inputs are wrapped as `{input: …}`; a leading summary line's `leafUuid` must name a real line or Claude
Code "reports the whole session missing"; replayed tool names are sanitised. The system prompt, tools and project files
are not carried. The Claude format itself is "internal to Claude Code and changes between versions" (Anthropic's docs
say so too). Whether txcript treats Claude compaction records correctly was not checked [unverified]; Codex's importer
gets it wrong (section 5). Reading is whole-file: `skl view #1-6` on the 160 MB, 11,502-message Mac session took 1.96 s
and **1.0 GB peak RSS** [measured], so a streaming reader is still needed for the biggest files (the S1 spike of #88).

**For bb.** (a) It does not change what is possible today: a minted session still cannot be bound to a bb thread.
(b) It makes #3260 more valuable: a Codex or OpenCode session could be minted as a Claude session by txcript and then
adopted by id, a cross-harness adoption bb would never write itself. (c) As a reader it is the cheapest second
implementation of #88's reader port: npm `txcript` (`toCommon(text, "codex")`, 1.7 MB unpacked, offline, no agent
process) covers 17 harnesses. Its text projection keeps tool output, so the plugin still renders its own transcript.
(d) `skl` itself is on the Mac only (`which skl` on shared-server: not found), so depend on the npm library, not the CLI.

## 3. "Agent host protocol": AHP, ACP and bb's own providers

### 3.1 What the phrase names

Candidates were Zed's Agent Client Protocol (ACP), VS Code's agent host, and the Claude Agent SDK. **There is a protocol
literally named Agent Host Protocol**, in the open (MIT) at `microsoft/agent-host-protocol`, spec at
microsoft.github.io/agent-host-protocol, with TypeScript, Rust, Go, Swift, Kotlin and .NET clients. VS Code's agent host is
the reference server (the VS Code blog dates the architecture to 2026-08-26; a secondary source puts the open standard
at 1.135) [doc]. Which one the owner meant is [unverified]; sections 3.2 and 3.3 cover both.

### 3.2 AHP

- **Mechanism.** JSON-RPC over WebSocket (or a local message port). The host owns the authoritative state tree; clients
  subscribe to URI channels (`ahp-session:/…`, `ahp-chat:/…`), get a snapshot, then ordered actions; a reconnecting client
  sends `lastSeenServerSeq` and gets the missed actions or a fresh snapshot. Sessions contain **chats**; a chat holds the
  turns [doc: `docs/guide/ahp-and-acp.md`, `docs/specification/*`].
- **ACP relation.** "AHP is a coordination layer. ACP is a communication layer." A host speaks AHP to its clients and ACP
  (or an SDK) to the agents; third-party hosts exist (`pi-ahp`, `ahpd`, `hydra-ahp`, an AHP-ACP gateway) [doc: README].
- **What transfers.** Within a host, `createChat` takes a `source`: `{ kind: "fork", chat, turnId }` copies the history up
  to that turn into the new chat's visible turns; `{ kind: "sideChat", … }` gives the host's source history "as agent
  context, but does not copy that history into the side chat's `turns`" [doc: `chat-channel.md`]. I searched the root, session, chat
  and lifecycle pages for import, native, resume and restore: there is **no method that adopts a session from a harness's own store**, and
  `root/listSessions` lists only what the host owns. History is windowed: a subscriber may get only the newest N turns
  (`view.turns`) and fetch older ones by cursor (`fetchTurns`, `chat/turnsLoaded`).
- **Related VS Code feature.** "External Agent Sessions" shows up to two recently updated sessions created in other
  applications and lets you continue one in VS Code; it needs a Copilot subscription [secondary: ntcompatible]. The VS Code
  docs add that local-harness sessions are owned by their window and "can't be continued from another interface" [doc].
- **Applicability.** bb is already the host, and its apps are the clients, so AHP gives bb no import path. Two design ideas
  carry over. The side chat's split (context to the agent, not into the visible turns) is #88's `agent-only` input plus a
  panel, with a name and a protocol behind it. The windowed turn fetch is the right model for the "Original session"
  panel: load the tail, page older turns, fetch tool output on expand.

### 3.3 ACP `session/load`, and what bb does with it

- **Protocol.** `session/load` needs the agent's `loadSession` capability, takes `sessionId`, `cwd` and `mcpServers`, and
  the agent "MUST replay the entire conversation" as `session/update` notifications (`user_message_chunk`,
  `agent_message_chunk`, tool calls, compactions with a capability) before it answers. `session/resume` reconnects
  **without** replay. `session/list` (capability `sessionCapabilities.list`) returns `sessionId`, `cwd`, `title`,
  `updatedAt`, paged [doc: agentclientprotocol.com].
- **Claude over ACP.** `agentclientprotocol/claude-agent-acp` (Apache-2.0) advertises `loadSession`, `list`, `resume`,
  `fork`; `loadSession` replays the whole transcript through `replaySessionHistory`; and **`newSession` honours
  `_meta.claudeCode.options.resume`**, so a client that sets it gets a native Claude resume at `session/new`
  [code: `src/acp-agent.ts` lines ~3032, 3083, 3199].
- **What bb does.** Both builtin bridges (`provider-acp`, `provider-acp-next`, read on shared-server) call `session/load`
  in exactly one place: `thread/resume` for a provider thread id bb already stored. In `provider-acp`, every
  `session/update` that arrives while `loading` is **dropped** (only `usage_update` is kept), bb then emits
  `thread/identity` and `session.reset`, and if the load fails it falls back to `session/new` with the notice "could not
  restore the previous session; continuing in a fresh session without in-agent history" [code]. `provider-acp-next` tags
  its events `replay` and also uses `session/resume` when advertised; whether the server shows replay-tagged items in the
  timeline was not traced [unverified]. `session/new` is sent with `cwd` and `mcpServers` only, never `_meta`.
- **Zed's use.** Zed's "Import Threads" connects to each configured agent over ACP, lists its sessions, skips ones without
  a working directory and ones already in history, and adds the rest as archived threads that restore on open
  [doc: zed.dev external-agents]. That is ACP used as a *reader*, from the client side.

### 3.4 Is there a route around #3260?

| Route | Gets a native resume | Gets history in the bb timeline | Verdict |
|---|---|---|---|
| `session/load` through the builtin ACP provider | no: bb only calls it with an id it owns | no: replay is dropped [code] | closed |
| Plugin-registered ACP provider whose launch command is `claude-agent-acp`, with a thin wrapper that adds `_meta.claudeCode.options.resume` to `session/new` | yes, at `session/new`; bb then records the returned id as the thread's identity (whether a resumed session reports its old id or a new one was not checked) | no: a `new`+`resume` start replays nothing | **open, unproven** (spike S6) |
| The same wrapper also answers `session/new` by running `session/load` itself and forwarding the replay before it replies | yes | maybe: bb queues updates that arrive before the identity (`deferStartEmit`) and flushes them after; how they render is unknown | speculative |
| Plugin-owned non-ACP bridge (`bb.providers.register` plus `experimental_providerBridge`) that returns any id from `thread/start` | yes | yes, if the bridge emits `thread/delta` items for history | works in principle; means re-implementing the Claude bridge |

The plugin SDK does let a plugin ship a full provider, and the ACP kit accepts a plugin's own launch spec and dialect
(`@get-bb/plugin-sdk/provider-bridge/acp`, `…/acp-next`, `experimental_registerAcpDialect`) [doc: `providers.md`]. Whether a
launch wrapper can read a per-thread resume id (thread-level `envVars`, `deriveProviderOptions`) is [unverified]. The cost
is large: a thread on such a provider is not a `claude-code` thread, so it loses the builtin provider's tools, artifacts
and permission handling; and it runs a second Claude stack. It is worth a half-day spike, not a v1 dependency.

## 4. T3 Code

Read from `pingdotgg/t3code` (`apps/server/src/project/AgentSessionImporter.ts`, `AgentSessionScanner.ts`) [code].

- **Native resume.** For Claude the importer persists a provider-runtime row, status `stopped`, with
  `resumeCursor: { threadId, resume: <claude session id> }` and `runtimePayload: { cwd }`; for Codex the cursor is
  `{ threadId: <session id> }`. The thread is created with `historyOrigin: "v1_import"`, `settledOverride: "settled"` and
  a provider thread whose `nativeThreadRef` names the native id. The next turn resumes natively (the cursor is the
  contract; the adapter that consumes it was not read). A Claude id must match a UUID pattern or the import is refused as
  unresumable.
- **History shown.** Text only: `message.updated` plus `turn-item.updated` events as user and assistant messages with no
  run, no tool calls, no thinking. It keeps the first user message plus the newest 199 (`MAX_IMPORTED_MESSAGES = 200`);
  sidechain, meta and compaction-summary records are skipped. After import, the visible history is a skeleton while the
  agent holds the full native context.
- **Limits.** 30-day window (`RECENT_THREAD_WINDOW_MS`); at most 100 transcripts per run; 32 MiB of history bytes per
  transcript; 100,000 records; metadata scans read at most 1 MiB or 1,000 records per file.
- **cwd and projects.** The scanner reads a session's cwd, groups sessions by directory identity, and drops paths that
  are missing, excluded, or git **worktrees** (so a worktree session never becomes a project). Import runs per project,
  guarded by `expectedWorkspaceRoot` against a project that moved; a session counts only if its cwd matches the project's
  `workspaceRoot` after path normalisation (exact-versus-prefix matching was not traced).
- **Dedupe.** Thread id `import:<instance>:<sessionId>`, a runtime ledger of imported sources, and an event-write guard,
  `unlessNativeThreadOwned`, so **one native session cannot be owned by two T3 threads**. Re-import is refused when the
  thread has "non-imported activity".
- **Applicability.** #88 already takes the cwd match, text-only history and id-keyed dedupe. Worth stealing: the
  ownership guard (a "this session is already a thread" check, which #88 builds as the "in bb" index), the UUID check,
  and discovering *projects* from session cwds (excluding worktrees), as a way to suggest a project when none maps.

## 5. The rest of the field

### 5.1 Claude Code itself [doc: code.claude.com sessions, Agent SDK sessions and session-storage, cloud]

- **Resume.** `--resume <id|name|transcript-path>`, `--continue`, `/resume`. A resumed session restores messages, tool
  calls and results; after compaction it "opens at a `Conversation compacted` row" and Claude continues "with the last
  compaction's summary, the messages that compaction left unsummarized, and every message since". Interrupted tool calls
  are marked as cut off and the model is told to check whether they took effect. Not restored: `--mcp-config`,
  `--add-dir`, `/add-dir`, background shells. It restores model, permission mode (with exceptions) and an active goal.
- **Where.** By id from any directory, but only if exactly one other project holds that id; "same machine only: the session
  file still needs to exist on the current machine". Default retention is 30 days (`cleanupPeriodDays`; set to 1825 here).
- **Fork.** `/branch`, `--fork-session`, `forkSession()`: a copy with a new id, remapped uuids, the source untouched. Two
  terminals resuming the same session without forking "interleave into one transcript".
- **Across hosts.** Either move the `.jsonl` into `~/.claude/projects/<any dir>/` on the new host, or attach a
  **`SessionStore`** adapter (append/load, optional list/delete/subkeys; S3, Redis and Postgres examples), which mirrors
  every entry to your backend and lets another host resume from a matching cwd. The docs also offer the option #88 took:
  "capture the results you need… and pass them into a fresh session's prompt. This is often more robust than shipping
  transcript files around."
- **`getSessionMessages` returns the post-compaction chain**: "a session whose store holds 503 raw entries may return 18
  messages"; the raw history needs `store.load` or the file. This answers #88's spike S2 (section 8).
- **`/export`** writes a readable text file; scripts are pointed to `claude -p --resume <id> --output-format json`, hooks'
  `transcript_path`, or the SDK, not to parsing the JSONL.
- **Cloud.** `--teleport` pulls a web session into the terminal: it checks the same repo (not a fork), a clean tree and the
  same account, fetches the branch, and loads the full history into a **new local copy**. From the CLI the handoff is
  one-way: `--cloud "task"` starts a new cloud session from the repo, with the task text and git state, not the
  conversation. The Desktop app can send a local session to the cloud.
- **Compaction (what survives).** "Architectural decisions, unresolved bugs, and implementation details", the five most
  recently touched files re-read, invoked skill bodies re-injected (5k per skill, 25k total), CLAUDE.md and auto memory
  re-injected from disk; redundant tool output dropped. Anthropic's advice is to tune for recall first, then precision
  [doc: anthropic.com engineering post, context-window page].

### 5.2 Codex, Cursor, Zed, VS Code, OpenCode

- **Codex `/import`** (CLI 0.128 added `externalAgentConfig/detect|import`, `/import` followed; versions per [secondary]).
  It scans Claude Code (and later Cursor) session JSONL from the last 30 days and writes **native Codex rollouts**
  [code: `codex-rs/external-agent-migration`, `app-server/src/external_agent_migration/session_importer.rs`]. It keeps a
  ledger keyed by source path and **content sha256**, with source mtime and the imported thread id, and
  `append_existing_session` appends "the exact missing suffix" when the source grew, "fail[ing] closed" on a diverged,
  active or archived destination. Open bugs show where a native-looking import breaks:
  - #34656: compaction summaries become ordinary user messages, so 76,298 items exceed the Responses API's 16,384-item
    input limit and the first follow-up fails.
  - #48423: `<task-notification>` blocks and internal slash commands are stored as **user** messages; raw
    `[external_agent_tool_call]` blocks appear as assistant text; the user cannot tell what they asked.
  - #32351 (closed): imports lost the original timestamps. #56890: an import "consumed all my 5-hour token limit", a
    cost surprise from an import that spends tokens before the user does anything.
- **Zed "Import Threads"**: ACP `session/list` plus `session/load` per configured agent; skips sessions without a cwd;
  re-import is safe because existing threads are skipped [doc].
- **Cursor**: `&` sends a message to a cloud agent; local-to-cloud "Move to Cloud" exists; cloud-to-local has no
  conversation transfer, the fallback being "push the branch and check it out locally, which loses the chat history"
  [secondary: forum threads, agentpatterns]. Not confirmed against Cursor's docs.
- **OpenCode**: `opencode export [id] [--sanitize]` writes one JSON file, `opencode import <file>` restores it; `--fork`
  on continue [doc: opencode.ai CLI]. Share-link import is claimed by a mirror and not in the official page [unverified].
- **Goose**: `goose session export --format json|yaml|markdown` [secondary]. **Windsurf**: no export [secondary, vendor
  blog]. **Roo Code**: no handoff doc found.

### 5.3 Handoff prompts and agent-to-agent patterns

- **Amp Handoff** (2025-10-23) replaced compaction. You state a goal for the new thread; Amp "analyzes the current thread
  and generates a prompt to start the new thread, along with a list of relevant files" as an **editable draft**. The
  stated reason: compaction is lossy and stacks "summary on top of summary"; "instead of summarizing a thread, you're
  extracting from it what matters for your next task" [doc: ampcode.com/news/handoff]. Whether `/handoff` survived Amp's
  May 2026 rebuild is [unverified].
- **Cline `/newtask`** carries four things "into a fresh task with a clean context window, leaving behind tool calls and
  implementation details": the overall plan, work accomplished, relevant files, next steps [doc].
- **Handoff-skill pattern** ([secondary: agentpatterns.ai]): session intent, decisions made in the conversation, open
  questions, next action, references to durable artifacts; exclude what lives in a PRD, ADR, commit or diff, and "the full
  transcript. Copying it is the failure mode the skill exists to prevent."
- **OpenAI Agents SDK handoffs** [doc]: the receiving agent sees "the entire previous conversation history" by default; an
  `input_filter` (for example `remove_all_tools`) reshapes it; opt-in `nest_handoff_history` compacts earlier turns into
  assistant summary segments inside a `<CONVERSATION HISTORY>` block, and "does not redact sensitive data".
- **A2A** [doc]: `contextId` groups tasks on one server agent; the key-concepts page defines no mechanism for moving
  conversation history between agents. A cross-agent handoff is a client convention (forward messages or artifacts as
  parts).

## 6. What to keep when compressing a transcript for continuation

- **Mask observations; summarise only if you must.** JetBrains' "The Complexity Trap" (arXiv 2508.21433, SWE-agent on
  SWE-bench Verified, five models) found that hiding old tool output "roughly halves cost" against the raw agent and
  matches LLM summarisation's solve rate, sometimes slightly beating it; a hybrid saves 7% and 11% more [doc]. #88's
  "drop tool output, keep one line per call" is observation masking.
- **Structure beats prose.** Factory's probe evaluation (recall, artifact, continuation, decision probes; 0-5 scale)
  scored structured summaries with explicit sections (session intent, file modifications, decisions, next steps) at 3.70
  overall against 3.44 (Anthropic) and 3.35 (OpenAI) [doc, vendor-run]. The **artifact trail scored worst for every
  method, 2.19 to 2.45**, which the authors call unsolved and answer with "a separate artifact index or explicit
  file-state tracking". They argue the metric is tokens per task: a dropped file path costs a re-read.
- **What the vendors say to keep:** Anthropic: decisions, unresolved bugs, implementation details, recent files. Cline:
  plan, work done, relevant files, next steps. Amp: what the next task needs, chosen by a goal. The handoff-skill pattern:
  intent, decisions, open questions, next action, references.
- **What to drop:** repeated tool output, thinking, injected reminders, sidechains.
- **Reference, don't copy,** anything that lives in a commit, PR, plan or doc [secondary]. A fixed schema "can trap the
  receiver in the old frame when the task pivots" [secondary], so keep the person's own first message as the goal.

## 7. Comparison

| | Mechanism | What transfers | Native resume | Cross-harness | Cross-machine | Old turns visible after | Notes |
|---|---|---|---|---|---|---|---|
| `skl continue` / txcript | rewrite into target's store | whole conversation, tools, reasoning | yes, in the target | yes (17 in, 12 out) | via Simple file | in the target harness | new id; system prompt and files not carried |
| Claude Code `--resume` / fork | read own store | full state incl. compaction | yes | no | same host, or move the file / `SessionStore` | yes | `--resume <path>` works; format "internal" |
| Claude `--teleport` | cloud to CLI | history plus branch | local copy | no | cloud to local | yes | clean tree, same repo and account; one-way from CLI |
| Codex `/import` | rewrite into rollouts | messages, tools (as text) | yes | Claude and Cursor in | same machine | yes | ledger by sha256, suffix append; open bugs |
| Zed Import Threads | ACP `session/list` + `load` | replayed history | per agent | any ACP agent | no | archived threads | skips sessions with no cwd |
| T3 Code | core importer | text only, ≤200 msgs | yes (`resumeCursor`) | Claude, Codex | no | text skeleton | ownership guard, 30 days |
| VS Code AHP | host-owned sessions | n/a (no import) | n/a | via ACP below the host | remote hosts | yes (windowed) | side chat = context without copying |
| OpenCode export/import | JSON file | whole session | yes | no | by file | yes | `--sanitize` |
| Amp Handoff, Cline `/newtask` | generated brief | goal, files, plan, next steps | no | no | no | no (new thread) | editable draft; no transcript |
| OpenAI Agents handoff | in-process | full or filtered history | n/a | n/a | n/a | n/a | `input_filter`, nested summary |
| **bb #88 (A+)** | new thread + seed | cleaned transcript, one line per tool | no | yes | yes | in a panel | until #3260 |

## 8. Implications for the plugin

Each item is marked **adopt** (change the design), **consider** (decide in the build, or spike) or **reject**.

1. **Add a deterministic handoff brief above the transcript, adopt.** A block built from the record, no model call:
   goal (the person's first message, plus the latest compaction summary); **files touched** (paths from
   `Edit`/`Write`/`NotebookEdit`, kept apart from files only read); **open todos** (the last `TodoWrite` state in the
   chain); the **last assistant text and the last user message verbatim** ("where it stood"); branch, cwd, model, and a PR
   link if the session recorded one. Why: Factory's evidence that the file trail is what summaries lose, Cline's and Amp's
   four-part briefs, and the fact that this costs no extra model call. It also keeps #88's "nothing that is not in the
   record" rule. The brief goes first, so a cut that removes the middle of the transcript cannot remove it.
2. **Filter injected blocks by role and say so, adopt.** Codex #48423 stores `<task-notification>`, local-command output and
   internal slash commands as user messages. #88 drops `isMeta`; also drop or label `<task-notification>`, `<system-reminder>`,
   `<local-command-*>` and skill bodies, and render a background-agent notification as `[notification]`, never `## User`.
3. **Compaction: the plan is right, adopt, and S2 is answered.** Codex #34656 shows the cost of treating a summary as an
   ordinary message. The Agent SDK's `getSessionMessages` returns the post-compaction chain [doc], so cut 1 (the summary
   replaces everything earlier) is what the SDK gives for free. The catch (inferred): that chain no longer contains the original first
   prompt, so take it from `listSessions().firstPrompt` or one raw read, and keep it as the "goal".
4. **Interrupted turn marker, adopt.** Claude Code tells a resumed model that a tool call was cut off and to check before
   redoing it. If the last `tool_use` has no result, the brief should say "the session ended mid-tool: check the state of
   `<call>` before repeating it". It is deterministic and one line.
5. **Keep errors, consider.** Factory's recall probe is "the original error message". #88 keeps `(failed)` only. Keep the
   first 200 characters of the error text for **failed** calls, a handful, not all tool output. It stays within the masking
   result, which says to hide observations, and costs little.
6. **Ownership guard and re-sync, adopt the guard, consider re-sync.** T3's `unlessNativeThreadOwned` and Codex's ledger
   agree with #88's "in bb" badge. Add what both lack for bb: store the **last imported uuid and a sha256 of the session
   file's prefix**, not just mtime. "N new turns" then becomes an action, **Sync new turns**, that queues an `agent-only`
   follow-up with the delta, and refuses (like Codex's "fail closed") when the prefix hash no longer matches, for example
   after a rewind.
7. **Range import, consider.** `skl` and `crop` let you start from message N or drop a stretch, and refuse a range that
   splits a tool call from its result. The preview could take "start at turn N" (cheap, deterministic) and the CLI accept
   `import <id>#5-`. Reject a crop editor for v1.
8. **Reader port: take txcript before writing a Codex reader, consider.** The seam #88 postponed until a second reader
   exists has a candidate: npm `txcript` (`toCommon`) reads Codex, OpenCode, Cursor, pi, Grok and others offline in the
   host entry. Cost: it parses a whole file in memory (1.0 GB RSS on the 160 MB session [measured]); the Claude reader
   stays the Agent SDK plus a streaming fallback. ACP `session/list`+`load` is the other reader route (Zed's), but it spawns
   the agent, may need its auth, and replays only what the agent chooses; prefer txcript for offline files.
9. **A native-adoption route that needs no core change: spike it, do not depend on it, consider.** S6: a plugin-registered
   ACP provider launching `claude-agent-acp` with a wrapper that injects `_meta.claudeCode.options.resume` (section 3.4).
   Output: yes or no on three questions. Does the wrapper receive a per-thread session id? Does bb record the returned id
   as the identity, and is it the id of the outside session? Does the thread then resume (`turn.submit`)? Do not build
   the plugin on it: it forfeits the builtin Claude provider. It stays a named alternative to waiting for #3260.
10. **Do not write Claude session files ourselves, reject** (this reaffirms B′). txcript's own caveat list (anchoring a
    `leafUuid`, UUIDv5 ids, string-or-array tool results, sanitised tool names) is the price, and a resident bb Claude
    process ignores a rewrite anyway. If native session minting is ever needed, call txcript's writer.
11. **ACP replay as a timeline route, reject.** bb drops replay in `provider-acp` and the replay-tagged events in
    `provider-acp-next` are untraced; and it needs the id bb cannot be given. Keep the Original-session panel.
12. **Window the Original session panel the AHP way, adopt.** Render the newest N turns first, page older turns by cursor,
    fetch tool output only on expand (AHP `view.turns` / `fetchTurns`; txcript `#range`). This also bounds the 8 MiB host
    output limit #88 already worries about.
13. **Show the brief as an editable draft, consider.** Amp shows its generated prompt before sending. #88 keeps the whole
    seed `agent-only`. Show the short brief (item 1) as a visible, editable first message and keep the transcript
    `agent-only`: the person sees what the agent was told, and can steer it with a goal, which is Amp's stated reason that
    extraction beats summary. The risk is a longer-looking thread.
14. **Redact before it leaves the host, consider.** The transcript crosses machines and lands in a file. Tool output is
    dropped, which removes most secrets, but `Bash` command lines (inline tokens, `Authorization:` headers) and pasted user
    text remain. OpenCode ships `--sanitize` and OpenAI's nested history "does not redact sensitive data". A small pattern
    pass on command lines and text, run in the host entry, with a "N values redacted" count in the preview, is cheap.
15. **Budget: keep 40k as a ceiling, not a target, consider.** The 6-session sample in #88 puts text plus tool lines at
    10k to 22k (48k at worst), so the ceiling rarely binds. No source gives a size target. Factory argues for tokens per
    task over tokens per request, and the handoff-skill pattern warns against copying the transcript. A lower default
    (say the brief plus what fits in 25k, the file holding the rest) is a judgement call, not a finding [unverified].
16. **Add an escape hatch to true native resume, adopt (cheap).** On the Original session panel, show
    `claude --resume <id>` (same machine only) with a copy button, and a warning that continuing in a terminal while a bb
    thread also works from the seed forks the story; recommend `--fork-session`. Claude's docs say two terminals on one
    session interleave. Inversely, bb's own Claude threads are real sessions in `~/.claude/projects` (#88 section 3), so the
    same button belongs on bb Claude threads, out of scope here.
17. **Format drift and listing hygiene, adopt.** Anthropic calls the JSONL internal; record the source `cli_version` in the
    header and in `pluginMetadata`, and warn when it is newer than the version the fixtures came from. Never scan
    `subagents/` or `tool-results/` (txcript skips both; a subagent file on this Mac is 568 MB).
18. **Skillsync's cloud and `skl` binary, reject as dependencies.** Login, upload and a closed CLI on one machine do not
    fit a plugin that must run on every host. Its useful parts are open (txcript, Simple). `skl view` shows what a good
    read-only viewer needs (header, ordinals, ranges); it is a useful reference for the panel.

## 9. Spikes and open questions

- **S6 (new): launch-wrapper adoption via ACP**, as in item 9. Half a day on shared-server with `claude-agent-acp`.
- **S7 (new): does txcript's Claude reader keep compaction boundaries**, and can the WASM build read a 160 MB file? A
  fixture with `compact_boundary` and `isCompactSummary: true`, run through `toCommon`, answers the first.
- **S2 (from #88): resolved by documentation** (post-compaction chain) but confirm with the installed SDK 0.3.304 on one
  compacted session, because the doc is the store-backed variant.
- **S1 (from #88)** now has a baseline: txcript, a Rust reader, needs 1.0 GB for the 160 MB file; the Agent SDK is not
  expected to do better.
- **Which "agent host protocol"?** AHP is the one literally so named; if the owner meant ACP, sections 3.3 and 3.4 apply.
- **Not verified:** upload format of `skl sync`; Cursor and Amp's current behaviour against their own docs; version
  numbers of Codex's `/import` rollout; whether `provider-acp-next` shows replay-tagged items.

## 10. Sources

- Skillsync: skillsync.com; skillsynchq/txcript README and `docs/formats/{README,simple,claude-code}.md`, `docs/usage.md`,
  `CHANGELOG.md` (github.com/skillsynchq/txcript); npm `txcript`; baeseokjae.github.io/posts/skillsync-portable-agent-chat-2026
  [secondary]; local `skl --help`, `skl guide`, `strings` on `~/.local/bin/skl`.
- AHP: github.com/microsoft/agent-host-protocol (`docs/guide/ahp-and-acp.md`, `docs/specification/{root,session,chat}-channel.md`);
  code.visualstudio.com/docs/agents/concepts/agent-host; code.visualstudio.com/blogs/2026/08/26/agent-host-architecture;
  ntcompatible.com VS Code 1.135 story [secondary].
- ACP: agentclientprotocol.com/protocol/session-setup and /session-list; github.com/agentclientprotocol/claude-agent-acp
  `src/acp-agent.ts`; zed.dev/docs/ai/external-agents; bb `provider-acp` and `provider-acp-next` on shared-server;
  `bb-plugin-authoring` reference `providers.md`.
- T3 Code: github.com/pingdotgg/t3code, `apps/server/src/project/AgentSessionImporter.ts`, `AgentSessionScanner.ts`.
- Claude Code: code.claude.com/docs/en/sessions, /claude-code-on-the-web, /context-window, /agent-sdk/sessions,
  /agent-sdk/session-storage; anthropic.com/engineering/effective-context-engineering-for-ai-agents.
- Codex: github.com/openai/codex (`codex-rs/external-agent-migration`, issues 34656, 48423, 32351, 56890);
  codex.danielvaughan.com import write-ups [secondary].
- Others: ampcode.com/news/handoff; docs.cline.bot/features/slash-commands/new-task; opencode.ai/docs/cli;
  openai.github.io/openai-agents-python/handoffs; a2a-protocol.org key concepts; agentpatterns.ai handoff skill
  [secondary]; forum.cursor.com threads [secondary].
- Compression research: arxiv.org/abs/2508.21433 (JetBrains, "The Complexity Trap"); factory.com/news/evaluating-compression
  (vendor-run).
