# Research: bb vs a harness on pi / omp (loop control, subscriptions, ToS)

Date: 2026-10-24. Not legal advice; this summarises sources. Each claim is tagged
**[doc]** (primary source says so), **[reported]** (secondary reporting), **[inferred]**
(my reading), or **[unknown]**.

## Summary

1. The "third option" mostly exists already. This host's `bb provider list --all` shows
   `pi` and `acp-omp` (also `acp-opencode`, `acp-grok`, `acp-hermes-agent`, `acp-cursor`, `codex`,
   `claude-code`) **[observed]**. Neither CLI is installed here: `bb provider models pi` fails with
   `missing_executable`, "Install @earendil-works/pi-coding-agent". So bb as UI/orchestrator over
   a pi or omp loop is a supported configuration, not a new build.
2. Loop control in bb lives below bb, in the provider process. bb's one hook,
   `message.dispatch`, can only proceed, wait or reject and is "never an owner or an author of the
   work" **[doc]**. Pi's extension API is the opposite: it hooks the context, provider
   request, every tool call and result, and agent settle **[doc]**. If the owner wants to own the
   loop, the lever is pi/omp extensions, not bb.
3. Subscriptions. Anthropic's docs say subscription OAuth is for Claude Code and native Anthropic
   apps, and that third-party developers may not route requests through Free/Pro/Max credentials.
   Reusing OAuth tokens in your own harness is on the wrong side of that **[doc]**. Driving the
   unmodified `claude` binary (what bb's claude-code provider and Griesser's pi-claude-code do)
   sits in a documented grey zone: Anthropic's support page says `claude -p`, the Agent SDK and
   third-party apps "still draw from your subscription limits", but a billing change was announced
   and paused, and the legal page points developers to API keys. OpenAI is explicitly more
   permissive for ChatGPT plans in Codex-adjacent tools (reported, not verified in an OpenAI primary
   source).
4. Recommendation: stay on (a)/(b). Use bb as is, add omp or pi as a provider, and put loop
   customisation into pi/omp extensions. Build (c) only if you need things bb's UI cannot be
   extended to do (durable multi-conversation runtime, hot-reloading harness).

## 1. The Griesser post

Source: https://danielgriesser.com/posts/ultimate/ (23 Oct 2026) **[doc]**.

- "Ultimate" is an experimental, self-extending agent harness on **Pi Durable**, with a web UI.
  Repo: https://github.com/HazAT/ultimate (MIT, 186 stars, pushed 2026-10-24 **[gh api]**).
- Architecture: coordinators plus worker/reviewer/scout/designer subagents; one git worktree per
  feature; agents boot a test server per branch and drive it with a browser; hot reload via a
  supervisor that holds the port; standing agents (lander, deployer, writer); "notes" that are
  inter-agent messages that do not trigger a turn; Tab-fork side chats; multi-instance over
  Tailscale; diff-review tool; DB backup.
- Models named: Opus for coordinator, "GPT 6.1 Sol" for workers, "Astra" for correctness review,
  "Luna" as summary model. Initial one-shot version built with Claude Code.
- Argument: owning the harness makes it editable while it runs, which is "the fastest I have ever
  iterated on software". He does not recommend others use it ("at your own risk").
- Subscriptions: says it "technically" works with a Claude subscription because the
  pi-claude-code extension pipes requests through the Claude CLI. Makes no ToS claim.
- The post does not mention omp.
- Related: Pi Durable (https://earendil.com/posts/pi-durable/): experimental runtime for
  crash-resilient, concurrent, forkable, multiplayer conversations; explicitly "does not replace the
  Pi coding agent"; API "might still change" **[doc]**.

## 2. pi and omp

### Repos (verified with `gh api`)

| Project | Repo | License | Stars | Last push |
|---|---|---|---|---|
| pi | https://github.com/earendil-works/pi (the old `badlogic/pi-mono` URL redirects here) | MIT | ~117k | 2026-10-23 |
| omp (oh-my-pi) | https://github.com/can1357/oh-my-pi (Stencil Labs; "fork of Pi by Mario Zechner") | MIT | ~36k | 2026-10-22 |
| pi-claude-code | https://github.com/earendil-works/pi-claude-code | MIT | 166 | 2026-10-12 |

Both are very active. Pi moved from Mario Zechner's account to Earendil Works (packages now
`@earendil-works/*`) **[doc]**. omp's contribution policy was flipping ("PRs temporarily open to
everyone as a trial") **[doc]**, so expect churn.

### Pi architecture (docs under `packages/coding-agent/docs/` in earendil-works/pi)

