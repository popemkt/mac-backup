# Generative UI for kb: forms, maturity, and where to start

Research date: 2026-09-29. Sources are primary where possible (specs, official repos,
vendor docs and release notes). Versions and dates are as observed on that day. Where
a fact comes only from secondary coverage, it is marked *(secondary)*.

---

## 0. TL;DR

- **Start at the "declarative, own catalog" rung, and make kb's own view registry the
  catalog.** The model's output should be a **view node**: a `#view`-tagged node
  holding a query (`sys.f.query` or a ref to a `#query` node), a view key (a ref to the
  node that stands for a `ViewPoint` key), and params checked against that key's
  runtime schema. It renders through the existing `<ViewSlot>`. It is stored in
  `.kb/nodes.jsonl`, it diffs in git, and a human can edit it with the same gestures as
  any other node.
- **Don't adopt A2UI, json-render or OpenUI as kb's component model.** Each one brings
  its own component catalog. Putting one next to `ViewPoint` would give kb a second
  picker for one concept, which Rule 1 forbids. Those specs are also 0.x or release
  candidates and change often. Treat them as optional **edge adapters** (export or
  import) later on.
- **MCP Apps (stable spec 2026-01-26) is the transport for hosts, not a generation
  format.** `ui://kb/view/<name>` should serve kb's own trusted bundle. The *generated*
  part (the view node) travels as data in the tool input or result. Claude (web,
  desktop, mobile), ChatGPT, VS Code and Goose render it. **Claude Code does not**
  (issue #95149, opened 2026-09-17), so keep the markdown rendering of `render_view` as
  the fallback.
- **The generator is the MCP client's model, so kb needs no LLM of its own at first.**
  Expose the catalog through `kb_manifest`: view keys, their param JSON Schemas, and the
  tag and field schema. Add a validating `view.propose` action (or have `node_add` plus
  a `#view` tag validate). The agent then writes view nodes.
- **Put arbitrary model-written code last, and host it with the same bridge.** When kb
  reaches the open-ended rung, run code views in a sandboxed iframe that speaks the
  **MCP Apps postMessage/JSON-RPC protocol inside kb's own web UI** (with
  `@modelcontextprotocol/ext-apps/app-bridge` or `@mcp-ui/client`'s `AppRenderer`).
  Then one host contract covers the kb UI and every MCP host. That is "one contract,
  every implementation" applied to UI.

---

## 1. The axis: who owns the code?

The useful question for each form is **what the model emits, and who wrote the code
that runs it.** Each rung below trades control for freedom.

| Rung | What the model emits | Code that runs | Examples (2026) |
|---|---|---|---|
| **R0 Pick** | a component name and props (a tool call) | 100% the app's | CopilotKit "static" (`useFrontendTool` + render), Vercel AI SDK tool parts, Tambo registered components, LangGraph `push_ui_message` with a local component map, assistant-ui tool UIs, Hashbrown `exposeComponent` |
| **R1 Compose** | a tree or flat list of components from a fixed catalog, with data bindings | the app's; the model controls layout | Google **A2UI** (v0.9.1 stable, v1.0 RC), Vercel **json-render** (0.21), **OpenUI Lang** (Thesys), OpenAI **Open-JSON-UI**, assistant-ui `present` tool (JSON tree, 29 default components), Microsoft Adaptive Cards, Vega-Lite (charts) |
| **R2 Configure** | a configuration of the product's *own* primitives (database, view, query, filter, automation) | the product's; the config persists as product data | **Notion** agents building databases and views (3.x), **Airtable Omni** (tables, interfaces, automations), Retool **AppGen**, Glide AI, **Tana** AI command nodes |
| **R3 Formula** | expressions in a bounded, pure language | the product's interpreter | Notion/Coda/Airtable formulas, json-render `$cond`/`$template`/`$computed` and custom directives, Potluck/Embark formulas |
| **R4 Host a server's UI** | nothing new; the *server* ships HTML, and the model picks the tool | third-party, but pre-declared and sandboxed | **MCP Apps** (SEP-1865), MCP-UI, OpenAI Apps SDK widgets, LangGraph `LoadExternalComponent` |
| **R5 Write code** | HTML, CSS and JS, or a React component | model-written, sandboxed | **Claude Artifacts**, **v0**, tldraw **Make Real**, Val Town **Townie**, CopilotKit **Open Generative UI**, Gemini **dynamic view**, Hashbrown's JS runtime, Observable-style notebooks |
| **R6 Malleable** | edits to live tools that sit beside shared data | user- or model-written, versioned with the data | Ink & Switch **Patchwork**, **Potluck**, **Embark**, **Cambria** (schema lenses); Geoffrey Litt's on-the-fly tools |

R0–R3 produce **data** and R5–R6 produce **code**. R4 is a hosting mechanism. It is
orthogonal to the other rungs, and code or data from any rung can travel through it.

CopilotKit's own taxonomy (Jan 2026) groups these as *static* (R0), *declarative*
(R1) and *open-ended* (R4/R5). It also notes that AG-UI is a transport and not a UI
spec. R2 and R6 are missing from most vendor taxonomies, yet they are the rungs where
data platforms and knowledge bases actually live.

---

## 2. Declarative component-spec protocols (R0–R1)

### Google A2UI
- **Status:** v0.9 was announced 2026-04-17 (Google I/O 2026). The repo lists
  **v0.9.1 as the production release, v1.0 as a release candidate** ("previously
  v0.10 in draft"), and v0.8 as legacy. v0.8→0.9 was a breaking redesign (the JSON
  structure and schema changed, and the protocol became bidirectional). v1.0 changes
  things again (bidirectional function calls, single-message instantiation, stricter
  naming). **License: Apache-2.0.**
- **Shape:** each surface is an adjacency list. Every component has an `id` and a
  `component` type and refers to its `children` by id. Agent→renderer messages are
  `createSurface`, `updateComponents`, `updateDataModel` (JSON-Pointer paths, RFC 6901),
  `deleteSurface`, `callRendererFunction` and `agentFunctionResponse`. Renderer→agent
  messages are `action`, `callAgentFunction` and `rendererFunctionResponse`.
- **Catalogs:** each `catalogId` names a set of components and functions. Renderers
  can mix several catalogs, and the "Basic" catalog is optional. Functions carry
  `allowedCallers` and are how A2UI avoids sending code over the wire ("safe like data,
  but expressive like code").
- **Renderers:** Lit, Angular, React and Flutter (GenUI SDK), with Compose and SwiftUI
  planned. **Transports:** A2A, AG-UI and MCP.
- **For kb:** the adjacency-list-plus-data-model shape maps almost one-to-one onto kb
  nodes: a component id is a node id, `children` are child edges, and the data model is
  query results. That makes it a good *export* format. It is a bad core model while it
  is still at RC and reshaping every minor version.

### Vercel json-render
- **Status:** launched January 2026, now **v0.21.0 (September 2026)**, with breaking
  changes in minor versions (for example 0.20 changed renderer bridges to take an
  `ActionBinding`). It is a "Vercel Labs" project. **License: Apache-2.0.** It has
  about 18k stars.
- **Shape:** a flat `{ root, elements: { id: { type, props, children, visible?, watch? } } }`.
  Prop expressions use `$state`, `$cond`, `$template`, `$computed` and `$bindState`,
  and `defineDirective` adds custom ones. You declare the catalog in Zod with
  `defineCatalog()`, which also generates the system prompt. It streams through
  `createSpecStreamCompiler()`.
- **Renderers:** React, RN, Vue, Svelte, Solid, Next, TanStack Start, React-PDF,
  React-Email, Ink, R3F/Three and Satori images. **`@json-render/mcp`** turns a spec
  into an MCP App.
- **For kb:** the best *reference design* for "one spec, many render targets," which
  is what kb already does with html/md from `render_view`. Its directive idea is a good
  model for kb's R3 expression layer.

### OpenUI (Thesys; C1 API; Crayon)
- **OpenUI** launched 2026-03-11 under the **MIT** license. It is a compact,
  code-like "OpenUI Lang" that streams and claims "up to 67% fewer tokens than JSON"
  (a vendor benchmark, including a comparison with json-render). It has renderers for
  React, Vue, Svelte and Angular, and it bridges to A2UI.
- **C1** is Thesys's hosted generative-UI API. **Crayon** was their earlier React
  component kit. Thesys also shipped **OUI-1**, an open-weight UI-generation model
  *(secondary)*.
- **For kb:** token efficiency matters little when the generated artifact is small and
  persistent, like a view node. Skip it.

### OpenAI Open-JSON-UI
- This is OpenAI's internal declarative schema, published as an open standard. The
  documentation is mostly CopilotKit's. There is little independent spec material, so
  treat it as low maturity for adoption.

### CopilotKit + AG-UI
- **AG-UI 1.0.0 was released 2026-09-17.** It is the first release backed by a
  schema-as-source-of-truth spec, and SDK types are generated from it. **License: MIT.**
  AG-UI is an event protocol that carries runs, tool calls, `STATE_DELTA` and
  `ACTIVITY_DELTA` (JSON Patch), `CUSTOM` and subagent events. It is **not** a UI spec,
  and it carries A2UI, MCP Apps and Open-JSON-UI.
- **CopilotKit (MIT)** implements all three rungs. The static rung uses
  `useFrontendTool` with render. The declarative rung uses A2UI or Open-JSON-UI. The
  open-ended rung uses MCP Apps plus **Open Generative UI**, where the agent streams
  HTML, CSS and JS into an iframe with `sandbox="allow-scripts"` only and calls back
  through Zod-validated "sandbox functions."
- **For kb:** AG-UI only matters if kb embeds an in-app agent chat with streaming state.
  The MCP route already covers "agent drives kb."

### Vercel AI SDK
- **AI SDK 6** offers typed message parts and `ToolLoopAgent`. You render generative UI
  by mapping `tool-<name>` parts in `useChat` to components (R0). **AI SDK RSC /
  `streamUI` development is paused and marked experimental**, and Vercel recommends AI
  SDK UI.

### LangGraph generative UI
- Graph nodes call `push_ui_message`. The client `useStream` renders a local component
  map and falls back to **`LoadExternalComponent`**, which loads UI bundles that
  LangSmith colocates with the graph and serves. That is R0 with a remote-code escape
  hatch that is effectively R4.

### assistant-ui
- **MIT.** It has moved from `makeAssistantToolUI` (deprecated) to toolkits: a
  `"use generative"` directive plus `defineToolkit`, and a **`present`** tool whose
  arguments are a flat JSON tree (`$type`, `children`, props) over a vocabulary of 29
  default components, extensible through `defineGenerativeComponents` with Zod. It
  resolves components by lookup "with no eval," and the output is plain JSON that is
  also rendered to Slack or Teams.

### Tambo
- **MIT** SDK (some backend workspaces are Apache-2.0), at 1.0. You register components
  with Zod props, and they become LLM tools. It distinguishes *generative* components
  (render once) from **interactable** components (`withInteractable()`, which persist
  and update across the thread). It has full MCP client support.

### Hashbrown
- **MIT**, for React and Angular. It offers `exposeComponent` with **Skillet** schemas,
  `useUiChat`, tool calling in the browser, and a bundled JS runtime for executing
  model-written code "safely within browser constraints." So it covers R0/R1 and adds
  an R5 escape hatch.

---

## 3. MCP Apps and how hosts render them (R4)

### Spec
- **SEP-1865 "MCP Apps"** was proposed 2025-11-21 and became the **stable spec on
  2026-01-26** (`ext-apps/specification/2026-01-26/apps.mdx`), with a draft that keeps
  evolving. Extension id: `io.modelcontextprotocol/ui`. It is the first official MCP
  extension. **License: Apache-2.0.**
- **Resources:** `ui://…` with mime `text/html;profile=mcp-app`, the only content
  type in the MVP. Resource `_meta.ui` carries `csp` (`connectDomains`,
  `resourceDomains`, `frameDomains`, `baseUriDomains`), `permissions` (camera, mic,
  geolocation, clipboardWrite), an optional `domain` (dedicated sandbox origin) and
  `prefersBorder`.
- **Tool↔UI:** a tool's `_meta.ui.resourceUri` points at the template.
  `visibility: ["model","app"] | ["model"] | ["app"]` lets a server define **app-only
  tools** that the UI can call but the model never sees.
- **Sandbox:** web hosts **must** use double-iframe isolation: an outer sandbox proxy
  on another origin, and an inner iframe with CSP enforced from the declared domains.
  If the metadata omits CSP, the default is `default-src 'none'` apart from
  self-hosted script and style.
- **Bridge:** MCP JSON-RPC over postMessage. The view sends `ui/initialize`,
  `ui/open-link`, `ui/message`, `ui/request-display-mode` and
  `ui/update-model-context`, and can also use `tools/call`, `resources/read` and
  `notifications/message`. The host sends `ui/notifications/tool-input`,
  `tool-input-partial`, `tool-result`, `tool-cancelled`, `host-context-changed` (theme
  CSS variables) and `size-changed`.
- **Deferred beyond the MVP:** external URLs (`text/uri-list`), several UI resources
  per tool response, **state persistence and restoration**, custom per-resource sandbox
  policies, and view-to-view communication.
- **Design stance:** templates are **pre-declared** so hosts can review the HTML
  before running it. Every message is auditable JSON-RPC. The model does *not* write
  the HTML.
- **SDK:** `@modelcontextprotocol/ext-apps` (the `App` class and
  `PostMessageTransport`), `/react` (`useApp`, `useHostStyles`), `/app-bridge` (for
  **embedding views in your own host**) and `/server`.

### MCP-UI
- **Apache-2.0.** It pioneered `rawHtml`, `externalUrl` and `remote-dom` UIResources.
  **It now implements MCP Apps**, and `@mcp-ui/client`'s `AppRenderer` is its
  recommended host SDK. The `remote-dom` mode (Shopify remote-dom, which renders
  host-native components from a description) is the part of MCP-UI that sits closest to
  R1.

### Hosts in 2026
- **Claude:** launched 2026-01-26 as "interactive connectors" on web, desktop and
  mobile for all plans, and in Cowork, with launch partners Amplitude, Asana, Box,
  Canva, Clay, Figma, Hex, monday.com and Slack. UIs run in sandboxed iframes, and
  actions need user approval.
- **ChatGPT:** "fully compatible with the MCP Apps spec as of February 2026." Its Apps
  SDK is not deprecated. OpenAI recommends MCP Apps fields and the `ui/*` bridge by
  default, with **`window.openai` as optional extensions**: `widgetState` and
  `setWidgetState` (instance-scoped UI state, which fills the persistence gap the spec
  leaves open), `uploadFile`, `selectFiles`, `requestModal` and `requestCheckout`.
  `openai/outputTemplate` remains a compatibility alias. Display modes are inline card,
  carousel, fullscreen and PiP.
- **Also:** VS Code, Goose, Postman, MCPJam, the mcp-use inspector and Alpic.
- **Claude Code:** **does not render `ui://` resources** and does not advertise
  `io.modelcontextprotocol/ui`. Tool results are text only (issue #95149,
  2026-09-17, no maintainer response). Servers fall back to text, so kb's md
  rendering has to stay first-class.

### Claude Artifacts (R5, but hosted by Anthropic)
- Model-written HTML or React runs in a sandbox. Since October 2025 artifacts have
  **persistent storage** (about 20 MB per published artifact, personal or shared
  state), **MCP connector access**, and the ability to call Claude from inside the
  artifact. "Live artifacts" refresh when reopened *(secondary)*. The artifact is
  persisted by Anthropic, as code, not in your data model.

---

## 4. Code-generating and malleable systems (R5–R6)

- **v0 (Vercel):** generates Next.js/shadcn code, and a Platform API lets other
  tools embed it. The output is a codebase and does not feed back into data.
- **tldraw Make Real:** you sketch, and the model returns an HTML file shown in an
  iframe shape on the canvas. tldraw now ships **starter kits** (make-real,
  **agent**, MIT for the starter code; the tldraw SDK has its own license). The agent
  kit shows the model *manipulating canvas shapes*, which is R2 on a canvas, and that
  is closer to what kb's canvas wants.
- **Val Town Townie:** full-stack code generation into "vals," with Auto mode (auto-run
  low-risk tools) and a Platform API plus MCP plugin (changelogs July–September 2026).
  Persistence is the code itself.
- **Observable Notebooks 2.0** (technology preview, July 2025; open source,
  HTML-based format, vanilla JS): the notebook is a text file you can version, AI is
  meant to co-write cells, and the results are reactive. This is the right model for
  "generated code that is also a document."
- **Gemini dynamic view / visual layout** (Google Research, November 2025): Gemini 3
  writes a bespoke interactive page for each prompt. It is ephemeral, and Google
  released an eval dataset (PAGEN).
- **Ink & Switch, "Malleable Software" essay** (June 2025; Litt, Horowitz, van
  Hardenberg, Matthews): "AI code generation alone does not address all the barriers
  to malleability". In their words, it is "a talented sous chef [in] a food court."
  What is needed is a **gentle slope from user to creator**, **tools not apps over
  shared data**, and communal creation. AI helps a great deal *inside* a malleable
  substrate.
  - **Patchwork:** code and data are both Automerge documents with universal version
    control. In May 2026 an AI was turning spoken ideas into Patchwork tools on the
    fly, and tools compose by proximity. They deliberately ran without strict
    sandboxing in playgrounds.
  - **Potluck** (2022): gradual enrichment. Text becomes a *search* that extracts
    structure, then formulas, then annotations back in the document.
  - **Embark** (2023): outline plus mentions of structured data, rich views (map,
    calendar) and formulas. **This is structurally kb's model.**
  - **Cambria:** bidirectional schema lenses so tools with different schemas share
    data. This is relevant when generated views expect field shapes the graph doesn't
    have.
- **Geoffrey Litt** ("Malleable software in the age of LLMs", 2023; "Dynamic
  documents", 2022) coined "on-the-fly UI" and one-off GUIs. He is now a design
  engineer at Notion working on malleable software.
- **Recent HCI evidence (2026):**
  - *Maru* (arXiv 2608.25565, August 2026): stores the user's information architecture
    (partition, hierarchy, order, vocabulary) as **persistent rules** that each
    generation reads. With persistence, generated UIs stay aligned over a session;
    without it, alignment decays. **This argues for storing generated view specs and
    preferences as data.**
  - *Conversational Customization of Productivity Systems* (arXiv 2605.11149, May
    2026): users mostly **adapt existing patterns rather than invent new features**.
    Their risks are mis-specified behavior and unintended filtering, so they need
    visibility and safe experimentation. **This argues for R2 (configure existing
    views) over R5.**
- **Product-embedded AI on data platforms:**
  - **Notion 3.x:** agents "build databases … with properties, relations, charts, and
    views." Custom Agents shipped in 3.3 (2026-02-24).
  - **Airtable Omni:** generates tables, interfaces and automations from a prompt,
    with plan review before "Build it," and "everything Omni creates is fully editable."
  - **Retool AppGen:** prompt to an app on production data, inheriting SSO, RBAC and
    audit.
  - **Tana:** **AI command nodes**, where the AI action is itself a node, with
    per-command model choice and a prompt workbench.

  **Every data platform chose R2: the AI writes configuration of existing primitives,
  and that configuration lands in the same editable model as human work.**

---

## 5. Safety and persistence

| Form | Output persistable as data? | Safety boundary | Debuggability |
|---|---|---|---|
| R0 pick | yes (tool name + args JSON) | app code only; schema-validated props | excellent |
| R1 compose (A2UI, json-render, OpenUI, `present`) | **yes**, a JSON spec you can store | catalog lookup, no eval; functions whitelisted | good (spec diff, devtools in json-render 0.18+) |
| R2 configure (Notion, Airtable, Tana) | **yes, as first-class product data** | product primitives only | excellent (the user edits the result directly) |
| R3 formula | yes (expression text) | pure interpreter; watch for runaway cost | good if evaluation is inspectable |
| R4 MCP Apps | the template is server code; the per-call data is ephemeral (**state persistence is deferred** in the spec; ChatGPT's `widgetState` is host-specific) | double iframe, CSP, pre-declared templates, auditable JSON-RPC, app-only tool visibility | good (log the JSON-RPC) |
| R5 code (Artifacts, v0, Open Generative UI) | as code text (host-owned for Artifacts) | iframe sandbox (`allow-scripts` only), CSP, capability bridge | poor to fair (you debug generated code) |
| R6 malleable | yes, code *and* data as versioned docs | usually trust-based (Patchwork plays without a sandbox) | good *if* the substrate is inspectable |

The main failure modes for the code rungs (R5/R6) are exfiltration through network or
the DOM, confused-deputy writes through the bridge, UI spoofing (a generated UI
imitating host chrome), and prompt injection that arrives through data shown in the UI.
The mitigations are the MCP Apps set: a separate origin, `default-src 'none'`, a
declared connect-domain allowlist, no same-origin access, host-mediated tool calls with
user approval for writes, and an audit log.

---

## 6. Stability and licenses (as of 2026-09-29)

| Spec / library | Version / status | License | Churn |
|---|---|---|---|
| MCP Apps (ext-apps) | **stable 2026-01-26**, draft ongoing | Apache-2.0 | low for the core; additive draft |
| MCP-UI | implements MCP Apps | Apache-2.0 | low (converged) |
| OpenAI Apps SDK | not deprecated; MCP Apps-first + `window.openai` | proprietary platform | medium |
| AG-UI | **1.0.0, 2026-09-17** | MIT | low now (0.x compat layer) |
| A2UI | **v0.9.1 stable, v1.0 RC**; v0.8 legacy | Apache-2.0 | **high** (two breaking redesigns in about 9 months) |
| json-render | **0.21.0 (Sep 2026)**, Vercel Labs | Apache-2.0 | **high** (breaking in minors) |
| OpenUI / OpenUI Lang | launched Mar 2026 | MIT | high |
| Open-JSON-UI | early; sparse spec | open (via CopilotKit docs) | unknown |
| CopilotKit | active | MIT | medium |
| assistant-ui | toolkit API; old tool-UI API deprecated | MIT | medium–high |
| Tambo | 1.0 | MIT (+ Apache-2.0 backend parts) | medium |
| Hashbrown | active | MIT | medium |
| Vercel AI SDK | v6; RSC/`streamUI` paused | Apache-2.0 | medium |
| Vega-Lite | 6.4.3 (2026-04-24) | BSD-3 | **low** (a mature grammar) |

The only stable, multi-vendor pieces are **MCP Apps** (host transport) and, for
charts, **Vega-Lite**. Every *component-catalog* protocol is still moving.

---

## 7. Mapping onto kb as it is today

What kb already has (from `tools/kb/DESIGN.md` and `DESIGN-UI.md`):

- **A typed view catalog:** `ViewPoint` / `ViewKey<P>` / `<ViewSlot>` in the UI
  plugin kernel, with a contract suite (`view-contract.test.tsx`). Params are currently
  **compile-time only**. The "runtime `params` schema and the `sys.view.*` option node
  on a key arrive in A1, together with view config held as nodes."
- **Parallel local registries still exist:** the outline's `sys.f.view.*` modes and
  `GRAPH_RENDERERS` (GAP `01M3EZRFJ9RYFJJ4MW322RQ28S`). The host contract is minimal
  (only `placement: page`; GAP `01M3EZR20H0CDF5MD01M2S26C5`).
- **The value-kind registry** (`VALUE_KINDS` plus the slot view registry) is already a
  per-value catalog.
- **Saved views are files** (`.kb/views/*.json` = `{output, query|savedQuery,
  template}`, where template is a TS function id from `TemplatePoint`), not nodes.
- **Query nodes** (`#query` + `sys.f.query` EDN) render live results.
- **An MCP surface:** `render_view`, `ui://kb/view/*` html resources, `kb_manifest`,
  `node_add` and `graph_query`.
- Views are **trusted, same-realm, with no iframe** (R1 decision 5).

The finding: **kb already is an R1/R2 system whose catalog is `ViewPoint`.** The piece
missing for generative UI is the same piece A1 already names: **self-describing views
(a runtime params schema) and view config held as nodes.** Generative UI should be the
*first consumer* of A1, not a new subsystem.

Rule-1 hazards to avoid:
1. Importing A2UI or json-render components as a second catalog beside `ViewPoint`
   (a second picker for one concept).
2. Storing generated views in `.kb/views/*.json` *and* as nodes (a mirror). The files
   should become a projection of `#view` nodes, or be removed.
3. A "genui" view type that is special-cased at call sites. A generated view has to be
   indistinguishable from a hand-made one.
4. A code-view host in the kb UI that differs from the MCP Apps host (two bridges for
   one concept).

---

## 8. Recommendation and staged ladder

### Where to start
**Rung R2 (configure your own primitives), with R1-style validation, surfaced through
MCP first.** The model writes a `#view` node over the existing view catalog. Every
data-platform precedent does this (Notion, Airtable Omni, Tana), the 2026 HCI evidence
favors it (users adapt existing patterns, and persistent structure keeps generations
aligned), and it meets all five criteria:

| Criterion | How the stage-1 design meets it |
|---|---|
| Persistable as graph data | the output *is* a node (`#view`) with field-node props; its query is a `#query` node or `sys.f.query` |
| Reuses the view catalog | the view key is a ref to a node representing a `ViewPoint` key; params are validated by that key's schema |
| Works in the kb UI and MCP hosts | the kb UI renders it through `<ViewSlot>`; MCP hosts get `ui://kb/view/<id>` (kb's trusted bundle, with the view node as tool-result data) plus md for text-only hosts such as Claude Code |
| Safe | no generated code; only catalog keys, schema-checked params and read-only datalog |
| Debuggable | a node you can open, edit, diff in git, run in `kb query`, and render with `kb render` |

### The ladder

**Stage 0: restructure first (a separate commit, behavior-preserving).** Close A1's
precondition.
- Give every `View` a runtime params schema (Standard Schema/Zod → JSON Schema) next
  to its `sample`. Extend the view contract suite so every view renders its `sample`
  *validated by its schema*, and so the schema round-trips to JSON Schema.
- Represent each view key as a `sys.view.*` node (the "option node" A1 names), so
  views are referable from data.
- Collapse the outline's `sys.f.view.*` modes and `GRAPH_RENDERERS` into `ViewPoint`
  (closes GAP `01M3EZRFJ9RYFJJ4MW322RQ28S`).
- Decide the saved-view home: `.kb/views/*.json` becomes either a materialized
  projection of `#view` nodes or goes away. Render templates (`TemplatePoint`) are
  simply the md/html *output* views of the same catalog.

**Stage 1: generated view nodes (R2 over MCP).**
- `kb_manifest` lists the view catalog: key, placements, param JSON Schema, a
  one-line description and a sample. It also lists the tag and field schema.
- Add a `view.propose` action (or validation on `node_add` for `#view`) that checks
  the query parses and runs, that the key exists, and that the params validate. It
  returns the rendered md preview together with the problems it found. The agent loop
  in Claude or Codex *is* the generator, so kb makes no LLM call.
- `render_view` accepts a view-node id. `ui://kb/view/<id>` serves the kb view bundle
  in the MCP App, and it gets the node plus results through `tool-result`, not
  generated HTML. Use app-only tools (`visibility: ["app"]`) for the
  refresh/subscribe/drill-down calls the view makes.
- Exit criterion: "show my open todos by status as a board" produces a `#view` node
  that renders identically in `kb ui`, in Claude desktop, and as md in Claude Code.

**Stage 2: composition as outline.**
- A dashboard or page layout is a `#view` node whose **children are view nodes**. A
  layout view such as a split, grid or tabs arranges its children, and the child edge
  is the layout tree. Do not invent a layout JSON. (This is also exactly A2UI's
  adjacency list, which keeps a later adapter cheap.)
- Views pass context down through params, for example a selected node id from a
  list view to a detail view. That is still data.

**Stage 3: bounded expressions (R3) and per-value presentation.**
- Add a small, pure expression layer for computed columns, conditional formatting,
  group-by keys and labels. The options are datalog rules/functions (preferred, since
  it is already the query layer) or a json-render-style directive set evaluated over
  rows. Formulas are nodes, Potluck/Embark style.
- Let view params reference value-kind presentations, so the per-value view registry
  becomes addressable from view nodes.
- Optional: a Vega-Lite chart view whose param *is* a Vega-Lite spec (a stable, BSD
  grammar that LLMs write well). This is the one place an external declarative grammar
  earns entry, because it is a *param of one view*, not a second catalog.

**Stage 4: in-app generation and persistent preferences.**
- A ⌘K "describe a view" in the kb UI, using a configured provider or MCP sampling.
  It returns a *proposed* `#view` node as a transient, reviewable draft (the Airtable
  Omni plan-then-build pattern), and accepting it commits the node.
- Store the user's structural preferences (grouping, vocabulary, default views per
  tag) as nodes that later generations read, the Maru finding. Tag-level default views
  come from the same mechanism (A1's open question 3).

**Stage 5: sandboxed code views (R5), behind one bridge.**
- A `#code-view` node holds model-written HTML/JS as text or as an `assets/` file,
  plus declared capabilities: the read actions it may call, write actions that need
  confirmation, and a CSP allowlist that defaults to none.
- **Both the kb UI and MCP hosts run it through the MCP Apps protocol.** The kb UI
  embeds it through `@modelcontextprotocol/ext-apps/app-bridge` or `@mcp-ui/client`
  `AppRenderer` with a double iframe on a separate origin. Data arrives only through
  `tools/call` to kb actions, mediated and logged by the host. Model-written code never
  gets same-origin access or direct store access.
- A code view is just another `ViewPoint` entry (`code-view`) whose param is the code
  node's id, so it joins the view contract suite and needs no second view system.
  Persistence is the node, so it versions with `nodes.jsonl`.
- Put this rung *after* Stage 3 because the evidence says most user needs are met by
  configuring existing views, and because code views are the hardest to debug.

**Stage 6: promotion (the gentle slope, R6).**
- A code view that proves itself can be *promoted* to a trusted `.kb/extensions`
  plugin contributing a real `ViewPoint` entry, through review and a commit. The
  reverse, forking a built-in view into an editable code view, completes Ink &
  Switch's user-to-creator slope.

**Optional edge adapters (any time after Stage 2, once A2UI 1.0 is final):**
`#view` subtree → A2UI surface or json-render spec for foreign renderers or other
agents, and import of A2UI surfaces as view nodes. These live at the edge as
translations, never as the model.

### Don't
- Don't let the model write HTML for `ui://kb/view/*` at Stage 1. MCP Apps is designed
  around pre-declared, reviewable templates.
- Don't take a dependency on A2UI, json-render, OpenUI or Open-JSON-UI in core while
  they are 0.x or RC.
- Don't build an AG-UI chat surface unless kb ships its own in-app agent. MCP already
  covers "agent drives kb."
- Don't rely on MCP Apps state persistence (it is deferred in the spec). Persist state
  as nodes, which is the natural place anyway.

---

## 9. Open questions for the owner
1. Does a generated view carry provenance (model, prompt, source session) as fields?
   This is cheap, and useful for debugging and trust.
2. For `ui://kb/view/<id>`, should MCP hosts get a *live* subscription (app-only tool
   polling or a push over `/ws`)? That needs a `connectDomains` entry for the local
   server, which remote hosts such as claude.ai cannot reach, so the realistic answer
   is snapshot plus refresh tool calls.
3. Is Vega-Lite wanted as a first-class chart view, or should charts stay native
   renderers only?

---

## Sources

**MCP Apps / hosts**
- SEP-1865 page: https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp
- Stable spec 2026-01-26: https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx
- Draft spec: https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx
- ext-apps repo and SDK: https://github.com/modelcontextprotocol/ext-apps · API: https://apps.extensions.modelcontextprotocol.io/api/
- MCP blog, proposal (2025-11-21): https://blog.modelcontextprotocol.io/posts/2025-11-21-mcp-apps/
- MCP blog, launch (2026-01-26): https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/
- Claude interactive connectors: https://claude.com/blog/interactive-tools-in-claude
- Claude Code MCP Apps issue #95149: https://github.com/anthropics/claude-code/issues/95149
- ChatGPT MCP Apps: https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt · Apps SDK reference: https://developers.openai.com/apps-sdk/reference · changelog: https://developers.openai.com/plugins/changelog
- MCP-UI: https://github.com/MCP-UI-Org/mcp-ui · https://mcpui.dev/guide/introduction

**Declarative protocols and libraries**
- A2UI v0.9 announcement: https://developers.googleblog.com/a2ui-v0-9-generative-ui/
- A2UI intro: https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/
- A2UI repo: https://github.com/google/A2UI · spec v1.0 RC: https://a2ui.org/specification/v1.0-a2ui/
- InfoQ on A2UI v0.9: https://www.infoq.com/news/2026/07/google-a2ui-genui/
- json-render: https://github.com/vercel-labs/json-render · releases: https://github.com/vercel-labs/json-render/releases · InfoQ: https://www.infoq.com/news/2026/03/vercel-json-render/
- OpenUI: https://github.com/thesysdev/openui · https://www.openui.com/ · Thesys: https://www.thesys.dev/
- AG-UI: https://github.com/ag-ui-protocol/ag-ui · 1.0 migration: https://docs.ag-ui.com/migrating-to-1-0 · releases: https://github.com/ag-ui-protocol/ag-ui/releases
- CopilotKit guide (2026): https://www.copilotkit.ai/blog/the-developer-s-guide-to-generative-ui-in-2026 · spec support: https://docs.copilotkit.ai/langgraph-python/whats-new/generative-ui-spec-support · Open Generative UI: https://docs.copilotkit.ai/ms-agent-dotnet/generative-ui/open-generative-ui · Open-JSON-UI: https://docs.copilotkit.ai/langgraph-python/generative-ui/open-json-ui · repo: https://github.com/CopilotKit/CopilotKit
- Vercel AI SDK 6: https://vercel.com/blog/ai-sdk-6
- LangGraph generative UI: https://docs.langchain.com/langsmith/generative-ui-react
- assistant-ui generative UI: https://www.assistant-ui.com/docs/tools/generative-ui · repo: https://github.com/assistant-ui/assistant-ui
- Tambo: https://github.com/tambo-ai/tambo · https://docs.tambo.co/
- Hashbrown: https://github.com/liveloveapp/hashbrown · https://hashbrown.dev/docs/react/concept/components
- Vega-Lite releases: https://github.com/vega/vega-lite/releases

**Code generation and malleable software**
- Ink & Switch, Malleable Software essay: https://www.inkandswitch.com/essay/malleable-software/
- Patchwork dispatch (May 2026): https://www.inkandswitch.com/newsletter/dispatch-017/ · Patchwork notebook: https://www.inkandswitch.com/patchwork/notebook/2024-version-control/01/
- Potluck: https://www.inkandswitch.com/potluck/ · Embark: https://www.inkandswitch.com/embark/
- Geoffrey Litt, Malleable software in the age of LLMs: https://www.geoffreylitt.com/2023/03/25/llm-end-user-programming.html · Dynamic documents: https://www.geoffreylitt.com/2022/11/23/dynamic-documents
- Maru (arXiv 2608.25565): https://arxiv.org/abs/2608.25565
- Conversational Customization (arXiv 2605.11149): https://arxiv.org/abs/2605.11149
- Google Research, Generative UI: https://research.google/blog/generative-ui-a-rich-custom-visual-interactive-user-experience-for-any-prompt/
- tldraw starter kits: https://tldraw.dev/starter-kits/overview · make-real-starter: https://github.com/tldraw/make-real-starter · agent-template: https://github.com/tldraw/agent-template
- Val Town Townie: https://blog.val.town/codegen · changelog: https://blog.val.town/changelog-2026-09-10
- Observable Notebooks 2.0: https://observablehq.com/notebook-kit/
- Tana AI command nodes: https://outliner.tana.inc/learn/features/ai-command-nodes · https://outliner.tana.inc/docs/command-nodes
- Notion 3.3 Custom Agents: https://www.notion.com/releases/2026-02-24 · Notion AI: https://www.notion.com/product/ai
- Airtable Omni: https://www.airtable.com/platform/app-building · AI interface elements: https://support.airtable.com/docs/ai-generated-interface-elements-in-airtable
- Retool AppGen: https://retool.com/blog/introducing-enterprise-appgen
- Claude Artifacts storage and MCP *(secondary)*: https://www.eigent.ai/blog/claude-live-artifacts-guide · https://caipi.ai/blog/can-claude-artifacts-save-data
