# Resume: roadmap build, state at 2026-10-03

Decisions and order are in [README.md](README.md); the kb roadmap todo is
`01M3Q531V167YVKRF4XBYG1MTK`. Main is `a6d13fc8`, pushed.

## Merged

Steps 0, 1, 2, 3, 4, 5 (5a screen state, 5b agent sidebar) and 8. Each was
reviewed by GPT-6.1 Sol before merge; every gap it named is minted and
written as an id, and the gaps it closed are marked done. Main is pushed.

## In progress (Opus builders, each in its own worktree)

- Outline update-cost fix (todo `01M3YPGV75SJ04YTD4G32F9SQS`), from `87bc6bf4`.
- Step 6, layout views (decision 12), from `a6d13fc8`.

Each gets a Sol review, then merge (rebase onto main first; `bun install`
in tools/kb after a merge that adds packages), then bookkeeping: mint its
`GAP [GAP-…]` placeholders (`grep -rn 'GAP \[GAP-' tools/kb`), close what
it closed, `docs.materialize`, commit, push.

## Queue

1. Step 5c, approval policies (decision 13).
2. The 3D workspace: plan and owner answers in
   [../2026-10-02-kb-3d-workspace/README.md](../2026-10-02-kb-3d-workspace/README.md);
   its step 0 (three r180 → r186) comes first.

## Not started

Step 9 (sandbox), 10 (chart view). Step 7 is deferred by the owner.
