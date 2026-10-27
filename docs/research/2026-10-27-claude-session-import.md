# Claude Code session import: what bb allows, options, design

Date: 2026-10-27. Design only; nothing is built. It continues bb thread `thr_9cfkgc2v3x` (2026-10-23), which sized
options A–D on an older bb. Claims are tagged **[measured]** (run here), **[code]** (read in source or in the installed
bundle), **[doc]** or **[unverified]**. Sources: installed bb 0.46.1 on shared-server
(`~/.local/lib/node_modules/bb-app/`); plugin SDK `@get-bb/plugin-sdk` 0.6.49 (the version our plugins pin), checked
against 0.6.80; upstream `get-bb/bb` main `12b6e21d8` (2026-10-26); the Claude Agent SDK 0.3.304 that
`assets/bb-plugins/agent-artifacts` already bundles. SDK line numbers below are in `bundled-types/bb-plugin-sdk.d.ts`
of 0.6.49.

## 1. Short answer

A plugin still **cannot** create a bb thread that resumes an outside Claude Code session natively, and it **cannot**
write historical items into a thread's timeline. It **can** read every machine's `~/.claude/projects` through a
`host` entry that runs in that machine's host daemon, and it can start a thread on any machine, in the session's own
directory, seeded with a cleaned transcript. Native adoption is an open upstream feature request, get-bb/bb#3260,
triaged as high effort, with no work started.

Recommended: a new plugin, `assets/bb-plugins/session-import`, which imports a session as a **handoff**. It starts a
new thread whose first turn carries the cleaned transcript, and it shows the original session read-only in a thread
panel. Native adoption is recorded as a gap that closes when #3260 ships. Estimate: about 3 days.

## 2. What bb 0.46.1 lets a plugin do

### 2.1 Create a thread with a preset provider session id: no

- `createThreadRequestSchema` (SDK line 12802; upstream `packages/server-contract/src/api/threads.ts:131`) accepts
  `projectId, providerId, origin, originPluginId, pluginMetadata, visibility, title, input, model, serviceTier,
  reasoningLevel, sessionOptions, permissionMode, executionInputSources, environment, parentThreadId, sectionId,
  pinned, sourceThreadId, sourceSeqEnd, startedOnBehalfOf, originKind, sendAt, pluginSubmission`. It has no
  provider session field. 0.6.80 and upstream main still have none. [code]
- bb learns a thread's Claude session id in only one way: the provider's start result. It records that id as a
  `thread/identity` event (`apps/server/src/services/threads/thread-lifecycle.ts:770-800`). Once that event
  exists, the next turn goes out as `turn.submit` with the stored id (`thread-lifecycle.ts:981`,
  `requireDispatchableProviderThreadId`), which is Claude's resume. Nothing outside the provider can write that
  event. [code]
- Fork does carry a `sourceProviderThreadId` down to the Claude bridge (`plugins/provider-claude-code/src/bridge/bridge.ts:2474`
  calls the Agent SDK's `forkSession`). The server derives that id from a **bb source thread's** own identity
  (`apps/server/src/services/threads/thread-fork-history.ts:196`), so a fork cannot name an outside session. [code]
- `sessionOptions` for Claude are the provider's switches (`chromeEnabled`, `disable1MContext`,
  `artifactsEnabled`, `bridge.ts:439-484`), not a resume hook. [code]
- Plugin-contributed provider env does not help either: Claude Code has no environment variable that selects a session
  to resume. [unverified, no such variable known]

### 2.2 Write historical timeline items into a thread: no

- `ThreadsArea` (SDK line 18359) reads events (`events.list`, `timeline`, `message`, `output`). It writes only
  through turns, queued messages, `editMessage`, `fork`, `update` (title and the like) and plugin metadata. It has
  no append. [code]
- `experimental_timelineRenderer` (app SDK) renders the body of rows a plugin's **provider** or **interaction**
  produced. It does not create rows. [code]
- The only plugin-created timeline row is a `bb.ui.requestInput` form (SDK line 24030). Its `describeSubmission`
  payload persists on the row. A plugin could open a form and answer it itself through
  `threads.interactions.respond`, which would leave one "imported history" row. That misuses a user-input form.
  Payload size limits were not checked, and the row would still not be timeline messages. Rejected. [code]