- Loop (`how-pi-works.md`): message appended to active branch, request built from system prompt,
  branch, tools and model settings, response streamed, tool calls executed, repeat. Steering and
  follow-up messages are queued. Packages: pi-ai (multi-provider LLM API), pi-agent-core, pi-coding-agent,
  pi-tui, pi-durable, chord (hot-reloadable plugin host), pi-telemetry.
- Hook points (`extensions.md`): `input`, `before_agent_start`, `context`, `context_with_system`,
  `before_provider_headers`, `before_provider_request`, `after_provider_response`,
  `provider_stream_event`, `tool_call`, `tool_result`, `agent_before_settle` (can request
  continuation), `agent_settled`. Extensions are TypeScript loaded in-process via jiti and can
  register tools, commands, providers, renderers, TUI. Extensions run with full process permissions.
- Deliberately skips sub-agents and plan mode (README): "Ask Pi to build what you want".
- Sessions (`sessions.md`, `session-format.md`): JSONL tree, branches via `/tree`, `/fork`,
  `/clone`, compaction entries keep originals.
- Embedding: print/JSON mode, `--mode rpc` (JSONL stdin/stdout, `docs/rpc.md`), in-process TypeScript SDK
  (`docs/sdk.md`).
- Auth (`providers.md`): `/login` for OAuth or API key per provider, stored in `auth.json`;
  API keys via env vars (incl. `ANTHROPIC_API_KEY`); Anthropic also accepts `ANTHROPIC_OAUTH_TOKEN`.

### omp additions (README of can1357/oh-my-pi)

Fork with Rust natives (~80k lines claimed), 60+ providers, 31 built-in tools, LSP and debugger (DAP)
integration, subagents, persistent Python/Bun eval kernels, memory backends, hooks
(`docs/hooks.md`), `omp --mode rpc`, and `omp acp` (Agent Client Protocol over stdio). It
imports `.claude`, `.cursor`, `.codex` etc. rules, skills and MCP servers. README lists auth tags:
Anthropic `oauth`, OpenAI Codex `oauth`, Cursor/Copilot `oauth`, various coding plans `plan`.
So both pi and omp can log in with subscription OAuth in their own right; whether you should is
section 4.

## 3. bb's relationship to pi

**Existing providers [observed, `bb provider list --all`, skills]:** `pi` (skill `pi-provider`:
edit/rerun messages and compaction supported), `acp-omp` (auto-discovered if `omp` is on PATH,
per skill `acp-provider`; `dialect: "omp"` side channels), plus `acp-opencode`, `acp-grok`,
`acp-hermes-agent`, `acp-cursor`, and custom ACP agents via the `provider-acp` plugin's
`customAgents` setting. The `pi` provider requires the `@earendil-works/pi-coding-agent` CLI on
the host. How bb's `pi` provider talks to pi (RPC vs SDK) is not documented in the skills I read
**[unknown]**; T3 Code's analogous `provider-pi` spawns `pi --mode rpc` (/private/tmp/t3code-research/src/packages/provider-pi/src/settings.ts) **[inferred as likely]**.

**What control bb gives over the loop today (SDK types:
`.../bbim/node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk.d.ts`):**

- `bb.hooks.on("message.dispatch")` (line ~23053): one admission checkpoint, decisions only
  `proceed | wait(sendAt) | reject(message)`. Comment: "There is deliberately no 'handled it myself'
  answer and no amendment arm — a hook is a decision, never an owner or an author of the work."
  Fail-closed, 10 s box. Cannot rewrite the prompt, touch tool calls, or alter turns.
- `bb.events` (post-hoc, return ignored).
- `bb.agents.registerTool`, `configure` (select tools/skills/instructions per thread),
  `contributeInstructions` (<=4096 chars): add tools and prompt text; applied at next session start.
- `bb.providers.register(PluginProviderDeclaration)` (line ~23699, 23930): a plugin can add a
  provider, but the executable part is a "provider bridge" exported from the plugin's `bb.host`
  artifact. The declaration carries capabilities (fork level, compaction, archive, rename,
  permission modes, reasoning levels), model catalog, composer actions, and
  `experimental_bridgeOptions` (e.g. an ACP command spec). A plugin with no `bb.host` entry is
  refused. The bridge contract is in `docs/provider-plugin-api.md`, which I could not read **[unknown]**.
- Own providers claude-code and codex: per skills, bb passes the CLI only
  `CLAUDE_CODE_OAUTH_TOKEN`/executable path (claude-code); the loop belongs to the vendor binary.

