# Agent Notes

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
rtk mackup backup
rtk mackup restore
```

`rebuild` applies the configuration and upgrades Homebrew plus tracked npm and
Bun globals. The GitHub-sources commands check, verify, or refresh direct
GitHub release pins.

## Where To Edit

| Intent | Location |
|---|---|
| Add software belonging to a functional stack | `modules/stacks/<stack>` and its matching `my.pkgs.*` channel list |
| Add a functional stack | Declare `options.my.stacks.<name> = mkStack { ... }`, add its config, import it from `modules/stacks/default.nix`, then enable it in `hosts/<hostname>/default.nix` |
| Add a CLI tool without a stack fit | `modules/common/home-manager/packages.nix` |
| Add a GUI cask without a stack fit | `modules/darwin/system/homebrew.nix` → `homebrew.casks` |
| Add a brew formula without a stack fit | `modules/darwin/system/homebrew.nix` → `homebrew.brews` |
| Add a macOS system setting | `modules/darwin/system/default.nix` → `system.defaults` |
| Add a shell alias | `modules/common/home-manager/shell.nix` |
| Add macOS-only Home Manager config | `modules/darwin/home-manager/default.nix` |
| Change Git config | `modules/common/home-manager/git.nix` |
| Add an npm global | `modules/common/home-manager/npm-global.nix` |
| Add a Bun global | `modules/darwin/home-manager/bun-global.nix` |
| Add host-only config | `hosts/<hostname>/default.nix` |
| Add a work/personal split | `lib.mkIf (config.my.role == "work") { ... }` in the owning system module |
| Add a direct GitHub release package | `nvfetcher.toml` and `pkgs/`; see `docs/github-release-packages.md` |

Run `rtk rebuild` after a change that should affect the live system.

## Module Boundaries

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

## Lint And Format

Before suggesting commits, ensure changed Nix files pass:

```bash
rtk nixfmt **/*.nix
rtk statix check .
rtk deadnix --fail --exclude ./_sources/generated.nix .
rtk nix flake check --no-build
```

The pre-commit hook at `.githooks/pre-commit` runs these checks on staged files.
It is activated with `git config core.hooksPath .githooks` on this clone.

When adding modules, prefer `_:` over `{ ... }:` when no arguments are used;
statix flags empty patterns. Use `{ pkgs, ... }:` only when `pkgs` is actually
referenced.

## Architecture

- `flake.nix` is the entry point. `mkDarwin` builds one configuration per host;
  each attribute name is the hostname.
- `modules/options/` contains cross-cutting typed options only:
  `my.{username,hostname,role}` and `my.pkgs.*` channel merge targets. System
  modules read `config.my.*`; Home Manager reads `osConfig.my.*`. Per-stack
  options live with their stack, not here, and do not use `specialArgs`.
- `modules/stacks/` is the intent layer: vertical functional slices such as
  `ai-agents/`, `office-docs.nix`, and `vpn/`. Each stack owns its option schema,
  config, sibling daemons, and package-channel contributions. `mk-stack.nix`
  provides `enable`, optional component toggles such as `ai-agents.ollama` or
  `vpn.services`, and host additions through
  `extra.{taps,brews,casks,npmGlobals,bunGlobals}`; everything except `enable`
  is defaulted. A package may belong to multiple stacks. Homebrew, npm, and Bun
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
- `modules/nixos/home-manager/` is the future Linux-specific layer and is not
  currently built.
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


<!-- headroom:rtk-instructions -->
# RTK (Rust Token Killer) - Token-Optimized Commands

When running shell commands, **always prefix with `rtk`**. This reduces context
usage by 60-90% with zero behavior change. If rtk has no filter for a command,
it passes through unchanged — so it is always safe to use.

## Key Commands
```bash
# Git (59-80% savings)
rtk git status          rtk git diff            rtk git log

# Files & Search (60-75% savings)
rtk ls <path>           rtk read <file>         rtk grep <pattern>
rtk find <pattern>      rtk diff <file>

# Test (90-99% savings) — shows failures only
rtk pytest tests/       rtk cargo test          rtk test <cmd>

# Build & Lint (80-90% savings) — shows errors only
rtk tsc                 rtk lint                rtk cargo build
rtk prettier --check    rtk mypy                rtk ruff check

# Analysis (70-90% savings)
rtk err <cmd>           rtk log <file>          rtk json <file>
rtk summary <cmd>       rtk deps                rtk env

# GitHub (26-87% savings)
rtk gh pr view <n>      rtk gh run list         rtk gh issue list

# Infrastructure (85% savings)
rtk docker ps           rtk kubectl get         rtk docker logs <c>

# Package managers (70-90% savings)
rtk pip list            rtk pnpm install        rtk npm run <script>
```

## Rules
- In command chains, prefix each segment: `rtk git add . && rtk git commit -m "msg"`
- For debugging, use raw command without rtk prefix
- `rtk proxy <cmd>` runs command without filtering but tracks usage
<!-- /headroom:rtk-instructions -->
