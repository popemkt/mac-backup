# Orca worktree cleanup inventory

Snapshot captured at `2026-08-16T14:41:02.245Z` for Orca repository `f6f616bb-22d0-43dd-a8f1-75395b66d614` (`.dotfiles`).

## Explicit authorization

The user explicitly authorized deletion of every currently registered non-main worktree except `/Volumes/Data/workspace/repos/.dotfiles/omp-authentication-graph`, identifying the others as completed and merged legacy worktrees. This authorization overrode the prior conservative retention policy, including protections based on unread, `in-progress`, active, live-terminal, or dirty state.

The deletion boundary remained strict: preserve the main worktree, preserve the active unmerged OMP implementation, preserve the backing repository, and do not delete Git branches. Every destructive operation used only `orca worktree rm --force` with the full Orca worktree ID; no raw Git worktree-removal or Git branch-deletion command was run.

## Result

Orca accepted all 47 requested removals with zero failures. All 47 former folders are absent from the filesystem, while the main worktree and OMP worktree remain registered and present.

## Survivors

Git status uses `S/U/?` for staged, unstaged, and untracked entry counts.

| Path | Branch | Orca status/activity | Git cleanliness | Retention reason |
|---|---|---|---|---|
| `/Users/popemkt/.dotfiles` | `main` | working; card=`in-progress`; 28 live terminals | dirty S/U/?: 2/0/2 | Main worktree; categorically protected |
| `/Volumes/Data/workspace/repos/.dotfiles/omp-authentication-graph` | `popemkt/omp-authentication-graph` | working; card=`in-progress`; 1 live terminal | dirty S/U/?: 0/5/0 | Explicitly exempt active, unmerged OMP implementation |

## Removed worktree folders

The branch column records Orca's pre-removal branch label. The detached checkout had no branch label; its recorded value is the commit prefix.