### 2.3 Read session files on the machine where they live: yes, two ways

- **`bb.sdk.files.read/list({ hostId, path })`** (`FilesArea`, SDK line 17023): reads any absolute path on any
  connected host, through the daemon's `host.read_file`. A file over **25 MB** is refused
  (`apps/host-daemon/src/command-handlers/file-read.ts:22`, `NON_IMAGE_FILE_SIZE_LIMIT_BYTES`; the same
  `file_too_large` error is in the installed `host-daemon/dist/daemon-bundle.mjs`). [code] On the Mac, **12 of 196
  sessions are over 25 MB, and the largest is 160 MB** [measured], so this path alone is not enough.
- **A plugin `host` entry** (`experimental_defineHostEntry` from `@get-bb/plugin-sdk/host`, called from the server
  with `bb.hosts.experimental_client(...).call(method, input, { hostId })`; see the `bb-plugin-authoring` skill,
  `references/backend-foundation.md`, "bb.hosts"). The code runs in the host daemon of whichever machine `hostId`
  names, with Node `fs` and the user's `PATH`. Limits: 32 MiB input and **8 MiB output** per call, a 30 s default
  timeout, and a worker stopped after 5 idle minutes. [doc] The repo already uses this:
  `agent-artifacts/host.ts` runs the Claude Agent SDK on the workspace's machine. The builtin
  `provider-claude-code` ships one as well (`server/dist/builtin-plugins/provider-claude-code/package.json`,
  `"host": "./dist/host.js"`). [code]

### 2.4 Pieces the design uses

| Piece | Where | Use |
|---|---|---|
| `threads.spawn({ projectId, providerId, environment, input, pluginMetadata, title, ... })` | SDK 18104, 18433 | create the thread |
| `environment: { type: "host", hostId, workspace: { type: "unmanaged", path } }` | `thread-request-eligibility.ts:133`, `thread-environment-placement.ts:533` | run in the session's exact cwd. A path inside bb's own data dir is refused (`suppliedWorkspacePathRefusal`) |
| input `visibility: "agent-only"` | schema; `packages/db/src/data/events.ts:673` filters it from the shown prompt | the transcript reaches the agent but stays out of the visible message |
| input `{ type: "localFile", hostId, path }` | Claude bridge turns it into an attachment marker the agent reads (`bridge.ts:2718`) | point at the full transcript file |
| `pluginMetadata` on the thread | `threads.getPluginMetadata`, `experimental_listPluginMetadata` | remember source host, session id, cwd |
| `experimental_newThreadPanelAction` | app SDK, present in 0.6.49 | "Import Claude Code session" on the New thread screen |
| `threadPanelAction` | app SDK | "Original session" tab on an imported thread |
| `bb.cli` | `references/backend-cli-agents.md` | `bb session-import ...` for agents and terminals |
| `threads.events.list({ threadId, types: ["thread/identity"] })` | SDK 18243, event schema line 679 | find which sessions bb threads already own |

The Agent SDK the host entry would use exports `listSessions({ dir?, limit, offset })` (metadata: summary,
`customTitle`, `firstPrompt`, `cwd`, `gitBranch`, `fileSize`, `createdAt`, `lastModified`),
`getSessionMessages(id, { dir })` (the conversation chain resolved through `parentUuid`), `forkSession` and
`tagSession` (`agent-artifacts/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1123, 919, 855, 9887`). [code]
In the bundled copy, the session listing reads only the head and tail of each file (`provider-claude-code/dist/host.js`). [code]

### 2.5 Upstream

