# The agent beyond Claude Code: one runtime port, several adapters, providers as nodes

Plan of 2026-10-17. Nothing here is built. It builds on
[DESIGN.md → Agent packages](../../../tools/kb/DESIGN.md#agent-packages) and on
gap 1 of the [Cordis survey](../2026-10-16-kb-cordis-layers/README.md#1-plugin-config-as-fields-on-sysextensionname-with-re-apply-m),
and restates neither. It serves the queue item "Sidebar agent config (model,
executable) as fields on the agent's extension node"
(`01M43DS1JS0C2BF56NYMSKJJK8`). The index is
[2026-10-17-kb-overnight-plans.md](../2026-10-17-kb-overnight-plans.md).

## What the owner asked

> "the agent plugin with model config chooser and stuff. make it a bit flexible rather than just claude code."

## What is Claude-specific today

The port is already provider-neutral. `AgentRuntime.turn(AgentTurn)` in
`extension/agent/src/runtime.ts` streams `AgentOutput` (text, session). The turn
carries the system prompt, the message, an opaque `resume`, the tools as
`ManifestEntry[]`, and `call`. The bridge (`bridge.ts`) owns conversations,
approval and the screen block, and none of that names Claude.

What is Claude's:

| Where | What |
|---|---|
| `app/cli/src/host-plugins.ts` | Hard-wires `claudeRuntime({cwd: root})`. `ClaudeRuntimeOptions.model` and `.executable` exist, but nothing sets them. |
| `agent-claude/src/claude.ts` | The tool loop runs inside Claude Code (`maxTurns: MAX_STEPS`, 40). Claude's own tools are off (`tools: []`, `settingSources: []`, `strictMcpConfig`), and `permissionMode: "dontAsk"` leaves approval to kb. |
| `agent-claude/src/tool-server.ts` | Tools are served as an in-process MCP server with `_meta["anthropic/alwaysLoad"]`. |
| `resume` | Claude Code's session id. The transcript lives in Claude Code's files. |
| `agentPlugin({runtime})` | Takes exactly one runtime, whose `name` is `"Claude"`. |
| DESIGN.md | States "kb configures no API key and reads none". |

## Prior art and local endpoints

- **Vercel AI SDK.**
  - A registry addresses a model as `provider:model` through
    `createProviderRegistry(...)`
    (https://ai-sdk.dev/docs/reference/ai-sdk-core/provider-registry).
  - `createOpenAICompatible({name, baseURL, apiKey?})` covers any `/v1` server
    (https://ai-sdk.dev/providers/openai-compatible-providers).
- **OpenAI wire.**
  - Chat Completions carries tool calls inside the assistant message. The
    Responses API uses separate `function_call` and `function_call_output`
    items (https://developers.openai.com/api/docs/guides/migrate-to-responses).
  - The function-calling guide says GPT-6 Astra and GPT-6.1 Sol need the
    Responses API for tool calling
    (https://developers.openai.com/api/docs/guides/function-calling).
- **Ollama** serves `http://localhost:11434/v1/`. There,
  `/v1/chat/completions` supports streaming and tools, and `/v1/models`
  exists (https://docs.ollama.com/api/openai-compatibility).
- **Claude Agent SDK.**
  - `query({prompt, options})` takes `model`, `pathToClaudeCodeExecutable`,
    `permissionMode`, `mcpServers`, `env` and `allowedTools`
    (https://code.claude.com/docs/en/agent-sdk/typescript).
  - Pointing it at a gateway is `env: {ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN}`.
    The endpoint must speak Anthropic Messages, and Anthropic does not support
    routing Claude Code to non-Claude models
    (https://code.claude.com/docs/en/llm-gateway).
- **Codex.**
  - `@openai/codex-sdk` wraps the `codex` CLI over JSONL, with threads in
    `~/.codex/sessions` and `resumeThread(id)`
    (https://github.com/openai/codex/blob/main/sdk/typescript/README.md).
  - Providers are `[model_providers.<id>]` tables with `base_url` and
    `env_key` (https://learn.chatgpt.com/docs/config-file/config-advanced).
- **This repository's stack** (`modules/stacks/ai-agents`):
  - **CLIProxyAPI** listens on `127.0.0.1:8317` (`cli-proxy-api.nix`), loopback
    only, with `api-keys = [ ]`, so it needs no key. `system-setup.nix` probes
    it as OpenAI-compatible (`kind = "openai_models"`, `/v1/models`). It routes
    to `openai-compatibility` upstreams (deepseek, opencode-go) and to
    OAuth-backed providers. I did not check whether it also answers
    Anthropic's `/v1/messages`.
  - **Headroom** is a compression proxy on `localhost:8787`
    (`HEADROOM_PROXY`), which clients reach by pointing their provider base URL
    at it. For kb it is one more endpoint. I did not check which wire it
    speaks.
  - **Ollama** is the `ai-agents.ollama` component, on its default port 11434.

## The concept in kb's terms

Three things, which today's code folds into one:

1. **Adapter.** Code that runs one turn over one wire: `claude-agent-sdk`,
   `openai-chat` (Chat Completions), and later `openai-responses` and `codex`.
   Adapters are code, and their ids are frozen data.
2. **Provider.** An endpoint a person configured, held as a **node**: an
   adapter, an endpoint, a credential reference, an executable and a model.
   Examples are "Claude (my login)", "CLIProxyAPI · deepseek-v4-flash" and
   "Ollama · qwen3".
3. **Selection.** Which provider the sidebar uses: one config field on
   `sys.extension.agent`.

A model is a string in the provider's own vocabulary. The catalog of models
belongs to the provider and is read when it is needed (`/v1/models`, Claude's
aliases). It is never mirrored into the store.

The framing I was handed, tested:

- **"Provider, model, endpoint and executable become config fields on
  `sys.extension.agent`": half kept.** With every field on the extension node,
  a store can hold one provider, and switching between two means retyping both.
  Providers become their own nodes, and the extension node keeps only the
  selection. There is a second reason. `sys.extension.agent` is
  write-protected (`assertSysWriteAllowed`, `operations/src/actions.ts`), so
  its fields need gap 1's write path. Provider nodes are user nodes, and they
  are edited with the ordinary field gestures.
- **Secrets never in nodes: kept, and given a mechanism** (below).
- **Tools mapped to the action registry, streaming, and approval in common:
  kept.** The bridge already does all three.
- **One contract suite over every adapter: kept.** The Claude adapter becomes
  testable by injecting its `query`.

## Where it lives

All of it is in the agent family; the family fence forbids reaching outside.

| Package | Scope | Holds |
|---|---|---|
| `@kb/agent` | shared | the port, unchanged; `AgentAdapter`; `stepLoop`; the provider `ConfigSlots`; the declaration with its seed and adapter options |
| `@kb/agent-claude` | backend | the `claude-agent-sdk` adapter, with `query` injectable and `env` set from the provider's endpoint and credential |
| `@kb/agent-openai` | shared (fetch only) | the `openai-chat` adapter: Chat Completions SSE with tools; history held in process, keyed by its resume handle |
| `@kb/agent-codex` | backend | later; see the admission rule |
| `@kb/agent-ui` | browser | the chooser in the dock header |

```ts
interface AgentAdapter {
  readonly id: string;                       // frozen: "openai-chat"
  readonly runtime: (provider: ProviderConfig, secrets: SecretSource) => AgentRuntime;
  readonly models?: (provider: ProviderConfig, secrets: SecretSource)
    => Effect.Effect<readonly string[], AgentRuntimeError>;
}
```

The composition root becomes
`agentPlugin({adapters: [claudeAdapter, openAiChatAdapter], secrets})` in
`host-plugins.ts`. At the start of each turn the bridge reads the selection and
the provider node through `UiHost.invoke` (`node.get`). This is the survey's
"read per call" class of config, so nothing re-applies.

## Data model

**Seed home (owner question 3).** The agent is composed by its host, and
DESIGN.md says "Host and repository plugins contribute no seed". Recommended:
the agent's declaration joins the fold (`BUNDLED_DECLARATIONS`) without joining
the registry's `BUNDLED_FAMILIES`. The fold is about declarations, and which
host loads the code is a separate load decision. The
[family-contributions plan](../2026-10-17-kb-family-contributions/README.md)
needs the same split.

Frozen ids:

- **Tag** `sys.tag.agent-provider` ("agent-provider"), templating:
  - `sys.f.agent.adapter`: a ref, cardinality one. Its option children are
    `sys.agent.adapter.claude-agent-sdk` and `sys.agent.adapter.openai-chat`.
    The declaration lists adapter ids and labels, and the contract checks that
    host composition implements every one.
  - `sys.f.agent.endpoint`: url, one. Absent is the adapter's default: for
    Claude, the person's login; for `openai-chat`, a provider with no endpoint
    is broken.
  - `sys.f.agent.credential`: secret, one (below).
  - `sys.f.agent.executable`: text, one. The `claude` or `codex` binary.
  - `sys.f.agent.model`: text, one. The model id.
- **On `sys.extension.agent`** (a gap-1 slot): `sys.f.agent.provider`, a ref,
  cardinality one, whose targets are the provider tag's instances.
- **No provider node is seeded.** An absent selection falls back in the slot
  to today's behaviour: `claude-agent-sdk`, the person's login, Claude Code's
  default model. So a store with nothing written behaves as now, and opening
  never writes.
- **This repository's store** gets provider nodes as data in a separate
  commit: "CLIProxyAPI" (`openai-chat`, `http://127.0.0.1:8317/v1`, no
  credential), and "Ollama" (`http://localhost:11434/v1`) on hosts that enable
  it. They are committed because the stack declares the same endpoints on
  both Macs.

**Secrets (owner question 2).** `sys.f.agent.credential` holds a reference,
never a key: `env:NAME` or `keychain:<service>[/<account>]`.

- Recommended: a core field type `secret` (`sys.ft.secret`), whose form check
  sits in `field-value.ts` beside `normalizeUrl`. Then the write check that
  every surface commits through (`valueConformanceError` inside
  `persistEffect`) refuses a pasted key before it reaches a committed
  `nodes.jsonl`.
- A reference resolves only in the server process, through a `SecretSource`
  service that the `kb ui` composition root binds:
  - environment variables;
  - the macOS keychain (`security find-generic-password -s <service> -w`);
  - `secret-tool lookup` on Linux.
- The browser sees only the reference string.
- DESIGN.md's sentence becomes "kb stores no key; it reads one only through a
  reference a person wrote".

## Common to every provider, and specific to one

The bridge keeps everything that is common, unchanged: the conversation; the
registry listing as the turn's tools; every call through `turn.call`, so the
invoke core decides approval; the screen block; cancel as interrupt;
`AgentOutput`; `AgentRuntimeError`.

New common code in `@kb/agent`:

- **`stepLoop`**, for adapters whose wire does not run tools itself. Given
  `step(messages, tools) → Stream<delta | toolCalls | done>`, it:
  1. runs a step;
  2. calls each tool through `turn.call`, in order, because an approval waits
     per call;
  3. appends each receipt (as `mcpToolResult`'s text) as a tool message;
  4. repeats until a step makes no call, or `MAX_STEPS` is reached. That
     constant moves here from `claude.ts`.

  Tool names are `mcpToolName(id)` and parameters are
  `asObjectSchema(inputSchema)`, the names `kb mcp` uses.
- **A resume handle belongs to the provider that minted it.** The bridge's
  `Conversation` records `{provider, resume}`. A turn under another provider
  starts fresh, and the sidebar says so. The port gains nothing.

Specific to an adapter:

- **The wire.**
- **Who runs the loop.** The Claude SDK and Codex run their own;
  `openai-chat` runs `stepLoop`.
- **What `resume` is.** A session id, a history handle, or a thread id.
- **The built-in tools it must switch off.**
- **How a credential reaches it.** The child's `env` for the Claude SDK; an
  `Authorization` header for `openai-chat`.
- **Where its model catalog comes from.**

**The admission rule.** This is a new statement in the port's contract.
An adapter's model may call only the turn's tools. An adapter whose backend
runs tools of its own that kb cannot switch off is not admitted. Codex brings
shell and patch tools and a sandbox (`--sandbox`, read-only by default per
https://learn.chatgpt.com/docs/non-interactive-mode). I have not shown that
they can be removed, so Codex waits (owner question 4).

## Surfaces

- **Sidebar.** The dock header shows the agent node's provider field as an
  ordinary field row, using the kit's one slot grammar
  ([DESIGN-UI.md → Field values](../../../tools/kb/DESIGN-UI.md#field-values-one-slot-grammar)).
  It is a ref picker over `#agent-provider` nodes, and beside it is the
  provider's model field, with suggestions from `ext.agent.models`. "Edit
  providers" opens the provider tag's table. Placing an existing field row in
  the dock is the only UI work; there is no settings widget.
- **Actions,** hosted where the agent is
  (GAP [[01M43H3T8XEMTNBARC024PZD2W]] still applies):
  - `ext.agent.models {provider}` (read) lists the provider's model ids. A
    failure answers warnings, not a failed receipt.
  - `ext.agent.check {provider}` (read) answers whether the provider can run:
    the binary is found, the endpoint answers, the credential reference
    resolves. It names a missing reference and never shows a value.
- **CLI.**
  - `kb add "CLIProxyAPI" --tag agent-provider --prop adapter=… --prop endpoint=http://127.0.0.1:8317/v1 --prop model=deepseek-v4-flash`.
  - The selection is made through gap 1's write path. No second one is built
    here.
- **MCP.** The two actions are tools wherever the agent is hosted.

## The contract suite

`agentRuntimeContract` runs over every adapter, each paired with a model double:

- `claude-agent-sdk` over an injected fake `query`. The fake yields
  `SDKMessage` sequences (system init, stream deltas, result) and calls the
  in-process tool server, so the real `queryOptions`, `outputsOf` and
  `kbToolServer` run.
- `openai-chat` over a Bun HTTP fake that serves Chat Completions SSE: text
  deltas, `tool_calls` with arguments split across chunks, `finish_reason`.
- `scriptedRuntime`, so the bridge's own double is proven honest.

Properties:

- text arrives in order and concatenates;
- a `session` is emitted;
- one model tool call reaches `turn.call` once, with the action id and the
  parsed input;
- the receipt reaches the model (the double asserts it saw it);
- a tool not in `turn.tools` answers `unknown_action` and is never invoked;
- the model sees no tool beyond the turn's;
- interrupting while a `call` is pending interrupts the call and ends the
  stream;
- a backend error becomes `AgentRuntimeError`;
- `MAX_STEPS` ends a loop that never stops;
- `resume` carries context into a second turn.

Beside the suite: the provider slot decode tests (a malformed provider warns,
falls back, and the sidebar shows the reason); the form tests for the `secret`
type in `field-value`; and `surfaceContract`, unchanged.

## Steps

| Step | What | Kind | Size | Waits for |
|---|---|---|---|---|
| A0 | This plan; queue nodes | docs | S | — |
| A1 | The Claude adapter takes `query` as a dependency (default: the SDK import); `MAX_STEPS` moves to `@kb/agent`. Behaviour unchanged | restructure | S | — |
| A2 | `agentRuntimeContract` over Claude (fake `query`) and scripted | add (tests) | M | A1 |
| A3 | `stepLoop`, a pure function over a step, proven through a scripted step double | restructure | M | A2 |
| A4 | `@kb/agent-openai`'s `openai-chat` and its SSE fake join the contract. Not selectable yet | add | M | A3 |
| A5 | The agent declaration joins the fold and seeds the provider tag, its fields and the adapter options. `agentPlugin({adapters, secrets})`; the selection is read per turn, falling back to today's | restructure + add | M | gap 1's write path |
| A6 | The `secret` field type in core; `SecretSource` (env, keychain) bound by `kb ui` | add | S | — |
| A7 | The chooser (a field row in the dock header), `ext.agent.models`, `ext.agent.check`, the providers table | add | M | A5, A6 |
| A8 | This repo's provider nodes (CLIProxyAPI, Ollama) | data | S | A7 |
| A9 | `openai-responses`, a second wire adapter | add | M | A4 |
| A10 | `codex`, once the admission question is answered | add | L | owner |
| A11 | DESIGN.md → Agent packages: adapters, providers, secrets | docs | S | A7 |

A1–A4 and A6 touch only the agent packages and `field-value.ts`, so they can
start now. A5 waits for gap 1, because a second write path for extension nodes
would be the parallel mechanism Rule 1 forbids.

## Questions for the owner

1. **Providers as nodes, with the selection on the extension node**, against
   every field on `sys.extension.agent`. *Recommended: providers as nodes.*
2. **A core `secret` field type**, refused at write, against a reference
   convention checked only when read. *Recommended: the field type.* A pasted
   key would otherwise be committed before any read saw it.
3. **The agent's declaration joins the seed fold,** while its code stays
   host-composed. *Recommended: yes.*
4. **Admit Codex only if its own tools can be switched off.** *Recommended:
   yes, and defer it.*
5. **Chat Completions first, Responses second.** *Recommended: yes.*
   CLIProxyAPI, Ollama and DeepSeek speak Chat Completions, and the GPT-6
   models need Responses for tools.
6. **A provider switch for one conversation.** *Recommended: not in v1.* One
   selection per store.

## Non-adoptions

- **The Vercel AI SDK as a dependency.** kb borrows its `provider:model`
  shape, but here the registry is nodes, and the SDK would bring a second
  tool-loop model beside Effect streams. Revisit if adapters multiply.
- **Remote model catalogs stored as nodes.**
- **Keys in nodes or in `.env` files kb reads, and any key in the browser.**
- **Routing Claude Code to non-Claude models through `ANTHROPIC_BASE_URL`.**
  Anthropic does not support it.
- **An adapter over Ollama's native `/api/chat`.** `/v1` covers it.
- **Threads as nodes.** That is GAP [[01M40WSVNKVH3ZY8QE0GN5DY8X]], a
  separate piece of work.
- **Per-agent scoped tools.** A non-adoption in the Cordis survey.

## What landed

On the branch that followed the projection-families work (base `3e77dcb3`),
after the Cordis survey's gaps 3 and 1. Order: A1, A2, A3, A6, A5. A5 needs
the CLI root to load what it composes, so it came before A4.

- **A1.** The Claude adapter takes `query` as a dependency, defaulting to
  the SDK, which is imported lazily. `MAX_STEPS` moved to `@kb/agent`.
- **A2.** `agentRuntimeContract` (`@kb/agent`, `runtime-contract.ts`) has
  the nine properties under [The contract suite](#the-contract-suite). It
  runs over Claude with a fake `query`, which drives the adapter's real
  in-process tool server through `InMemoryTransport`. The interrupt
  property found a real hang: closing the stream waited on a pending tool
  call. The adapter now aborts before it closes the iterator.
  `scriptedRuntime` is not a subject. It is a script, not a model behind a
  wire, so the bridge's tests remain its proof.
- **A3.** `stepRuntime` (`step-loop.ts`) is the tool loop for a wire that
  runs one step. The contract runs over it with a step played in memory.
- **A6.** The `secret` field type (`sys.ft.secret`; `secret-ref.ts` and
  `field-value.ts` in `@kb/model`) refuses anything that is not
  `env:NAME` or `keychain:<service>[/<account>]` on every surface.
  `SecretSource` (`@kb/contracts`) and `systemSecrets` (`@kb/runtime`) were
  delivered with A5, the first code to read a secret.
- **A5.**
  - The agent's declaration seeds the provider tag, its five fields, the
    adapter options, and `sys.f.agent.provider`, which configures
    `sys.extension.agent`. The seed is in the fold through a new list,
    `HOSTED_FAMILIES` (`@kb/bundled`), and stays out of `BUNDLED_FAMILIES`,
    as owner question 3 recommended. A CLI test checks that `kb ui` hands
    over exactly that list.
  - `agentPlugin({adapters, secrets})`. The selection is read at the start
    of each turn (`chooseProvider`), the gap-1 read-per-call class, and
    falls back to today's Claude. One runtime is kept per provider *as
    written*. When the provider changes, its settings included, the next
    turn starts afresh with a `notice`. A missing provider node and a
    missing adapter fail the turn with a message.
  - `claudeAdapter` maps `model` and `executable` to the SDK's options. It
    maps `endpoint` to `ANTHROPIC_BASE_URL` and the resolved credential to
    `ANTHROPIC_API_KEY`, laid over this process's environment, because the
    SDK replaces the environment it is given. This is meant for a gateway
    to Claude. Routing Claude Code to other models stays a non-adoption.
  - `AGENT_ADAPTERS` lists only the adapters that exist. A host-composition
    test holds `kb ui` to every id, and `AdapterId` types an adapter's `id`.
- **A4.** `@kb/agent-openai` (`scope:shared`, `family:agent`) is a step over
  Chat Completions SSE, decoded with Schema. Its `fetch` is a narrow
  injectable type, so the contract runs over a fake that reads the
  adapter's real request bodies and streams events back, split mid-line and
  with arguments split across chunks. That replaces the planned Bun HTTP
  server: the same wire bytes, with no port. It is selectable, because A5
  landed first. `kb ui` composes it, and `openai-chat` joined
  `AGENT_ADAPTERS` in the same commit. The CLIProxyAPI address was checked
  against `modules/stacks/ai-agents/cli-proxy-api.nix`: `127.0.0.1:8317`,
  `/v1`, and no client key (`api-keys = []`).
- **A7, the chooser only.**
  - The dock draws the agent node's `provider` field and the selected
    provider's `model` under its header. Both use the page's field editor,
    so there is no settings widget.
  - Before that could happen, the field editor became a UI kernel service
    (`FieldEditorService`, `useFieldEditor`) that the outline provides, in
    its own refactor commit. Until then, a field was reachable only inside a
    frame (`FrameSubject.Field`). Frame views now draw through the same
    service, so there is one way to reach the editor.
  - Not built:
    - `ext.agent.models` and `ext.agent.check`. These need hosted actions,
      and today the server routes no action to a plugin that `kb ui` hosts.
      DESIGN.md -> Agent packages names this as a placeholder gap.
    - The providers table. A person makes a provider by tagging a node
      `#agent-provider`, as with any node.
- **Not started:** A8 (this repository's provider nodes, which are data
  writes in `.kb/nodes.jsonl` and outside this run), A9, A10. A11 landed
  with each step instead of separately.

## Review (GPT-6.1 Sol, 2026-10-17)

A security review of batch S as it landed (main `0db1f307`). Each finding
was verified against the code before it was fixed.

| # | Severity | Finding | Fix |
|---|---|---|---|
| S1 | blocker | The selection reads its provider node by id without checking the `#agent-provider` tag, and only the tag and the selection field configure the agent, so a provider's endpoint, credential, executable and adapter could be written on an untagged node with no approval, then selected by a reference the owner approves without seeing them. Canvas prop ops also write any field, `sys.*` included. | The selection requires the tag; every provider field configures the agent; canvas writes meet the system-write rule (S4); the approval card shows what a provider runs with. |
| S2 | major | `openai-chat` follows redirects, so https can be sent to http or another origin. | `redirect: "error"` in the default send and in the request contract, with a contract test. |
| S3 | major | The step timeout covers the headers only; the error body is unbounded and the stream has no idle timeout. | A per-step abort tied to the step's scope, an idle timeout per chunk, a bounded error body, and a stalled-body contract property. |
| S4 | major (Rule 1) | The system-write guard lives in callers, not in `persistEffect`, so some commits skip it (ext-check sync, `views.migrate`, canvas writes). | The check moves into `persistEffect`, its one owner; legitimately system writers say so, never by skipping it. |
| S5 | minor | The keychain child inherits the whole environment. | A minimal allowlist from the one child-env owner. |
| S6 | minor | SSE line length is uncapped. | Lines are capped, failing `internal`. |