**Could a plugin wrap pi/omp?** Yes, and bb already ships it (pi, acp-omp). The only new work
would be a custom bridge if you want more than RPC/ACP exposes (e.g. surface pi's extension
UI, branching, `agent_before_settle` continuation). The control split is then: bb owns UI,
threads, worktrees/environments, dispatch policy, cross-thread orchestration; pi/omp owns
loop, context assembly, tools, compaction. Your loop customisation goes in pi extensions or omp
hooks, loaded by the provider process.

Open caveat **[unknown]**: whether bb's `pi`/`acp-omp` providers load your `~/.pi/agent/extensions`
/ omp `.omp` hooks, and how pi extension UI requests (`extension_ui_request`) map to bb UI.
ACP in particular carries a fixed protocol surface; omp-specific features reach bb only through the `omp` dialect.

## 4. ToS and subscriptions

### Anthropic

**Documented**
- Claude Code legal page (https://code.claude.com/docs/en/legal-and-compliance): OAuth auth "is
  intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise" and "designed
  to support ordinary use of Claude Code and other native Anthropic applications". Developers
  "building products or services that interact with Claude's capabilities, including those using the
  Agent SDK, should use API key authentication". "Anthropic does not permit third-party developers to
  offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max
  plan credentials on behalf of their users", nor collect/store/intermediate Claude.ai credentials or
  session tokens. Enforcement "without prior notice". Advertised Pro/Max limits "assume ordinary,
  individual usage of Claude Code and the Agent SDK".
- Same page: running Claude Code in your product requires the Commercial Terms and an unmodified
  binary; each end user authenticates with their own key or plan; an end user may sign into the
  unmodified binary with their own subscription, including on a platform that hosts it.
- Agent SDK overview (https://code.claude.com/docs/en/agent-sdk/overview): "Unless previously
  approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits
  for their products, including agents built on the Claude Agent SDK." Branding: no "Claude Code"
  naming in your product.
- Consumer Terms (https://www.anthropic.com/legal/consumer-terms) s.3: no access "through
  automated or non-human means, whether through a bot, script, or otherwise" except via API key
  "or where we otherwise explicitly permit it"; s.2: do not share account credentials.
- Support page (https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan):
  May 2026 announced that Agent SDK / `claude -p` / third-party use would move to a separate credit; June 15
  2026 "paused ... For now, nothing has changed"; these still "draw from your subscription limits";
  Oct 7 2026: Max and Team plans "now include monthly API credits" covering SDK, `claude -p`, API, Managed
  Agents (Pro not mentioned). Zed's write-up (https://zed.dev/blog/anthropic-subscription-changes) says
  Anthropic will give advance notice before future change.

**Reported (secondary)**
- Jan 2026: server-side safeguards against tools spoofing the Claude Code client; Anthropic's
  Thariq Shihipar on X (VentureBeat, https://venturebeat.com/technology/anthropic-cracks-down-on-unauthorized-claude-usage-by-third-party-harnesses);
  some accounts auto-banned, said to be reversed. OpenCode, Cursor named as affected.
- Feb 2026: docs updated to state OAuth tokens are for Claude Code/Claude.ai only (e.g.
  https://gigazine.net/gsc_news/en/20260220-anthropic-third-party-block); Mar 2026: reported legal demand to
  OpenCode and removal of Anthropic OAuth from it (https://falcao.org/posts/anthropic-claude-access-crackdown-ecosystem-fallout/);
  Apr 2026 reports of a subscription change for OpenClaw-style tools. I did not verify these against Anthropic primary sources;
  accounts differ on whether any of it was new policy.

**Reading (inferred):**
- Direct OAuth token reuse in your own harness (pi `/login anthropic`, omp Anthropic oauth, a
  plugin that stores a token): the documented prohibition applies most clearly; this is what enforcement targeted.
- Spawning the unmodified `claude` binary under your control (`claude -p`, Agent SDK, bb's
  claude-code provider, pi-claude-code): the credential never leaves Claude Code, and the end-user-signs-in
  language fits, but "Agent SDK ... use API keys" and the paused billing change leave it unsettled.
  pi-claude-code's own README warns "The future of this extension is uncertain" and refuses to run if
  API-key/proxy overrides are set (https://github.com/earendil-works/pi-claude-code).
- Anything that makes pi's loop a *wrapper around the model only* (pi-claude-code: Claude
  Code "only talks to the model", Pi runs tools) is the sort of thing that is hardest to call "ordinary use of Claude
  Code"; **[unknown]** how Anthropic would treat it.
- Safest documented path: API key (Claude Console/Bedrock/Vertex) in pi/omp, or the real
  Claude Code via bb's claude-code provider for subscription use.

### OpenAI / ChatGPT plans
- Reported (New Stack headline, "OpenAI makes 'Sign in with ChatGPT' a way to use your subscription
  in third-party developer tools", https://thenewstack.io/sign-in-with-chatgpt/; body not retrievable) and a
  secondary blog (https://manifest.build/blog/chatgpt-plus-tokens-third-party-harnesses/): OpenAI named launch partners
  including OpenCode and Pi, usage counts against the plan, per-app caps; an OpenAI exec said Pi and OpenCode are ~10%
  of Codex traffic; described as "for now", not contractual. I found no OpenAI help-center or ToS page
  in this pass **[unknown / unverified]**.
- Both pi (`/login`) and omp (`codex oauth`) offer OpenAI Codex login; bb's `codex` provider drives
  the Codex app server. Contrast with Anthropic: OpenAI appears to sanction this, Anthropic does not.

## 5. Comparison

| Goal | (a) bb as is | (b) bb + pi/omp provider | (c) custom harness on pi/omp + own UI |
|---|---|---|---|
| Control of loop | Low: vendor binaries own it; hook is admission only | High inside provider: pi events / omp hooks; bb cannot see inside beyond protocol | Full, incl. durability (Pi Durable) and hot reload |
| Multi-agent orchestration | bb threads, worktrees, workflows, cross-thread messaging; mixed providers | Same, pi/omp as another provider; omp has own subagents | You build it (Griesser built coordinators, notes, standing agents) |
| UI | Existing, plugin-extensible | Existing; pi-specific features reach bb only via provider capabilities | Build and maintain it (web UI, review, diff) |
| Subscriptions | Real Claude Code / Codex: most defensible | Claude: risky unless via real `claude`; Codex: reportedly OK; API keys fine | Same as (b), plus you own the compliance risk |
| Extensibility | Plugins, tools, hooks, providers | Plugins plus pi/omp extensions (two systems) | Single system, unlimited |
| Maintenance | Lowest | Low-medium: two fast-moving upstreams (pi moved orgs; omp fork churn), bridge fidelity | Highest; Griesser says no stability guarantees |

**Recommendation:** (b). It is already half-configured: install `@earendil-works/pi-coding-agent` and/or
`omp` on the host and the providers light up. Keep Claude subscription use on the real
`claude-code` provider; run pi/omp with API keys (or ChatGPT/Codex login) for the loop you want to own.
Spike: write one pi extension using `context` + `tool_call` + `agent_before_settle` and check it fires when pi
is driven by bb. If bb's provider surface blocks something you need, then consider (c); do not start there.

**Other projects (not deeply verified):**
- T3 Code (https://github.com/pingdotgg/t3code, source at /private/tmp/t3code-research/src,
  last commit 2026-10-23): control surface over Claude Code, Codex, Cursor, Grok Build, OpenCode,
  Antigravity; has `provider-pi`, `provider-acp`, mobile and web. Closest analogue to bb.
- Conductor (Melty Labs, macOS, parallel worktrees over Claude Code/Codex), Sculptor (Imbue, MIT,
  Claude Code and Imbue's Pi harness) [reported, SEO-grade sources].
- OpenCode (open-source TUI agent; bb has `acp-opencode`); Zed (ACP editor, original ACP host);
  Hermes Agent, Grok Build (bb ACP providers); OpenClaw (referenced by Pi README as a pi SDK
  integration); Pi Durable; Crush: nothing found.

## Open questions

- Which pi/omp features does bb's `pi` and `acp-omp` bridge expose (extension UI, tree/fork,
  `agent_before_settle`)? Does it load user extensions?
- Does bb's `pi` provider use RPC or the SDK? Can extensions be shipped per project/environment?
- Does the owner want to run omp or pi only on API keys, and does that cost fit (the subscription
  was reportedly subsidised 15-30x vs API pricing per Zed)?
- Would Anthropic accept a bb-style orchestrator on subscription? Only Anthropic can answer (sales contact
  on the legal page).

## Could not verify

- OpenAI's own policy text; the New Stack article body (page returned only the headline).
- Anthropic's Feb/Mar/Apr 2026 events beyond secondary reports; the exact current Consumer Terms
  wording beyond s.2-3.
- bb's provider bridge contract (`docs/provider-plugin-api.md`), how the shipped `pi` provider
  is implemented (plugin dirs on disk contain only data/logs).
- Pi's OAuth login for Anthropic specifically (the `providers.md` excerpt I read was truncated before the OAuth list; omp's README
  does list Anthropic oauth).
- Star counts / stability beyond the `gh api` snapshot; third-party tool pricing claims.
