# Builder.io agent-native: research report and what kb should take from it

Date: 2026-09-29. These are the sources I read:

- **Repository:** `BuilderIO/agent-native`, shallow-cloned at commit `1f9480996dad` (2026-09-29 09:23 -0700) into `scratchpad/agent-native`.
- **npm:** `@agent-native/core` 0.196.0 (latest; a nightly is at 0.197.0), `@agent-native/agentkit` 0.5.0 and `@mcp-b/webmcp-polyfill` 5.1.0.
- **WebMCP spec:** `webmachinelearning/webmcp` at `19fc565`, cloned into `scratchpad/webmcp-spec`.

Paths are relative to `packages/core/src/` unless shown otherwise. Detailed notes are in the same scratchpad: `q2-webmcp.md`, `q3-sidebar.md` and `q4-db.md`.

---

## 1. What agent-native is

agent-native is an MIT-licensed TypeScript framework for full-stack apps. In each app, one `defineAction()` is the single implementation of a capability. The UI calls it from code, and the built-in agent calls it as a tool. The framework also exposes it over HTTP, MCP, A2A, WebMCP and the CLI (README; `docs/content/actions-overview.mdx`).

Builder's own write-ups say the same thing: "Agent-Native: The Next Architecture for Software" (V. Gopinath, 2026-05-08, https://www.builder.io/blog/agent-native-architecture) and "How to build agent-native applications" (S. Sewell, 2026-04-21, https://www.builder.io/blog/agent-native-apps). Their summary is: "Define the action once… UI mutation, agent tool, HTTP endpoint, CLI command, and MCP tool". The architecture post adds: "The database is the coordination layer between the human interface and the agent."

### Packages (pnpm monorepo)

- **`@agent-native/core` (MIT)** is a very large package with about 300 export subpaths: actions, server, client UI, db, MCP, A2A, agent engine, CLI and more.
- **`@agent-native/agentkit` 0.5.0 (MIT)** is a provider-neutral chat protocol, an HTTP/SSE adapter and a React client.
- Other public packages: `toolkit`, `dispatch`, `scheduling`, `skills`, `embedding`, `code-agents-ui`, `pinpoint`, `recap-cli`, `migrate`, `creative-context`.
- Private packages: the desktop app (Electron), mobile app, Chrome extension and `frame`.
- `templates/` holds whole example apps: mail, calendar, analytics, slides, design, clips, content, crm, forms, tasks, plan and others.

### The core type (`action.ts`)

```ts
export type ActionCaller = "tool" | "http" | "frontend" | "cli" | "mcp" | "webmcp" | "a2a" | "automation";   // :21

defineAction({
  title?, description, schema: StandardSchemaV1 /* or legacy `parameters` */, agentInputSchema?, outputSchema?,
  run(args, ctx?: ActionRunContext),
  http?: { method?: "GET"|"POST"|"PUT"|"DELETE"; path? } | false,
  readOnly?, uiOnly?, agentTool?, mcpTool?, deferLoading?, parallelSafe?, endsTurn?, dedupe?,
  needsApproval?: boolean | ((args, ctx) => boolean|Promise<boolean>), allowPersistentApproval?,
  authorize?, access?, audit?, publicAgent?, planMode?, capabilityScopes?,
  link?, mcpApp?, chatUI?, timeoutMs?, maxResultChars?,
})                                             // DefineActionWithSchema :310-462
→ ActionDefinition { run, tool: { title?, description, parameters: JSONSchema }, ...flags }   // :464
```

`ActionRunContext` (`:37`) carries `caller`, `userEmail`, `orgId`, `threadId`, `runId`, `toolCallId`, `signal`, `send(event)` and network hints such as `networkProtocol: "a2a"|"mcp"|...`.

`defineAction` does the following once, when the action is defined:

- converts the Standard Schema to draft-07 JSON Schema through `~standard.jsonSchema.input`, falling back to a zod-internals converter (`schemaToJsonSchema` `:980`);
- wraps `run` with `authorize`/access, then input validation, then output validation, then audit, then tracking (`:517-640`).

Because the wrappers sit on `run` itself, every caller goes through the same gates. The docstring says why: "a flag consulted by the dispatcher only guards the dispatchers that remember to consult it".

Exposure rules also live in one place. `isActionExposedToExternalAgents` (`:732`) is read by every external surface, and `isActionHiddenFromEveryAgentSurface` is at `:747`.

### Registry

The registry type is `Record<string, ActionEntry>`, with `ActionEntry` defined at `agent/production-agent.ts:944`.

- It is built by scanning a flat `actions/` folder, where the file name is the action id: `autoDiscoverActions` (`server/action-discovery.ts:374`).
- It can also be built from a generated static map: `loadActionsFromStaticRegistry` (`:333`).
- Package and workspace-core actions are merged in afterwards.
- The agent-chat plugin assembles one combined registry of app actions, framework tool groups, remote MCP tools and browser tools (`server/agent-chat-plugin.ts:~2000-2060`). The protocol adapters listed below all project from that registry.

### Protocols it exposes

| Surface | Mechanism | Where |
|---|---|---|
| In-app agent tool | `ActionEntry.tool` goes into the engine tool list; `executeAgentToolCall` calls `run` | `agent/production-agent.ts:3310, 3381` |
| UI | `useActionQuery` / `useActionMutation` / `callAction` fetch `/_agent-native/actions/<name>` | `client/use-action.ts:693, 887`; `server/action-routes.ts:103, 1040` (`mountActionRoutes(nitroApp, actions)`) |
| HTTP/REST | Same route, which external clients can also call; `http.method` sets the verb (GET implies `readOnly`) | `action-routes.ts` |
| MCP over Streamable HTTP | `mountMCP(nitroApp, config)` serves `/mcp` and `/_agent-native/mcp`; `createMcpHandler` from `@modelcontextprotocol/server` 2.0.0 runs in stateless mode; `tools/list` maps each entry to `{name, inputSchema: mcpToolInputSchema(...)}`. It adds catalog tiers (compact, connector or full), a `tool-search` tool, OAuth, and MCP Apps (`ui://` resources through `mcpApp`) | `mcp/server.ts:337, 321`; `mcp/build-server.ts:86 (MCPConfig), 1438, 1779` |
| MCP over stdio | `runMCPStdio`. Its default mode is a **proxy** to the running app's HTTP MCP. A `standalone` mode discovers actions from disk and serves them over stdio | `mcp/stdio.ts:227, 180-215` |
| A2A (protocol 0.3, JSON-RPC `message/send`, `message/stream`, `tasks/get`, and so on) | Agent card at `/.well-known/agent-card.json`; skills are built from the exposed actions. **`message/send` goes to the in-app agent (an LLM turn)**, not straight to an action. Direct action calls are allowed only for exposed **read-only** actions (`executeReadOnlyAction`); anything with side effects has to go through the natural-language path | `a2a/agent-card.ts:5`; `a2a/handlers.ts:1300+`; `server/agent-chat-plugin.ts:2107-2160` |
| WebMCP | Manifest and invoke routes on the server; the page registers the tools with `document.modelContext.registerTool` (see §2) | `server/action-routes.ts:1105` (`mountWebMcpActionRoutes`); `client/webmcp.ts` |
| CLI | `agent-native action <name> '{json}'` (or `pnpm action`) spawns `tsx actions/run.ts`, which calls `runScript()` | `cli/index.ts:598-611` |
| Agent-readable web (not action RPC) | `llms.txt`, markdown pages, JSON-LD, robots and sitemap generators | `agent-web/` |

To sum up: there is one registry of `ActionEntry` records, and each protocol has a thin adapter that projects from it. Exposure policy is decided by shared predicates rather than separately at each surface. This is the same "one contract, many adapters" shape that kb already follows.

