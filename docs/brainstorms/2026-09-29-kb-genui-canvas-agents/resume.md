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

**Merged since last update:**

- 3D steps 3-8. Milestones 1 and 2 are done.
- The extension-boundaries plan
  ([../2026-10-04-kb-extension-boundaries/README.md](../2026-10-04-kb-extension-boundaries/README.md))
  through E0-E12, including E4b, E9 lab and E10b.

## To do, in order

The ordered work queue is data in kb: the todo
`01M43DRVEQY02RTSX3XYWB8TG1` ("kb work queue, in order") and its
children, each with a status. Read it with
`kb backlinks 01M43DRVEQY02RTSX3XYWB8TG1` or open it in `kb ui`. Change
order or status there, not here.

## Agent routing

Opus builds; Sonnet only investigates and checks; GPT-6.1 Sol reviews; the main session lands. Brief Sol with an exact
`git diff <base> <branch>` range; a range description once got the wrong
commits reviewed. Verify a builder's branch with
`git -C <worktree> branch --show-current`, not its report.

## 3D workspace

Plan, research and owner answers in
[../2026-10-02-kb-3d-workspace/README.md](../2026-10-02-kb-3d-workspace/README.md).
Steps 0-8 are merged (Milestones 1 and 2). Steps 9 (connectors) and 10
(formats) remain, and the deferred 7b.

## How each step lands

A builder (Opus, or Sonnet in quota mode) works in its own worktree; GPT-6.1 Sol reviews; rebase onto main;
`bun install` in tools/kb; `bun run verify`, `bun run test`,
`bun run test:ui` (trust the exit code and the absence of an `Errors` line,
not the pass count: unhandled rejections once hid behind a green total);
fast-forward; mint its `GAP […]` placeholders
(`grep -rnE 'GAP \[[a-zA-Z]' tools/kb | grep -v 'GAP \[\['`), close what it
closed, open both stores once to take new seeds (`kb search x` and
`kb --root tools/kb search x`), `docs.materialize`, commit, push, restart
`kb ui`. Check `git config --get core.hooksPath` points at .githooks.
