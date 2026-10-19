# Agent provider terms: what connects cleanly

Checked 2026-10-18. Which ways of connecting agent harnesses to model
providers stay within each provider's terms, and where CLIProxyAPI (packaged
here as `cli-proxy-api`, behind the `claudex` function on the Macs) falls.
Re-check before relying on it: these positions move.

## Rule

- **Claude:** only the official `claude` binary or the Agent SDK, signed in
  with your own subscription, or an API key. Nothing else holds a Claude
  subscription credential.
- **Codex / ChatGPT:** the official Codex CLI or app-server, or a harness
  OpenAI names as supported. A ChatGPT account through a proxy is tolerated,
  not contracted.
- **Gemini / Antigravity:** official clients only.
- **API-key upstreams** (DeepSeek and the like) are fine anywhere.

## Anthropic

[Legal and compliance, "Authentication and credential use"](https://code.claude.com/docs/en/legal-and-compliance)
(primary source):

- Subscription OAuth "is designed to support ordinary use of Claude Code and
  other native Anthropic applications".
- "Anthropic does not permit third-party developers … to route requests
  through Free, Pro, or Max plan credentials on behalf of their users", and
  developers "may not collect, store, or intermediate Claude.ai credentials or
  session tokens".
- Signing in to the unmodified Claude Code binary with your own subscription
  is allowed, including where a platform hosts it.
- Enforcement may come "without prior notice".

Enforcement so far (secondary sources): server-side blocks on impersonating
harnesses (January 2026); OpenCode removed Claude OAuth after legal requests
([The Register, February 2026](https://www.theregister.com/software/2026/02/20/anthropic-clarifies-ban-on-third-party-tool-access-to-claude/5014546));
subscriptions stopped covering OpenClaw
([InfoWorld, April 2026](https://www.infoworld.com/article/4154435/anthropic-cuts-openclaw-access-from-claude-subscriptions-offers-credits-to-ease-transition.html)).

## OpenAI

An OpenAI executive (Tibo Sottiaux) has said publicly that ChatGPT accounts
work in third-party harnesses such as OpenCode and Pi, and "Sign in with
ChatGPT" ships to partner products
([post](https://x.com/thsottiaux/status/2058071172361998482),
[The New Stack](https://thenewstack.io/sign-in-with-chatgpt/)). That is a
public statement, not terms text; resale proxies are reportedly unsupported.

## Google

Forum reports of 403 terms-of-service bans for Antigravity and Gemini OAuth
used through third-party tools
([Google AI forum](https://discuss.ai.google.dev/t/urgent-mass-403-tos-bans-on-gemini-api-antigravity-for-open-source-cli-users-paid-tier/124508/7)).
No primary policy text found.

## CLIProxyAPI

Read at [router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)
commit `2422c6b`:

- **Claude:** signs in with Claude Code's OAuth client ID
  (`internal/auth/claude/anthropic_auth.go:33`), presents a
  `claude-cli/2.1.280` user agent
  (`internal/runtime/executor/helps/claude_device_profile.go:23`), and
  "cloaks" requests with Claude Code's system prompt and a fake user ID
  (`claude_executor_cloaking.go:307`). That is the impersonation and
  intermediation Anthropic prohibits: **not clean**.
- **Codex:** uses Codex's client ID and `Originator: codex_cli_rs`. The
  account use is tolerated; the impersonation is grey.
- **Antigravity:** uses Google's client ID. Avoid.

So `claudex` (Claude Code's harness on GPT through the proxy, with the
proxy holding a ChatGPT login) is tolerated. A Claude login stored in the
proxy is not: check its auth directory for `claude-*` files and remove them.

## T3 Code and Theo

- T3 Code drives every provider through its official CLI, SDK, or ACP.
- `pingdotgg/t3code` reads quota from a CLIProxyAPI hub
  (`apps/server/src/usage/cliproxyApi.ts`, [PR #9507](https://github.com/pingdotgg/t3code/pull/9507),
  documented as "Connect a CLIProxyAPI hub"). It sends no model traffic, but
  for Claude it needs the hub to hold a Claude login, so leave it off for
  Claude; it is fine for Codex.
- Theo's `claudex` recipe — CLIProxyAPI "with Claude and Codex auth", Claude
  Code pointed at it — is the one these dotfiles follow
  ([post](https://x.com/theo/status/2076114415368482854), seen through search
  snippets only). Someone well known using it does not change Anthropic's
  terms.
