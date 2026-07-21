# Cognee Agent Lifecycle Adapters

Cognee currently ships automatic lifecycle integrations for Codex and Claude
Code. Cursor CLI, Oh My Pi (OMP), and Hermes can use the shared Cognee graph
through MCP, but MCP alone does not record their native conversation timeline.
Thin client-side adapters can close that gap without moving agent execution to
the Cognee server.

This document records the proposed integration boundary. The adapters do not
belong in this dotfiles repository beyond their pinned installation and local
configuration; their source should live in a separate public repository.

## Proposed Repository

Use one repository for the three adapters so their event schema, redaction
rules, fixtures, and conformance tests cannot drift:

```text
cognee-agent-integrations/
├── integrations/
│   ├── cursor/
│   ├── omp/
│   └── hermes/
├── protocol/
│   ├── event-schema/
│   └── conformance-fixtures/
└── docs/
```

Cursor and OMP integrations can be TypeScript packages; Hermes can remain a
small Python package. Share the protocol and fixtures rather than forcing all
three clients through one runtime. If the adapters prove stable, propose them
upstream to
[`topoteretes/cognee-integrations`](https://github.com/topoteretes/cognee-integrations).

Do not create three repositories. A release may still publish independently
installable artifacts for each client.

## Common Lifecycle Contract

Every adapter should translate native events into the same versioned envelope:

```text
agent + native conversation ID -> stable Cognee session ID
prompt                         -> recall, then prompt event
tool completion                -> redacted structured tool event
assistant completion           -> response event
session completion             -> flush, then improve
```

Required behavior:

- prefix session IDs by agent and preserve the native ID across resume
- preserve event ordering and attach unique event IDs for idempotent retries
- recall from the configured dataset before model execution where supported
- upload paired prompt/response entries plus bounded tool inputs and outputs
- flush asynchronously with short timeouts and fail open when Cognee is down
- redact likely credentials before persistence and cap every string and field
- spool unsent events locally so abrupt termination does not lose the session
- never put the Cognee API key in an agent configuration file; use the local
  MCP bridge or a dedicated credential helper

Conformance fixtures should cover resume, retry, duplicate delivery,
compaction, subagents, failed tools, shutdown without a final response, and
Cognee being temporarily unreachable.

## Cursor CLI

Cursor's current hooks expose the lifecycle needed for recording:

- `sessionStart` and `sessionEnd`
- `beforeSubmitPrompt`
- `preToolUse`, `postToolUse`, and `postToolUseFailure`
- `afterAgentResponse`, `stop`, and `preCompact`
- corresponding subagent events

Hook payloads include a stable `conversation_id`, a per-turn `generation_id`,
and `transcript_path`. Package the adapter as a Cursor plugin containing
`.cursor-plugin/plugin.json`, `hooks/hooks.json`, and its scripts.

Recording is complete, but recall has a product limitation:
`beforeSubmitPrompt` can block submission but cannot add model context.
`sessionStart` supports `additional_context`, so Cursor can receive recalled
context when the conversation is created, not reliably before every later
turn. Do not rewrite the user's prompt to work around this. Revisit the design
if Cursor adds a per-turn context-injection hook.

Sources:

- [Cursor hooks](https://cursor.com/docs/hooks.md)
- [Cursor plugins](https://cursor.com/docs/plugins.md)
- [Cursor plugin reference](https://cursor.com/docs/reference/plugins.md)

## Oh My Pi

Use OMP's TypeScript extension API, not its legacy hook subsystem. The relevant
events are:

- `session_start`
- `before_agent_start`
- `tool_execution_end`
- `message_end`
- `agent_end`, `session_stop`, and `session_shutdown`

Use `ctx.sessionManager.getSessionId()` as the stable native conversation ID.
`before_agent_start` can add a custom message, and its context facilities allow
recalled Cognee knowledge to reach each model call. Install the extension under
`~/.omp/agent/extensions` or declare it through `omp.extensions` in a package
manifest.

Source: [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi)

## Hermes

Hermes has the closest match to Cognee's existing lifecycle plugins:

- `on_session_start`
- `pre_llm_call`
- `post_tool_call`
- `post_llm_call`
- `on_session_end` and `on_session_finalize`

`pre_llm_call` can return `{"context": ...}`, enabling recall before every
model call. Prefer a Python hook package that calls a small shared transport
module, rather than independent shell commands for every event.

Source: [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)

## Delivery Phases

1. Define the event envelope, redaction policy, limits, and conformance
   fixtures.
2. Implement Hermes first because it supports both recording and per-turn
   recall directly.
3. Implement OMP with the same semantics through its extension API.
4. Implement Cursor recording and session-start recall, explicitly reporting
   the per-turn recall limitation.
5. Add declarative package pins and generated client configuration here only
   after each adapter has tests and a versioned release.

Repository creation and upstream publication are intentionally deferred until
implementation begins.