get-bb/bb#3260, "Adopt existing Codex, Claude Code, and ACP sessions as BB threads", is open, triaged
Feature/Medium/**Effort High**, and last updated 2026-09-30. Its contract is: resume the supplied native session (a
transcript replayed as a prompt "is not adoption"), persist the identity only after the resume succeeds, bind the
thread to a matching workspace, and add a history timeline where the provider can supply one. The suggested shape is
`bb thread adopt --provider --provider-thread-id --environment` and `sdk.threads.adopt(...)`. #1028 (ACP
`session/load` import) was closed as its duplicate; there the maintainer asked for a prototype. Nothing in the 0.47.0
changelog or on main implements it. [measured, `gh issue view`]

## 3. Where the sessions are and where the code runs

| Machine | bb role (`bb machine list` on shared-server) | Sessions [measured] |
|---|---|---|
| shared-server | runs the server (`app-bb`, :38886) and an enrolled host, `host_i9hvsvifpv` | 12 project dirs, 109 MB; the largest file 26.6 MB |
| popemkt-work (this Mac) | enrolled host `host_cfbmqyghu2`, connected | 87 project dirs, 196 files, 5.7 GB; 34 over 10 MB, 12 over 25 MB, the largest 160 MB |
| popemkt-personal | enrolled host `host_v56deucqgh`, connected | not inspected |

- The plugin's **server** half runs inside `app-bb` on shared-server. Its **host** half runs in each machine's daemon
  when it is called with that `hostId`. That gives one plugin install with every machine's sessions, and nothing
  syncs session files between machines. bb-plugins-sync installs it on every host's bb server as usual; the Mac
  desktop app only needs it when it talks to its own server.
- Projects already map to every machine. `.dotfiles` (`proj_wnk8rgxnpw`) has a source on each of the three hosts:
  `/Users/popemkt/.dotfiles` on both Macs and `/home/popemkt/.dotfiles` on shared-server. [measured, `bb project show`]
- bb's own Claude threads write sessions into the same `~/.claude/projects`. Some project dirs are bb workspaces,
  e.g. `-home-popemkt--bb-plugins-environment-git-worktree-host-data-worktrees-thr-…`, and T3 Code's
  sessions are there too. All of these have `entrypoint: "sdk-ts"`; an interactive CLI session has `"cli"`. [measured]

## 4. What a session holds, measured

Record types in one 26.6 MB session (structure only): `assistant` 2204, `attachment` 1476, `user` 1262,
`api-request-blob` 1170, `api-request` 1087, `queue-operation` 452, `last-prompt` 441, `ai-title` 427, `system` 11,
and others. Content parts are `tool_use`/`tool_result` 1015 each, `thinking` 787, `text` 402, `image` 5. Most of
the file is request blobs and tool output, not conversation. [measured]

Main-chain sizes in tokens (characters ÷ 4) on six shared-server sessions; the script is not committed:

| Raw | User msgs | Tool calls | Compactions | Text only | Text + one line per tool call | Tool output (dropped) |
|---|---|---|---|---|---|---|
| 1.7 MB | 15 | 71 | 0 | 7k | 10k | 32k |
| 2.3 MB | 36 | 51 | 0 | 11k | 13k | 36k |
| 2.8 MB | 3 | 173 | 0 | 6k | 14k | 58k |
| 3.9 MB | 54 | 88 | 0 | 18k | 22k | 43k |
| 18.6 MB | 10 | 839 | 4 | 13k | 48k | 596k |
| 26.6 MB | 20 | 67 | 1 | 12k | 15k | 226k |

Together with the 4.1 MB session measured on 2026-10-23 (30k text, 90k with tool calls and output), this gives the
rule of thumb: **text plus one line per tool call fits in about 50k tokens for nearly every session**, and tool
output is the part to drop. A session with many tool calls is the exception (48k above).

## 5. Prior art: T3 Code

T3 Code's importer is part of its core, which is option D below (`pingdotgg/t3code`,
`apps/server/src/project/AgentSessionImporter.ts`, `AgentSessionScanner.ts`). It scans sessions whose cwd matches
the project's `workspaceRoot` and stores `resumeCursor: { resume: <claude session id> }`, which gives native resume.
It also writes the conversation as message events: **text blocks only, at most the last 200 messages**. It skips
`isSidechain`, `isMeta` and `isCompactSummary` records and caps scans by bytes and records. Its id
`import:<instance>:<sessionId>` makes a re-import a no-op. [code] Three choices carry over: match on cwd, keep text
and drop tool output, and key the dedupe on the session id. Native resume does not carry over, because it needs core.
The community tools named in the earlier thread (t3-port, t3-import, t3code-import) did not turn up in a search. [measured]

## 6. Options

| | What | Plugin only? | Effort | Timeline | Context in the new thread |
|---|---|---|---|---|---|
| A | Seed a new thread with the cleaned transcript | yes | ~2 d | old turns not in it | transcript, within a budget |
| **A+** | A, plus an "Original session" panel that renders the source session read-only from its host | yes | **~3 d** | old turns beside it, in a panel | same as A |
| B | Write bb.db directly | no (unsupported) | — | — | rejected: races the running server |
| B′ | "Transplant": let the thread run a first turn, then rewrite that turn's Claude session file to include the imported history | yes, but writes provider state bb owns | ~2 d + fragility | none | native, until it breaks: bb keeps a resident Claude process, so a rewrite under it is ignored or lost. Rejected |
| C | Core: `threads.adopt` / create with a provider session id (#3260), Claude part only | no, bb core PR | 3–5 d + review, merge date unknown | starts at adoption | native, same host and cwd only |
| D | C, plus converting Claude JSONL into bb timeline events | no | C + 2–4 d | full | native |

C and D only work on the machine and in the directory where the session lives. Claude finds a session by its
project dir, and even `forkSession` writes the fork into the source's project dir (`provider-claude-code/dist/host.js`).
A and A+ work across machines and providers: a Mac session can continue on shared-server, or in a Codex thread. So
seeding is not a stopgap copy of adoption. It is a separate capability, a handoff, which stays useful after #3260
lands.

## 7. Recommended design (A+)

### 7.1 Rule 1

The concept is **an outside agent session, made continuable in bb**. Nothing in the repo owns it today:
agent-artifacts owns the inventory of what feeds an agent, context-composer owns composition, and restart-resume
owns bb's own interrupted threads. None of them reads Claude transcripts. So this is a new plugin, not an addition
to agent-artifacts, even though both run the Agent SDK in a host entry. Only the SDK dependency is shared, not a
concept. The session format belongs to Claude Code. The host entry therefore reads it through the Agent SDK
(`listSessions`, `getSessionMessages`) and does not keep a second JSONL parser. That is a bridge, not a mirror. A
hand-written streaming reader is the fallback, and only if spike S1 fails.

Only Claude Code is in v1. A Codex reader would later be a second implementation of the same reader port
(`list`, `read` → a neutral transcript), with one contract test over both. The port is not built until there is a
second reader, because a seam with one implementation that no code path varies is a dead seam.

### 7.2 Shape

```
assets/bb-plugins/session-import/
  package.json        bb: server, app, host; deps: @anthropic-ai/claude-agent-sdk, zod
  contract.ts         host RPC: listSessions, readTranscript, renderOriginal (zod in and out)
  host.ts             Agent SDK on the machine that holds the sessions; writes the full transcript file
  core/transcript.ts  pure: SessionMessage[] → Transcript (turns, tool lines, compaction) → markdown within a budget
  server.ts           machines, project mapping, dedupe, spawn, `bb session-import` CLI, RPC for the app
  app.tsx             New-thread panel action (picker), thread panel action (Original session)
  skills/session-import/SKILL.md
  tests/
```

`core/` has no host or SDK imports, so it is tested with fixtures, the same rule as context-composer's `core/`.

### 7.3 UX

1. **New thread → right panel → "Import Claude Code session"** (`experimental_newThreadPanelAction`). The picker
   lists sessions from every connected machine, newest first, from the last 30 days by default (an "All" toggle
   removes the limit). Each row shows the title (`customTitle`, else summary, else first prompt), machine, cwd,
   branch, age, size and the estimated tokens after cleaning. Badges: **in bb** for sessions a bb thread already
   owns, **imported → thread** for this plugin's own imports, **CLI** or **SDK** from `entrypoint`. Search covers
   title, first prompt and cwd.
2. **Selecting a row** opens a preview: the first and last few messages; the budget plan (e.g. "12 turns full, 31
   condensed, tool output dropped, 38k tokens"); the target, i.e. the mapped project, machine and directory (all
   editable), provider (default Claude Code) and model; and an optional **first message**.
3. **Import** spawns the thread and opens it. Its title is `↪ <session title>`. The first turn sends a short preamble
   and the transcript, both `agent-only`, then the person's first message. Without a first message, the turn is
   "Summarise where this session stood in at most 5 lines, then wait", so the person sees right away that the
   handoff worked. The original session file is never written.
4. **On an imported thread, "Original session"** (`threadPanelAction`) renders the source session read-only: every
   turn, tool calls as rows, tool output fetched from the host when a row is expanded. These are the old turns the
   timeline cannot hold.
5. **`bb session-import`** for agents and terminals: `list [--machine] [--since 30d] [--cwd]`, `show <id>`, and
   `import <id> [--machine <target>] [--project] [--prompt-file]`, with bounded output. A native agent tool is left
   out of v1. It would add tool weight to every thread, and the CLI already serves agents.

### 7.4 Conversion

The host entry reads the main chain with `getSessionMessages` (with system messages, to see compaction boundaries).
`core/transcript.ts` then turns it into markdown:

- `## User · <time>`: the text in full. Images become `[image]`. `isMeta` injections (system reminders, skill
  bodies) are dropped; a slash command is kept as `/name args`.
- `## Claude`: text in full. Thinking is dropped. Each tool call is **one line**: the tool name and one key
  argument, e.g. `Bash: git status` (a command is cut at 120 characters), `Edit: modules/x.nix`,
  `Grep: "pattern" in path`, `Agent(general-purpose): <description>`. A call that failed gets `(failed)` appended.
  Tool output and sidechains (subagent transcripts) are dropped.
- A header with machine, cwd, branch, model, session id and the time span. The preamble tells the agent that this
  continues a session started outside bb, that files may have changed since, not to redo finished work, and that
  the full transcript is in the attached file.

### 7.5 Size

The default budget is **40k tokens**, a plugin setting. Over budget, cuts apply in this order, stopping as soon as
the transcript fits:

1. Everything before the latest compaction is replaced by **Claude Code's own compaction summary**. That is
   already what the session itself remembers, so the plugin reuses it and does not summarise again.
2. Tool lines are dropped from all but the last 10 turns.
3. The first user message (the task) is kept, then the newest turns that fit. The gap reads
   `[N turns omitted; see the full transcript]`.

The host always writes the **full** cleaned transcript, without a budget, to
`<plugin dataDir>/transcripts/<sessionId>.md` on the **target** machine. It is passed as a `localFile` input, so the
agent can read omitted turns when it needs them. v1 has no model-written summary: no extra model call, no extra
cost, nothing that is not in the record. A summary through `bb.experimental_aiServices` can be added later if cut 3
turns out to lose too much.

### 7.6 Directory, environment and machines

- **Same machine (default):** the project is the one whose source on that host contains the session's cwd, or, for
  a git worktree, whose `gitRemoteUrl` matches the cwd's origin (looked up through the host entry). The environment
  is `host` + `unmanaged` at the exact cwd, so the agent sees the same files as before. If the cwd is gone, or bb
  refuses it (a path inside bb's data dir, e.g. an old bb worktree), the thread falls back to the project's default
  environment on that host.
- **Another machine:** the same project's source on the chosen host, in its default environment. Uncommitted work
  on the source machine is not there. The preview says so.
- **No matching project:** the person picks a project; the cwd is kept only as text in the transcript header.
- **Machines:** every connected host is listed. A host that is offline is shown, greyed out. Reading happens on the
  session's host. The transcript file is written on the target host.

### 7.7 Storage and dedupe

The plugin's KV store holds `imports: sessionId → [{ threadId, importedAt, sourceHost, sourceMtime }]`. A
re-import is allowed but the picker warns about it. If the session has grown since (`lastModified` is newer), the
badge says "N new turns". For **in bb**, an index of `providerThreadId → threadId` is built lazily: Claude Code
threads come from `threads.list`, and each one's id comes from one `events.list(types: ["thread/identity"])`. The
index is cached in storage and only extended for new threads. The thread's own `pluginMetadata`
(`{ source: "claude-code", hostId, sessionId, cwd, transcriptPath }`) is what the Original session panel reads.

### 7.8 Native adoption later

The build commit adds a `#gap` node. Expected: an imported Claude session continues natively in bb, with
identity, resume and fork. Current: a handoff seeded with the transcript. Closes: bb ships #3260
(`threads.adopt` or equivalent). Then `import` on the **same machine** switches to adoption, while the cross-machine
and cross-provider handoff stays. The Original session panel stays useful either way. When adoption lands, the
`import` step decides adopt or seed by one fact, whether the target is the session's own host and cwd. That
decision belongs to the import step.

## 8. Test plan

- **core (unit, fixtures):** small synthetic JSONL fixtures, not copies of real sessions. They cover a plain
  session; a rewind or branch (two children of one `parentUuid`); compaction (boundary plus summary); sidechains;
  `isMeta` reminders and slash commands; images; failed tool calls; and one of each tool shape. Snapshot the
  markdown. Budget tests: under budget unchanged, then each cut in order, and the first user message is always kept.
- **host (Node, temp `HOME` / `CLAUDE_CONFIG_DIR`):** `listSessions` over a fixture `projects/` tree; that
  `readTranscript` output stays under 8 MiB; that the transcript file is written only under the plugin's dataDir;
  that `~/.claude/projects` file mtimes and hashes are unchanged after list and read.
- **server (bb's fake plugin host, `@get-bb/plugin-sdk/testing`, as context-composer does):** project mapping
  (same host, worktree by remote, another host, none, refused path); the exact `threads.spawn` arguments
  (environment, agent-only input order, `localFile`, `pluginMetadata`, title); dedupe records; the in-bb index; and
  CLI output bounds.
- **live, on shared-server** (installed from a worktree with `bb-plugins-sync --path`, no restart of `app-bb` or
  the daemon):
  1. Import a shared-server `.dotfiles` session. The thread runs in the same cwd and answers a question only the
     history can answer.
  2. Import a Mac (`popemkt-work`) session into a thread on shared-server. The listing comes over the Mac's
     daemon, and the transcript file lands on shared-server.
  3. Import the 160 MB Mac session (spike S1).
  4. Open Original session on both threads.
  5. Confirm with sha256 before and after that no source session file changed.

## 9. To verify in the build (spikes)

- **S1, reader memory:** peak RSS of `getSessionMessages` on a 160 MB file. Use a synthetic file on shared-server
  first, then the real one on the Mac, where memory is short. If it is too high, the fallback is a line-streaming
  reader in the host entry that keeps only `uuid`, `parentUuid` and condensed text. That reader would be the
  reader port's second implementation, so it joins the shared contract tests.
- **S2, compaction through the SDK:** check whether `getSessionMessages` crosses the compaction boundary or returns
  only the post-compaction chain. Cut 1 needs the summary record either way.
- **S3, a large agent-only input:** check that a 160 KB agent-only text part is accepted by spawn and reaches Claude
  intact. No cap was found in the contract, but none was looked for in the bridge.
- **S4, `localFile` outside the cwd:** check that the agent can read the transcript file in the plugin's dataDir
  without a permission prompt, in the thread's permission mode. If it cannot, write the file under the thread's
  storage path (`threads.storagePaths`) after spawn, and send the reference as the first queued message instead.
- **S5, version skew:** the Mac's daemon (app 0.47.0) has to run a host entry served by the 0.46.1 server.
  agent-artifacts is evidence that it does, but this was not checked for a new plugin.

## 10. Open questions for the owner

1. **Handoff now, or wait for native adoption?** Recommended: build A+ now (about 3 days). Native resume is a named
   gap that closes with upstream #3260. The other choice is to contribute the Claude Code part of #3260 to bb
   (`threads.adopt` with a session id, validated by a real resume; about 3–5 days of work in the bb monorepo plus
   maintainer review, with no known merge date) and build only a thin picker on top. Both can be done. The
   question is which comes first, and whether you want to comment on or contribute to #3260 under your account.
2. **Default target machine for a Mac session.** Running the imported thread on the Mac keeps the exact cwd and any
   uncommitted work, but it uses the Mac's memory. Running it on shared-server is lighter, but it gets the
   project's committed state only. The design defaults to the session's own machine and lets you change it per
   import. Say if shared-server should be the default instead.
