# Agent Notes

## Shared engineering rules

<!-- GAP [[01M56SQJF52DWN2T00D510BRQ3]]: kb links name the pinned release by hand. -->
Four rules are shared with kb and have their one home in
[kb's AGENTS.md](https://github.com/popemkt/kb/blob/v0.3.0/AGENTS.md):
[Rule 1 — Abstraction before addition](https://github.com/popemkt/kb/blob/v0.3.0/AGENTS.md#rule-1--abstraction-before-addition),
[One contract, every implementation](https://github.com/popemkt/kb/blob/v0.3.0/AGENTS.md#one-contract-every-implementation),
[Canonical statements](https://github.com/popemkt/kb/blob/v0.3.0/AGENTS.md#canonical-statements), and
[Drift markers and gaps](https://github.com/popemkt/kb/blob/v0.3.0/AGENTS.md#drift-markers-and-gaps). They apply in full
here too, and Rule 1 still outranks every other consideration in this repo.
Read them there before any change; they are not restated here. Where they
speak of nodes, rules, and gaps, this repo's are in its own kb store (see
[kb](#kb--repo-knowledge-base)).

## Gate (run first)

This repo is the durable record of an intent => behavior translation process.
Admission is gated. Before doing any work here, run:

```bash
intent/gate.sh session <your-harness-name>
```

Non-zero exit means required tools are missing — restore the environment first
(`rebuild`, or `nix develop`) instead of working around it. All interaction
surfaces and their shims are listed in `intent/SURFACES.md`; commits are
independently gated by `.githooks/pre-commit` (record admission).

Start with the docs in [docs/](/Users/popemkt/.dotfiles/docs) before making structural changes.

Relevant docs:
- [backup-strategy.md](/Users/popemkt/.dotfiles/docs/backup-strategy.md): what should be declarative, what should be backed up as state, and how to decide where new app data belongs
- [nix-concepts.md](/Users/popemkt/.dotfiles/docs/nix-concepts.md): core Nix model for this repo
- [home-manager-options.md](/Users/popemkt/.dotfiles/docs/home-manager-options.md): user-level config patterns
- [nix-darwin-options.md](/Users/popemkt/.dotfiles/docs/nix-darwin-options.md): macOS-specific config patterns
- [troubleshooting.md](/Users/popemkt/.dotfiles/docs/troubleshooting.md): common recovery steps
- [ci.md](/Users/popemkt/.dotfiles/docs/ci.md): what CI gates, what it deliberately
  does not gate and why, and the one manual step left (branch protection)
- [tailscale.md](/Users/popemkt/.dotfiles/docs/tailscale.md): policy ownership,
  GitHub OIDC enrollment, and every remaining manual Tailscale control-plane
  step

Working rule:
- Treat this repo as the source of truth for intentional system configuration.
- Treat user data, application state, databases, caches, and agent memory as backup concerns unless explicitly modeled here.

## Overview

Declarative macOS configuration built with nix-darwin, Home Manager, Homebrew,
and Mackup.

## Commands

```bash
rtk rebuild
rtk nix flake update && rtk rebuild
rtk nix flake check
rtk nix run .#github-sources -- check
rtk nix run .#github-sources -- verify
rtk nix run .#github-sources -- update
rtk ./scripts/uv-sources check
rtk ./scripts/uv-sources update
rtk mackup backup
rtk mackup restore
```

`rebuild` applies the configuration (nix-darwin on macOS, `nixos-rebuild` on
NixOS), installing missing declarations without upgrading anything. On macOS it
then runs the drift audit and `system-setup status`; neither is wired for NixOS yet (a `#gap` node). Upgrades go through
`update-system` and `apply-system-update`; see
[Rebuild And Update Behavior](docs/github-release-packages.md#rebuild-and-update-behavior).
The GitHub-sources commands check, verify, or refresh direct GitHub release
pins.

On a host several people apply from (shared-server; `/etc/dotfiles/shared-host`
exists), always apply with `rebuild`, never a bare `nixos-rebuild`: it switches
only from a clean checkout at `origin/main` and otherwise refuses, telling you
to pull, push, or commit first. A stale or uncommitted tree would roll back
what someone else applied. `REBUILD_LOCAL=1` overrides, for emergencies only.
A rebuild there never restarts an app with an `idleCheck` (bb, which runs
every agent thread): it prints `app-<app>: restart pending until idle`, and
the app restarts once it reports idle (`sudo systemctl restart app-<app>`
forces it; `journalctl -u app-<app>-restart-when-idle` shows the wait). An
agent there still runs `rebuild` detached, e.g.
`nohup rebuild >~/rebuild.log 2>&1 &`, then reads the log: a foreground
rebuild dies with its thread if anything does restart bb.

## kb — repo knowledge base

<!-- GAP [[01M56SQJF52DWN2T00D510BRQ3]]: kb links name the pinned release by hand. -->
`kb` is a graph datastore with an outliner projection, developed in
[popemkt/kb](https://github.com/popemkt/kb) (specs:
[DESIGN.md](https://github.com/popemkt/kb/blob/v0.3.0/DESIGN.md),
[DESIGN-UI.md](https://github.com/popemkt/kb/blob/v0.3.0/DESIGN-UI.md),
[DESIGN-REFINE.md](https://github.com/popemkt/kb/blob/v0.3.0/DESIGN-REFINE.md)).
This repo holds no kb code: it installs kb's GitHub release (`pkgs/kb`, a
[direct release package](docs/github-release-packages.md) bumped like the
others) on every host and in the dev shell, and keeps its own small store.
Everything here calls it as `kb` from PATH (the gate, CI, `.mcp.json`), and
the gate refuses a session whose `kb` is not the pinned release.
Todos, notes, rules, gaps, and any structured facts about this repo live as
nodes in `.kb/nodes.jsonl` (committed). Everything is a node — fields and tags
too. Props are keyed by field-node id; tags template fields; values may
reference other nodes. Query with datalog (DataScript), or via the MCP server
registered in `.mcp.json` (`kb mcp`). `kb ui` serves the human outliner UI;
media referenced as `![](assets/…)` lives in `.kb/assets/` (Mackup-owned
backup, never committed; see `docs/backup-strategy.md`). Running kb as a
service on a host is [docs/kb-service.md](docs/kb-service.md). `sys.*` nodes
are write-guarded (CLI `--force` to override).

```bash
kb add "Fix drift audit" --tag todo --prop status=doing
kb add --outline plan.md --parent <id>   # a whole outline (Tana Paste) in one tx; kb DESIGN.md → Outline paste
kb search "drift" --json
kb query '[:find ?id ?text :where [?n :f/sys.f.type ?t] [?t :node/text "todo"] [?n :node/id ?id] [?n :node/text ?text]]'
kb query '[:find ?from ?text :where [?e :node/mentions ?m] [?m :node/id "n.root-a"] [?e :node/id ?from] [?e :node/text ?text]]'
kb run <saved-query>            # .kb/queries/<name>.edn
kb field type <field> <text|number|date|url|checkbox|ref|secret>
kb docs materialize             # regenerate docs/kb/*
kb ext list                     # loaded extensions + their actions
```

Rules for agents:
- Prefer `kb` over ad-hoc TODO files for durable repo todos/notes; `--json` for machine output.
- Props are multi-valued: `set` appends — `unset` the old value when changing e.g. `status`.
- Software the repo stops tracking becomes an `#archived` node (fields `purpose`,
  `reason`, `droppedOn`, `lastDeclared`, `cleanup`), never a doc: `kb run archived`
  lists them. Removing a declaration does not uninstall it, so `cleanup` says what
  each machine keeps.
- `[[id|label]]` in node text and any `{t:"ref"}` prop value are both the ref
  form. Use `kb backlinks <id>` or the datalog example above.
- `docs/kb/*.md` is generated (header marks it); edit data, then
  `kb docs materialize`. The commit gate runs `kb docs check` and blocks stale
  generated docs.
- Rules and gaps are nodes like everything else: `#rule` (fields `home`,
  `scope`, `principle`, `enforcement`, `gate`) and `#gap` (fields `expected`,
  `current`, `impact`, `closes`, `rule`), rendered to `docs/kb/rules.md` by the
  `rules` view; never hand-edit it. A closed gap keeps its node with
  `status=done`. Add a gap with:

  ```bash
  kb add "GAP: <one line>" --tag gap --create \
    --prop expected="…" --prop current="…" --prop impact="…" --prop closes="…"
  ```
- Changing kb itself happens in popemkt/kb under its own `AGENTS.md`; this repo
  picks the change up with the next release pin.

## Where To Edit

| Intent | Location |
|---|---|
| Add software belonging to a functional stack | `modules/stacks/<stack>` and its matching `my.pkgs.*` channel list |
| Add a functional stack | Declare `options.my.stacks.<name> = mkStack { ... }`, add its config, import it from the stack index for its platform (`modules/stacks/default.nix` when its schema is shared, otherwise `darwin.nix` or `nixos.nix`), then enable it in `hosts/<hostname>/default.nix` |
| Add an unpacked browser extension checkout | `modules/stacks/browsers/` + `system-setup enroll <id>`; Load unpacked stays manual |
| Add a CLI tool without a stack fit | `modules/common/home-manager/packages.nix` (every user, every platform); a build for macOS only goes in `modules/darwin/home-manager/packages.nix` |
| Add a GUI cask without a stack fit | `modules/darwin/system/homebrew.nix` → `homebrew.casks` |
| Add a brew formula without a stack fit | `modules/darwin/system/homebrew.nix` → `homebrew.brews` |
| Add a macOS system setting | `modules/darwin/system/default.nix` → `system.defaults` |
| Add a shell alias | `modules/common/home-manager/shell.nix` |
| Add macOS-only Home Manager config | `modules/darwin/home-manager/default.nix` |
| Change Git config | `modules/common/home-manager/git.nix`; a person's identity in `users/<name>/default.nix` |
| Add an npm global | the owning stack's `my.pkgs.npmGlobals`; without a stack fit, the base list in `modules/common/home-manager/npm-global.nix` |
| Add a uv tool | the owning module's `uvTools`, plus an entry in `_sources/uv-pins.json` |
| Hold a uv tool at a version | set `track = "manual"` on its `_sources/uv-pins.json` entry |
| Add a Bun global | the owning stack's `my.pkgs.bunGlobals` |
| Give a prebuilt NixOS binary a shared library | the owning stack's `my.pkgs.nixLdLibraries` (nixpkgs attribute names) |
| Add a stack's package on one host only | `my.stacks.<stack>.extra.<channel>` in `hosts/<hostname>/default.nix` |
| Add a Claude Code or Codex plugin | the owning stack's `my.pkgs.{claude,codex}{Marketplaces,Plugins}` lists |
| Add a bb plugin | its source in `assets/bb-plugins/<name>` (not `assets/plugins`, whose skills are linked into every agent) and its path in the owning stack's `my.pkgs.bbPlugins`; `modules/common/home-manager/bb-plugins.nix` installs it in place |
| Add host-only config | `hosts/<hostname>/default.nix` |
| Add a work/personal split | `lib.mkIf (config.my.role == "work") { ... }` in the owning system module |
| Add a direct GitHub release package | `nvfetcher.toml` and `pkgs/`; see `docs/github-release-packages.md` |
| Change kb, or the kb version this repo runs | kb's code in [popemkt/kb](https://github.com/popemkt/kb); the version is its release pin, moved with `nix run .#github-sources -- update kb` |
| Add a durable repo todo, note, rule or gap | a node in `.kb/nodes.jsonl` through `kb` (see [kb](#kb--repo-knowledge-base)) |
| Run a native server app on a NixOS host (and expose it) | `my.services.<app>` in `hosts/<hostname>/default.nix` (schema `modules/options/services.nix`); exposed apps become `svc:<app>-<owner>`, which still need a grant and auto-approver in `configs/tailscale/policy.hujson` |
| Expose a private app on the tailnet | `my.stacks.vpn.services` in `hosts/<hostname>/default.nix`, plus its grant and `autoApprovers.services` entry in `configs/tailscale/policy.hujson` (CI checks both); see `configs/specs/app-service-contract.md` |
| Review local voice-tool choices | `docs/local-voice-tools.md` |

Run `rtk rebuild` after a change that should affect the live system.

## Module Boundaries

The repo has two axes, and every module belongs to exactly one of them.

- **Vertical (semantic encapsulation).** A stack under `modules/stacks/` owns
  one functional slice end to end: its option schema, daemons, activation,
  scripts, and package membership. A component that grows past a single file
  gets its own folder inside the stack (`ai-agents/cognee/`), not a prefixed
  sibling. Nothing outside a component should reach into its option subtree to
  decide membership — the component declares its own contributions.
- **Horizontal (cross-cutting mechanism).** A channel in `modules/options/pkgs.nix`
  is a typed merge target, and its executor installs whatever lands there. Stacks
  decide membership; executors never do. Adding software means adding to a
  channel from the owning stack, never editing an executor.

### Writing an executor

Activation runs with a minimal environment. It inherits no interactive PATH,
so an executor that shells out to a package manager must supply that tool's
environment itself. Three rules, each learned from a real breakage:

- **Invoke the tool by absolute path.** `${pkgs.nodejs}/bin/npm`,
  `/opt/homebrew/bin/brew`, `${pkgs.bun}/bin/bun`. Where the tool is owned by
  Homebrew or npm and has no store path, declare the runtime it needs with
  `lib.makeBinPath` rather than assuming PATH — an npm-installed CLI is
  usually `#!/usr/bin/env node` and dies without one.
- **Never read a failed probe as an empty result.** Capture the listing and
  check the exit status. `cmd list | grep -q x` treats "command crashed" and
  "nothing installed" identically, which makes an executor reinstall things
  that already exist.
- **Converge best effort.** Homebrew and npm install their CLIs during the
  same rebuild, so a downstream executor may legitimately find nothing to
  run. Warn and continue; never abort activation over an optional package.

Failing soft is only safe because the drift audit closes the loop: whatever
did not converge shows up under "Tracked But Missing" in
`scripts/audit-system-discrepancies.sh`, which `rebuild` runs. Prefer that pair
over trying to make activation itself infallible.

Group by behavior and ownership boundary, not by app count.

- One-line installs stay in the relevant package list.
- If an app needs install entries plus config files, activation hooks, launchd
  services, defaults writes, symlinks, or dependencies across multiple places,
  create a focused module for that behavior.
- Keep cross-platform behavior in `modules/common/home-manager/`, Home Manager
  macOS user behavior in `modules/darwin/home-manager/`, and nix-darwin system
  behavior in `modules/darwin/system/`. `common` means cross-platform reuse,
  not configuration automatically applied to every local user.
- Host-specific differences belong in `hosts/<hostname>/default.nix`.

### Stack enable vs component gates

`imports` only merges modules into the evaluation. It does not turn them on.
Behavior is gated with `mkIf` against options from `mkStack`.

- **Stack gate** (`my.stacks.<name>.enable`): core always-on behavior for that
  stack. Prefer this for siblings that are inseparable from the stack itself
  (e.g. `ai-agents` → CLIProxyAPI, Hermes).
- **Component gate** (`componentOptions` on `mkStack`): optional, host-split, or
  mutually exclusive pieces (e.g. `ai-agents.ollama`, `ai-agents.archon`,
  `ai-agents.cognee.{server,client}`, `vpn.services.<name>`).

Leaves may read their own stack/component option path. They must not reach into
another component's option subtree to decide membership. Hosts flip stack and
component switches in `hosts/<hostname>/default.nix`; they do not open sibling
module internals.

## Lint And Format

Before suggesting commits, ensure changed Nix files pass:

```bash
rtk nixfmt **/*.nix
rtk statix check .
rtk scripts/deadnix-repo
rtk nix flake check --no-build
```

The pre-commit hook at `.githooks/pre-commit` runs these checks on staged files.
It is activated with `git config core.hooksPath .githooks` on this clone.

When adding modules, prefer `_:` over `{ ... }:` when no arguments are used;
statix flags empty patterns. Use `{ pkgs, ... }:` only when `pkgs` is actually
referenced.

## Architecture

- `flake.nix` is the entry point. `mkDarwin` and `mkNixos` build one
  configuration per host from a shared host base; each attribute name is the
  hostname.
- `modules/options/` contains cross-cutting typed options only:
  `my.hostname`, `my.people`, `my.pkgs.*` channel merge targets, and
  `my.services`, the native apps a host places (each platform base runs them:
  `modules/nixos/system/services.nix`). Identity only one
  platform has is declared by that platform (`my.{username,role}` in
  `modules/darwin/system/identity.nix`). System
  modules read `config.my.*`; Home Manager reads `osConfig.my.*`. Per-stack
  options live with their stack, not here, and do not use `specialArgs`.
- `modules/stacks/` is the intent layer: vertical functional slices such as
  `ai-agents/`, `office-docs.nix`, and `vpn/`. Each stack owns its option schema,
  config, sibling daemons, and package-channel contributions. `mk-stack.nix`
  provides `enable`, optional component toggles such as `ai-agents.ollama` or
  `vpn.services`, and host additions through `extra.*`, one list per
  executor-installed channel in `modules/options/channels.nix`, which
  `modules/stacks/default.nix` folds into `my.pkgs.*` for every enabled stack. A package may belong to multiple stacks. Homebrew, npm, and Bun
  executors merge contributions with `lib.unique`; Home Manager executors read
  them through `osConfig.my.pkgs.*`. A stack may be one file or a directory with
  `default.nix` and focused siblings.
- `modules/darwin/system/` is the shared macOS base. AI service daemons belong
  to the `ai-agents` stack rather than this directory; this layer owns system
  defaults, the Homebrew executor, input sources, and the external workspace.
- `hosts/popemkt-work/` and `hosts/popemkt-personal/` set role and host-only
  differences on top of the shared Darwin modules.
- Renaming a machine requires renaming its host directory and flake attribute,
  then running `rtk rebuild --flake ~/.dotfiles#<newname>` once. Activation sets
  HostName, ComputerName, and LocalHostName through `networking.*`.
- `modules/common/home-manager/` owns cross-platform user configuration.
- `modules/darwin/home-manager/` owns macOS-specific user behavior.
- `modules/nixos/system/` is the shared NixOS base: an account and Home
  Manager layers for each of `my.people`, plus host-wide tooling.
  `modules/nixos/home-manager/` owns Linux-specific user behavior.
- `users/<name>/` holds one person's own Home Manager choices, the same on
  every host they use. A person's folder selects; shared behavior lives under
  `modules/`.
- `pkgs/` and `_sources/` contain custom packages backed by nvfetcher-managed
  GitHub release pins.
- `configs/` contains raw application configuration.
- Use `lib.optionals pkgs.stdenv.isDarwin [ ... ]` and
  `lib.mkIf pkgs.stdenv.isLinux { ... }` for platform conditionals.

## Gotchas

- The Determinate Nix installer requires `nix.enable = false` in nix-darwin.
- `system.primaryUser` comes from `config.my.username` in `flake.nix`.
- `homebrew.onActivation.cleanup = "none"` preserves unlisted applications;
  `"zap"` would enforce strict removal.
- Touch ID sudo is configured through
  `security.pam.services.sudo_local.touchIdAuth`.

## Repository Identity

- System: Apple Silicon Mac (`aarch64-darwin`)
- GitHub: `popemkt`
- Name: Hoang Nguyen Gia
- Email: `hoangng71299@gmail.com`

## Commit Style

Use `<type>: <short description>` with `feat`, `fix`, `docs`, `refactor`, or
`chore`.
