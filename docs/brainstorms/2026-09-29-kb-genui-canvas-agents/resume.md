# Resume: roadmap build, state at 2026-10-04

Decisions and order are in [README.md](README.md); the kb roadmap todo is
`01M3Q531V167YVKRF4XBYG1MTK`. Main is pushed.

## Merged

Every roadmap step except 7 (deferred by the owner): 0, 1, 2, 3, 4, 5 (5a
screen state, 5b agent sidebar, 5c approval policies), 6 (layout views),
8 (canvas 3D), 9 (sandbox and code views), 10 (chart views), plus the outline
update-cost fix. Each was reviewed by GPT-6.1 Sol before merge; every gap it
named is minted and written as an id, and the gaps it closed are marked
done. Main is pushed.

## 3D workspace

Plan, research and owner answers in
[../2026-10-02-kb-3d-workspace/README.md](../2026-10-02-kb-3d-workspace/README.md).
Steps 0 (three r186), 1 (ground camera) and 2 (item model) are merged.
Step 3 (solids, completing Milestone 1) is building. Then steps 4–10 in the
plan's order.

## How each step lands

Opus builds in its own worktree; GPT-6.1 Sol reviews; rebase onto main;
`bun install` in tools/kb; `bun run verify`, `bun run test`,
`bun run test:ui`; fast-forward; mint its `GAP [GAP-…]` placeholders
(`grep -rn 'GAP \[[A-Z]' tools/kb | grep -v 'GAP \[\['`), close what it
closed, open both stores once to take new seeds (`kb search x` and
`kb --root tools/kb search x`), `docs.materialize`, commit, push, restart
`kb ui`. Check `git config --get core.hooksPath` points at .githooks.
