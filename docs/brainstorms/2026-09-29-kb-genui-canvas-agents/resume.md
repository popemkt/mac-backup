# Resume: roadmap build, state at 2026-10-02 (second session)

Decisions and order are in [README.md](README.md); the kb roadmap todo is
`01M3Q531V167YVKRF4XBYG1MTK`. Main is `a4703c0b` (local, not pushed).

## Merged

Steps 0 (action modes), 1 (view types in ViewPoint), 2 (view nodes), 4
(WebMCP), 5a (screen state) and 8 (canvas 3D). Steps 2 and 5a were reviewed
by GPT-6.1 Sol before merge. Every gap they named is minted and written as
an id; the gaps they closed are marked done.

## In progress (Opus builders, each in its own worktree from `a4703c0b`)

- Step 3: generative UI mode A (view catalog in `kb_manifest`, `view.propose`,
  `render_view` by view id, `ui://` snapshots).
- Step 5b: agent packages (local Claude bridge behind a port, sidebar plugin,
  browser approval prompt closing gap `01M3R2KDDDPSB12NCJ6F6NJHMC`).

Each gets a Sol review, then merge, then the same bookkeeping as before:
mint its `GAP [GAP-…]` placeholders (`grep -rn 'GAP \[GAP-' tools/kb`),
close what it closed, `docs.materialize`, commit.

## Queue (owner, 2026-10-02)

1. Steps 3 and 5b (building).
2. Outline update-cost fix (todo `01M3YPGV75SJ04YTD4G32F9SQS`, from a scroll
   profile) and step 6 (layout views: panels, then splits/tabs, saved
   workspaces), pulled forward because the owner wants several views at once.
3. Step 5c (approval policies, decision 13).
4. The 3D workspace: plan in
   [../2026-10-02-kb-3d-workspace/README.md](../2026-10-02-kb-3d-workspace/README.md),
   waiting on the owner's four questions there before any build.

## Not started

Step 6 (layout view type), 9 (sandbox), 10 (chart view), and the "which actions require approval"
todo. Step 7 is deferred by the owner.