---

## 2. WebMCP

### The proposal

- **Spec:** "WebMCP", a Draft Community Group Report of the W3C Web Machine Learning CG dated 29 Sep 2026. Editors are B. Walderman (Microsoft), K. Sagar and D. Farolino (Google). https://webmachinelearning.github.io/webmcp/
- **The API shape changed during 2026, so many 2025 write-ups are out of date:**
  - `provideContext()` and `clearContext()` were removed on 2026-03-05 (#132).
  - `unregisterTool()` was removed on 2026-03-27 (#156). You now unregister by aborting the `AbortSignal` passed to `registerTool`.
  - `modelContext` **moved from `navigator` to `document`** in May 2026 (#177, #184).
  - `ModelContextClient` and `requestUserInteraction` were removed on 2026-06-11 (#205).
  - `getTools()` was specified in July 2026 and `executeTool()` in August 2026.
- **Current IDL, summarised:**

```webidl
partial interface Document { [SecureContext, SameObject] readonly attribute ModelContext modelContext; };
interface ModelContext : EventTarget {
  Promise<undefined> registerTool(ModelContextTool tool, optional { sequence<USVString> exposedTo; AbortSignal signal; });
  Promise<sequence<RegisteredTool>> getTools(optional { fromOrigins });
  Promise<DOMString> executeTool(RegisteredTool tool, optional any input, optional { signal });
  attribute EventHandler ontoolchange, ontoolactivated, ontoolcancel;
};
dictionary ModelContextTool { required DOMString name; USVString title; required DOMString description;
  object inputSchema /* JSON Schema */; required ToolExecuteCallback execute; ToolAnnotations annotations; };
dictionary ToolAnnotations { readOnlyHint; untrustedContentHint; consequentialHint; debugging; };
```

- **Tool names:** 1 to 128 characters from `[A-Za-z0-9_.-]`, so kb's dotted ids like `ext.canvas.tx.apply` are legal.
- **Permissions:** access is controlled by a Permissions Policy feature called `tools`, which defaults to `self`. A cross-origin iframe needs `allow="tools"`.
- **Consent:** there is no longer a user-interaction API. `consequentialHint` is the hint that tells the browser or agent to require confirmation.
- **Declarative API:** the spec section is still a TODO. An explainer proposes `<form toolname tooldescription toolautosubmit>` together with `SubmitEvent.respondWith()`.
- **Chrome** (chromestatus feature 5117755740913664, updated 2026-09-28):
  - Dev trial from M146. Turn it on with `chrome://flags/#enable-webmcp-testing` (https://developer.chrome.com/docs/ai/webmcp).
  - **Origin trial M149–M156**, announced 2026-06-09 (https://developer.chrome.com/blog/ai-webmcp-origin-trial). The declarative form API is included in the same trial.
- **Other browsers:** Edge has an origin trial in 150. Firefox and Safari have given no signal.
- **Summary:** WebMCP is not shipped by default in any stable browser. It is an origin-trial and polyfill technology.

### How agent-native implements it (`client/webmcp.ts`, `server/action-routes.ts`)

- **Feature detection and polyfill.** It reads `document.modelContext` (`webmcp.ts:149`). If that is absent, it calls `initializeWebMCPPolyfill` from `@mcp-b/webmcp-polyfill` ^5.1.0 (MIT, WebMCP-org). The polyfill stays inside the page and also keeps a deprecated `navigator.modelContext` alias.
- **Server side.** `mountWebMcpActionRoutes(nitroApp, actions)` (`:1105`) adds two routes:
  - `GET /_agent-native/webmcp/manifest` serves the manifest. Signed-in callers get it through cookies; anonymous callers see only public read-only actions.
  - `POST /_agent-native/webmcp/actions/:name` (also served as `/mcp/tool/:name`) runs the action through the same validated dispatcher, with `caller: "webmcp"` (`:1215`).
  - The same exposure predicate as MCP decides which actions appear; there is no separate WebMCP list.
- **Manifest shape.** `buildWebMcpCompatibilityManifest` (`:1047`) produces `{protocol:"WebMCP", tools:[{name, title, description, inputSchema, endpoint, method:"POST", readOnly, requiresAuth}], endpoints:{mcp, httpTools, a2a}}`. Here `inputSchema` is `ActionEntry.tool.parameters`, the same JSON Schema the agent and MCP use.
- **In the page.**
  - Once the session is authenticated, `AppProviders` fetches the manifest.
  - Each tool is registered with `registerTool({name, title, description, inputSchema, annotations:{readOnlyHint}, execute})`. `execute` POSTs to the server and then dispatches `refresh-data` so the UI repaints.
  - Page-only client tools use `createAgentNativeWebMcpRegistration`. It sets bounds: at most 100 tools, a 50k schema and a 500k manifest. It **refuses to register destructive or approval-required tools unless an `approve` handler is supplied**.
- **Approval.** WebMCP has no way to carry an approval. When an action has `needsApproval`, the server evaluates it against the actual arguments and returns a 409 `approval_required`, which tells the caller to confirm in chat.
- **Spec gaps:**
  - `consequentialHint` is never set.
  - `toolactivated` and `toolcancel` are ignored.
  - The declarative `<form>` API is not implemented.
- **Helper for outside agents.** `window.__agentNativeWebMcp` (`installAgentNativeWebMcpPageHelper`, `:1066`) exposes `ready`, `tools`, `call` and `result` for agents that drive the page through CDP or evaluate calls, such as Claude Code or Codex. The optional `@mcp-b/webmcp-local-relay` bridges page tools to a local MCP host.
- **How the sidebar agent uses page tools.** The agent runs on the server. It reaches page tools by writing requests to a **database-backed queue**:
  - The server tools are `list-browser-session-webmcp-tools` and `run-browser-session-webmcp-tool`. The second has `needsApproval: () => true` (`browser-sessions/actions.ts:204-300`).
  - The live tab's `client/browser-session-bridge.ts` polls every 500 ms, claims a request, runs `getTools`/`executeTool`, and posts the result back.
  - The app's own actions do **not** go through WebMCP; the agent calls the registry directly.

---

## 3. The sidebar agent

- **Where it runs.** The loop runs on the server, and the browser only renders it.
  - `AgentSidebar` (`client/AgentSidebar.tsx:329`) is built with `@assistant-ui/react` and the AgentKit client.
  - It POSTs `{message, threadId, model, engine, effort, attachments, approvedToolCalls, harness?}` to `/_agent-native/agent-chat`.
  - That route belongs to a Nitro/h3 plugin (`server/agent-chat-plugin.ts`, 8.1k lines). Its sub-routes are `/threads`, `/runs`, `/save-key`, `/mode`, `/skills`, `/checkpoints` and `/stream-token`.
  - The plugin calls `runAgentLoop` (`agent/production-agent.ts:4484`), which in turn calls `executeAgentToolCall` and then `ActionEntry.run`.
- **Tools.** One `ActionEntry` registry, fronted by a `tool-search` meta-tool; only `initialToolNames` go into the first request. It contains:
  - the app's actions;
  - framework groups: resources, docs, db, chat, automation, fetch, web search, run-code, and others;
  - **remote MCP servers** from `mcp.config.json` or settings, over stdio or HTTP, scoped per user and org, and prefixed `mcp__` (`mcp-client/config.ts`);
  - browser and WebMCP session tools, which use the DB queue described above.
  - In **dev mode**, the app's own actions are not native tools. The agent reaches them through bash or the CLI.
- **Model providers.** `interface AgentEngine { name; defaultModel; supportedModels; capabilities; stream(opts): AsyncIterable<EngineEvent> }` (`agent/engine/types.ts:209`). An engine does one round trip; the loop owns the tools.
  - Built-in engines: the **Builder.io Gateway** (the default when Builder keys are present), native `@anthropic-ai/sdk`, AI SDK v6 providers (anthropic, openai, openrouter, google, groq, mistral, cohere, ollama), and an experimental ChatGPT-subscription engine.
  - Selection: `AGENT_ENGINE`, `AGENT_MODEL`, `AGENT_ENGINE_PREFER_BYO_KEY`, or per-user keys saved through `/save-key`.
  - `OPENAI_BASE_URL` and `OLLAMA_BASE_URL` can point at a local proxy such as CLIProxyAPI or LiteLLM.
- **Using a local Claude.** There are four mechanisms, and none is on by default in the stock sidebar:
  1. **Harness adapters** (`agent/harness/`):
     - `ai-sdk-harness:claude-code` via `@ai-sdk/harness-claude-code`;
     - ACP `acp:claude-code`, which spawns `npx @zed-industries/claude-code-acp` as a stdio JSON-RPC subprocess and uses the local `claude` login.
     - Both can receive a narrow set of app actions as host tools, and resume state is stored in SQL.
     - This is a host-author API; the stock sidebar route does not call it.
  2. **"Hosted harness" picker.** Choosing `claude-code`, `codex`, `pi` or `opencode` only strips shell and file tools and adds a "tools-only" prompt.
  3. **Agent-Native Code / Desktop** spawns `claude --print --output-format stream-json --strict-mcp-config …` (Claude Code version pinned to 2.1.208, after checking `claude auth status`). That session gets file tools only, not app actions (`cli/claude-code-participant.ts`). A relay lets a hosted app send runs to your laptop.
  4. **BYO chat runtime.** `createClaudeAgentChatRuntime` / `createHttpAgentChatRuntime` (`client/chat/connectors.ts:1557`) let your own endpoint stream normalised SSE or NDJSON events into the same sidebar. That endpoint could be a local Claude Agent SDK server pointed at the app's MCP. **This is the cleanest way to use a local Claude.**
- **Streaming.** A custom SSE protocol of `AgentChatEvent` (`agent/types.ts:359`): `text`, `thinking`, `tool_start`, `tool_done`, `approval_required`, `agent_call*`, `done`, and so on. It is *not* the AI SDK UI message stream.
  - Events are persisted in `agent_run_events(run_id, seq)`, and a client reconnects with `GET /runs/:id/events?after=N`.
  - AgentKit has its own versioned SSE protocol with append-only, contiguous `seq` numbers.
- **Approvals.**
  - When `needsApproval` is true, the loop emits `approval_required{approvalKey}`, stores a pending row in `agent_tool_approvals`, and ends the turn.
  - The card offers Approve, Deny, Edit and Always allow. Approve re-submits with `approvedToolCalls`, which the server checks against its own table. Always allow calls the `set-tool-approval-policy` action and is stored per user and per tool.
  - Plan mode allows only read-only or `allowInPlanMode` actions.
- **Persistence.** `chat_threads` (the whole thread as JSON), `agent_runs`, `agent_run_events`, `agent_tool_ledger` and harness `resumeState` are all SQL tables.

---

## 4. Data and database requirements, and how tightly it is coupled

- **Storage.** Drizzle on **PostgreSQL only**.
  - `db/client.ts:1417-1419` throws `"DATABASE_URL must be a PostgreSQL URL or a pglite: URL."`
  - Drivers: PGlite (the dev default `pglite:./data/pglite`), postgres.js and Neon serverless.
  - Nothing supports SQLite, libsql, Turso or D1; the schema helpers re-export `drizzle-orm/pg-core`.
  - The docs say: "Every agent-native app stores its state in PostgreSQL" (`docs/content/server-database.mdx:11`). PGlite is not for production, except in embedded or desktop hosts.
- **The database is mandatory for the framework.**
  - `agent-surfaces.mdx:488-491`: "This is not a no-database or stateless mode."
  - The framework creates **about 150 tables** at runtime, including `chat_threads`, `application_state` (current screen and navigation), `settings`, `resources` (skills, memory, AGENTS.md), `agent_runs`, `agent_run_events`, `agent_tool_approvals`, `oauth_tokens`, `mcp_oauth_*`, `mcp_action_approvals`, the better-auth tables, org and SCIM tables, and the browser-session queue.
  - Live UI sync also runs through the DB: an SSE or poll feed over a change log.
- **Domain data can live elsewhere.** An action is just `run(args, ctx)`, and `action.ts` imports no DB client. kb's JSONL or SQLite port could sit behind actions.
  - What kb would give up: DB-change-driven UI sync and the `owner_email`/`ownableColumns` scoping.
  - What kb would still need: a Postgres or PGlite database for the framework's own tables, since those cannot go behind kb's store port.
- **Server and framework stack.**
  - Nitro `3.0.260610-beta` and h3 `^2.0.1-rc.20` are hard dependencies, and both are pre-release.
  - A Vite plugin `agentNative()` wraps `nitro/vite`.
  - React Router ≥8 in framework mode; React ≥19.2.7.
  - Pinned versions: `better-auth` 1.7.4 and `@modelcontextprotocol/server` 2.0.0.
  - Deploy targets are Nitro presets: node, netlify, vercel, cloudflare, deno, aws-lambda.
- **Embedded mode.** `createAgentNativeEmbeddedPlugin` / `mountAgentNativeEmbedded(nitroApp, {databaseUrl, auth, actions, agentChat})` (`server/embedded.ts:158, 221`).
  - It still needs a Nitro app and Postgres or PGlite, and it sets `process.env.DATABASE_URL`.
  - It is not a generic `(Request) => Response` handler you could mount on kb's Bun server.
- **Headless mode.** `--headless` scaffolds only actions and the CLI, but still expects a database.
- **Parts that come apart cleanly:**
  - `@agent-native/agentkit`: `createAgentKitHttpHandler(opts): (req: Request) => Promise<Response>` (`packages/agentkit/src/adapters/http.ts:927`) plus the React `<AgentChat transport>`. It needs no DB and no provider; the host supplies auth, persistence and runtime. Its dependencies are `@ag-ui/core` 0.0.59, react-markdown, tabler icons and `@agent-native/toolkit`.
  - `@mcp-b/webmcp-polyfill`.
  - The MCP server, A2A server and full sidebar do **not** come apart: each is tied to Nitro, h3 and Postgres.

**Is this a deal breaker for kb?** Yes, if kb adopts it wholesale. kb's store port (JSONL and SQLite, "one contract, every implementation") would become one of two stores, and the second one (Postgres) would be forced on it. kb would also have to host Nitro and React Router instead of its own Bun HTTP/WS server. That breaks Rule 1 by creating a parallel store and a parallel action registry beside kb's.

---

## 5. License, maturity and gotchas

- **License.**
  - Every published package declares **MIT** in `package.json`, and the README says MIT.
  - The **repository has no LICENSE file**: GitHub's `license` field is null and the root `package.json` says `"ISC"`. The license text only exists in the published npm packages.
- **Maturity** (GitHub API, 2026-09-29):
  - About 6.9k stars and 626 forks. Created 2026-03-12; last push 2026-09-29. About **6,409 commits** in 6.5 months; roughly half are by `steve8708` (Steve Sewell) and about 1,400 by bots.
  - 111 open issues. `@agent-native/core` has **1,720 published versions** from 0.1.0 (2026-03-12) to 0.196.0.
  - Release cadence is several per day across packages. Still 0.x, with no stability guarantee.
- **Gotchas:**
  - Very large surface area: core has about 300 exports, and `agent-chat-plugin.ts` and `production-agent.ts` are 8k and 10k lines. It is heavily Builder-oriented: the Builder gateway is the default engine, and Builder connect, design systems and analytics are built in.
  - Hard dependencies on pre-release Nitro and h3, pinned `better-auth` and MCP SDK 2.0.0.
  - Postgres or PGlite is required even when your domain data lives elsewhere.
  - In dev mode the agent reaches app actions through bash or the CLI instead of native tools, so behaviour differs between dev and prod.
  - MCP catalog tiering means external agents get a *compact* catalog by default, and the full surface only on opt-in (`AGENT_NATIVE_MCP_FULL_CATALOG=1`).
  - A2A does not call arbitrary actions directly. Only read-only ones work that way; writes go through an LLM turn.
  - WebMCP support follows the current spec but leaves out `consequentialHint` and the lifecycle events. WebMCP itself is only in an origin trial and behind flags.
  - JSON Schema is derived through Standard Schema's `~standard.jsonSchema`. A schema vendor without that extension gets zod-internals handling or an empty `{type:"object", properties:{}}`, so tools lose their parameters silently.
  - Action ids are file names in a flat `actions/` folder, which has no namespacing like kb's `ext.canvas.*`.

---

## 6. Adoption options for kb

What kb already has, from reading `tools/kb`:

- `ActionDefinition { id, title, description, mode: "read"|"apply", inputSchema, outputSchema (Standard Schema), effect? }` and `ActionReceipt` (`packages/contract/contracts/src/actions.ts`).
- A registry with `manifestEntries` (`packages/app/runtime/src/registry.ts`).
- An MCP server that already projects every registry action to a tool: `actionIdToToolName` (`.` becomes `_`), `readOnlyHint` from `mode === "read"` and `destructiveHint` from `mode === "apply"` (`packages/app/mcp/src/mcp.ts:207-235`).
- `POST /api/action` for the web UI (`packages/contract/contracts/src/protocol.ts:13`).
- CLI `kb action-invoke`.
- An Effect plugin kernel with typed contribution points.
- Stack: React 19.2, zod 4, Effect 4 rc, MCP SDK 1.30.

**kb already has agent-native's central idea** (one action registry projected onto several surfaces), done in its own terms. What kb lacks is WebMCP, A2A and an in-app agent sidebar.

### (a) Adopt agent-native wholesale: reject

Wholesale adoption would bring in:

- Nitro, h3 and React Router framework mode in place of kb's Bun WS/HTTP server;
- a mandatory Postgres or PGlite database with about 150 framework tables next to kb's store port;
- `actions/`-folder discovery in place of kb's typed contribution points;
- a second action type (`defineAction`) beside `ActionDefinition`.

The result would be two registries, two stores and two plugin models, which is exactly the parallel-path pattern that Rule 1 forbids. It also ties kb to a pre-1.0 framework that ships several releases a day.

### (b) Adopt pieces as dependencies: only two leaf pieces are worth it

- **`@mcp-b/webmcp-polyfill` (MIT, 5.1.0).**
  - Worth taking only as an optional development and testing aid behind `document.modelContext` feature detection. The native API exists only in Chrome 146+ behind a flag or origin trial.
  - It is a pure page shim with no framework coupling.
- **`@agent-native/agentkit` (MIT, 0.5.0).**
  - Plausible as the sidebar's React chat UI and SSE protocol, because it takes a transport and needs no DB.
  - Risks:
    - it is 0.x with fast churn;
    - it pulls in `@ag-ui/core` 0.0.59 and `@agent-native/toolkit`;
    - its event model would become a second protocol next to kb's `/ws` protocol unless kb defines one mapping between them.
  - Decide after the sidebar's own contract is written, not before.
- **Do not depend on:**
  - `@agent-native/core`. Even `./action` pulls in authorization, audit and tracking modules, and the adapters need Nitro and the DB.
  - Its MCP or A2A servers.

### (c) Copy the pattern natively: **recommended**

Extend kb's existing registry with adapters, each a projection of `ManifestEntry` and all running through one invoke path, `registry.invoke` (which already returns a receipt):

1. **Metadata on the contract, stated once.** Add consent and exposure metadata to `ActionDefinition` so every adapter reads the same fields:
   - an exposure rule such as agent-native's `isActionExposedToExternalAgents` (one predicate, used by every surface);
   - `consequential` or `needsApproval`.

   agent-native's lesson here: put authorisation and approval on `run`/invoke itself, not in each dispatcher. kb's `mode` already covers `readOnly`.
2. **WebMCP adapter** (about 200 lines, UI side):
   - fetch the manifest;
   - for each entry, call `document.modelContext.registerTool({name: id, title, description, inputSchema, annotations: {readOnlyHint: mode==="read", consequentialHint: mode==="apply"}, execute: input => POST /api/action})`;
   - register with one `AbortSignal` so every tool unregisters when it is aborted, and re-register on the WS manifest change.

   Dotted kb ids are valid WebMCP names, so there is no need to reuse MCP's `_` mangling. When an approval-required action arrives with no approval, refuse it on the server, as agent-native does. For `isomorphicActions`, `execute` can run in the browser without a network round trip.
3. **A2A (optional, later):** a static agent card whose skills come from the manifest, plus JSON-RPC `message/send` mapped to a direct action invocation. agent-native routes that through an LLM turn, but kb has no in-app LLM and should not need one for A2A. This is lower value than WebMCP; treat it as a named gap until a real peer exists.
4. **Sidebar agent:** do not build an engine abstraction or thread store inside kb. Two options:
   - Run a local Claude Agent SDK or ACP (`claude-code-acp`) process that mounts kb's existing MCP server. The sidebar is then a thin chat UI over its stream, which is agent-native's "BYO runtime" pattern. Your own local Claude login and your CLIProxyAPI/Headroom setup work without changes, because the model and tool loop live in the harness.
   - Or let the sidebar talk to the harness through an AgentKit transport if (b) is accepted.

   Model threads, if they are kept, as kb nodes ("everything is a node"), not as a new storage shape.
5. **Contract suite:** add a property to the shared suite that every surface (CLI, MCP, WebMCP, HTTP) lists the same exposed set and returns the same receipt for the same invocation. This is the "one contract, every implementation" rule applied to protocols.

**Why (c):**

- kb already owns the hard part: a typed registry that projects to CLI, MCP and HTTP.
- agent-native's actual value for kb is design lessons: exposure predicates in one place, gates wrapped around `run`, the approval handshake, and the WebMCP schema and annotation mapping. None of that needs its code.
- WebMCP is still an origin trial, so a thin, easily replaced native adapter is the right amount of commitment.
- It keeps kb backend-agnostic (JSONL, SQLite, anything behind the store port), which (a) would break.

---

### Sources

- Repository: https://github.com/BuilderIO/agent-native (commit 1f948099, 2026-09-29); docs in the repo at `packages/core/docs/content/*.mdx`; site https://agent-native.com/docs
- npm: `@agent-native/core` 0.196.0, `@agent-native/agentkit` 0.5.0, `@mcp-b/webmcp-polyfill` 5.1.0
- Builder blog: https://www.builder.io/blog/agent-native-architecture (2026-05-08); https://www.builder.io/blog/agent-native-apps (2026-04-21)
- WebMCP spec: https://webmachinelearning.github.io/webmcp/ ; https://github.com/webmachinelearning/webmcp (commit 19fc565)
- Chrome: https://chromestatus.com/feature/5117755740913664 ; https://developer.chrome.com/blog/ai-webmcp-origin-trial ; https://developer.chrome.com/docs/ai/webmcp