| # | Former path | Former branch label | Result |
|---:|---|---|---|
| 1 | `/private/tmp/kb-ts7-r1` | `detached@729404a87ac4` | Removed with `orca worktree rm --force`; folder absent |
| 2 | `/Users/popemkt/.t3/worktrees/.dotfiles/t3code-627d7d6b` | `t3code/understand-repo-purpose` | Removed with `orca worktree rm --force`; folder absent |
| 3 | `/Volumes/Data/workspace/repos/.dotfiles/kb-audit-fixes` | `kb-audit-fixes` | Removed with `orca worktree rm --force`; folder absent |
| 4 | `/Volumes/Data/workspace/repos/.dotfiles/kb-audit-inbox-close` | `kb-audit-inbox-close` | Removed with `orca worktree rm --force`; folder absent |
| 5 | `/Volumes/Data/workspace/repos/.dotfiles/kb-c1-canvas` | `popemkt/kb-c1-canvas` | Removed with `orca worktree rm --force`; folder absent |
| 6 | `/Volumes/Data/workspace/repos/.dotfiles/kb-effect-cli-mcp` | `kb-effect-cli-mcp` | Removed with `orca worktree rm --force`; folder absent |
| 7 | `/Volumes/Data/workspace/repos/.dotfiles/kb-effect-cli-mcp-r2` | `kb-effect-cli-mcp-r2` | Removed with `orca worktree rm --force`; folder absent |
| 8 | `/Volumes/Data/workspace/repos/.dotfiles/kb-effect-http-integration` | `kb-effect-http-integration` | Removed with `orca worktree rm --force`; folder absent |
| 9 | `/Volumes/Data/workspace/repos/.dotfiles/kb-effect-http-ws` | `kb-effect-http-ws` | Removed with `orca worktree rm --force`; folder absent |
| 10 | `/Volumes/Data/workspace/repos/.dotfiles/kb-effect-native-actions` | `kb-effect-native-actions` | Removed with `orca worktree rm --force`; folder absent |
| 11 | `/Volumes/Data/workspace/repos/.dotfiles/kb-effect-store-schema` | `kb-effect-store-schema` | Removed with `orca worktree rm --force`; folder absent |
| 12 | `/Volumes/Data/workspace/repos/.dotfiles/kb-effect-store-schema-w1` | `kb-effect-store-schema-w1` | Removed with `orca worktree rm --force`; folder absent |
| 13 | `/Volumes/Data/workspace/repos/.dotfiles/kb-effect-store-schema-w1-impl` | `kb-effect-store-schema-w1-impl` | Removed with `orca worktree rm --force`; folder absent |
| 14 | `/Volumes/Data/workspace/repos/.dotfiles/kb-effect-v4-core` | `kb-effect-v4-core` | Removed with `orca worktree rm --force`; folder absent |
| 15 | `/Volumes/Data/workspace/repos/.dotfiles/kb-hardening-contracts` | `popemkt/kb-hardening-contracts` | Removed with `orca worktree rm --force`; folder absent |
| 16 | `/Volumes/Data/workspace/repos/.dotfiles/kb-hardening-media-backup` | `popemkt/kb-hardening-media-backup` | Removed with `orca worktree rm --force`; folder absent |
| 17 | `/Volumes/Data/workspace/repos/.dotfiles/kb-hardening-persistence` | `popemkt/kb-hardening-persistence` | Removed with `orca worktree rm --force`; folder absent |
| 18 | `/Volumes/Data/workspace/repos/.dotfiles/kb-hardening-ui-transactions` | `popemkt/kb-hardening-ui-transactions` | Removed with `orca worktree rm --force`; folder absent |
| 19 | `/Volumes/Data/workspace/repos/.dotfiles/kb-m1-core` | `popemkt/kb-m1-core` | Removed with `orca worktree rm --force`; folder absent |
| 20 | `/Volumes/Data/workspace/repos/.dotfiles/kb-m2-cli` | `popemkt/kb-m2-cli` | Removed with `orca worktree rm --force`; folder absent |
| 21 | `/Volumes/Data/workspace/repos/.dotfiles/kb-m3-mcp` | `popemkt/kb-m3-mcp` | Removed with `orca worktree rm --force`; folder absent |
| 22 | `/Volumes/Data/workspace/repos/.dotfiles/kb-m4-materialize` | `popemkt/kb-m4-materialize` | Removed with `orca worktree rm --force`; folder absent |
| 23 | `/Volumes/Data/workspace/repos/.dotfiles/kb-r1-chrome` | `popemkt/kb-r1-chrome` | Removed with `orca worktree rm --force`; folder absent |
| 24 | `/Volumes/Data/workspace/repos/.dotfiles/kb-r2-shapes` | `popemkt/kb-r2-shapes` | Removed with `orca worktree rm --force`; folder absent |
| 25 | `/Volumes/Data/workspace/repos/.dotfiles/kb-tooling-integration` | `kb-tooling-integration` | Removed with `orca worktree rm --force`; folder absent |
| 26 | `/Volumes/Data/workspace/repos/.dotfiles/kb-ts7-effect-integration` | `kb-ts7-effect-integration` | Removed with `orca worktree rm --force`; folder absent |
| 27 | `/Volumes/Data/workspace/repos/.dotfiles/kb-ts7-viteplus` | `kb-ts7-viteplus` | Removed with `orca worktree rm --force`; folder absent |
| 28 | `/Volumes/Data/workspace/repos/.dotfiles/kb-ts7-viteplus-r2` | `kb-ts7-viteplus-r2` | Removed with `orca worktree rm --force`; folder absent |
| 29 | `/Volumes/Data/workspace/repos/.dotfiles/kb-u1-server` | `popemkt/kb-u1-server` | Removed with `orca worktree rm --force`; folder absent |
| 30 | `/Volumes/Data/workspace/repos/.dotfiles/kb-u2-frontend` | `popemkt/kb-u2-frontend` | Removed with `orca worktree rm --force`; folder absent |
| 31 | `/Volumes/Data/workspace/repos/.dotfiles/kb-u3-editing` | `popemkt/kb-u3-editing` | Removed with `orca worktree rm --force`; folder absent |
| 32 | `/Volumes/Data/workspace/repos/.dotfiles/kb-u4-query` | `popemkt/kb-u4-query` | Removed with `orca worktree rm --force`; folder absent |
| 33 | `/Volumes/Data/workspace/repos/.dotfiles/kb-ui-surface-modules` | `kb-ui-surface-modules` | Removed with `orca worktree rm --force`; folder absent |
| 34 | `/Volumes/Data/workspace/repos/.dotfiles/kb-ui-surface-split` | `kb-ui-surface-split` | Removed with `orca worktree rm --force`; folder absent |
| 35 | `/Volumes/Data/workspace/repos/.dotfiles/kb-v1-graph` | `popemkt/kb-v1-graph` | Removed with `orca worktree rm --force`; folder absent |
| 36 | `/Volumes/Data/workspace/repos/.dotfiles/kb-w1-tokens` | `popemkt/kb-w1-tokens` | Removed with `orca worktree rm --force`; folder absent |
| 37 | `/Volumes/Data/workspace/repos/.dotfiles/kb-w2-md` | `popemkt/kb-w2-md` | Removed with `orca worktree rm --force`; folder absent |
| 38 | `/Volumes/Data/workspace/repos/.dotfiles/kb-w3-palette` | `popemkt/kb-w3-palette` | Removed with `orca worktree rm --force`; folder absent |
| 39 | `/Volumes/Data/workspace/repos/.dotfiles/kb-w4-query` | `popemkt/kb-w4-query` | Removed with `orca worktree rm --force`; folder absent |
| 40 | `/Volumes/Data/workspace/repos/.dotfiles/kb-w5-ext` | `popemkt/kb-w5-ext` | Removed with `orca worktree rm --force`; folder absent |
| 41 | `/Volumes/Data/workspace/repos/.dotfiles/kb-w6a-media` | `popemkt/kb-w6a-media` | Removed with `orca worktree rm --force`; folder absent |
| 42 | `/Volumes/Data/workspace/repos/.dotfiles/kb-w7-views` | `popemkt/kb-w7-views` | Removed with `orca worktree rm --force`; folder absent |
| 43 | `/Volumes/Data/workspace/repos/.dotfiles/kb-w8a-reskin` | `popemkt/kb-w8a-reskin` | Removed with `orca worktree rm --force`; folder absent |
| 44 | `/Volumes/Data/workspace/repos/.dotfiles/kb-w8b-rows` | `popemkt/kb-w8b-rows` | Removed with `orca worktree rm --force`; folder absent |
| 45 | `/Volumes/Data/workspace/repos/.dotfiles/kb-w8c-polish` | `popemkt/kb-w8c-polish` | Removed with `orca worktree rm --force`; folder absent |
| 46 | `/Volumes/Data/workspace/repos/.dotfiles/kb-w8d-feel` | `popemkt/kb-w8d-feel` | Removed with `orca worktree rm --force`; folder absent |
| 47 | `/Volumes/Data/workspace/repos/.dotfiles/kb-w8e-refs` | `popemkt/kb-w8e-refs` | Removed with `orca worktree rm --force`; folder absent |

## Verification

Post-cleanup `orca worktree list --repo id:f6f616bb-22d0-43dd-a8f1-75395b66d614 --json` returned exactly two entries:

1. `f6f616bb-22d0-43dd-a8f1-75395b66d614::/Users/popemkt/.dotfiles`
2. `f6f616bb-22d0-43dd-a8f1-75395b66d614::/Volumes/Data/workspace/repos/.dotfiles/omp-authentication-graph`

`orca worktree ps --json` likewise returned exactly these two scoped worktrees. Orca terminal inventory contains 29 terminals, all attached only to the two survivors (28 main, 1 OMP). Filesystem checks found none of the 47 removed folder paths still present.

No Git branch deletion or other Git ref-mutation command was issued. The former branch labels above are retained as audit metadata and are not claims that every legacy label was a live local ref before cleanup.
