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

Working rule:
- Treat this repo as the source of truth for intentional system configuration.
- Treat user data, application state, databases, caches, and agent memory as backup concerns unless explicitly modeled here.


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
