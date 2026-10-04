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

## Next, when the owner's quota is back

- E9b: canvas vocabulary out of core.
- E13: `@kb/canvas-ui`. The canvas card text-binding gap
  `01M41MHRD7MF4NP23EE294B69C` must land before it.
- E14: close gaps, flip the rule's enforcement.
- 3D step 9 (connectors) and step 10 (formats: JSON Canvas export, GLB).
- The deferred step 7b (items become nodes), still the owner's call.

## Open questions

- The test:ui count: the landing report saw 2218 in `@kb/ui`, against the
  builder's 2404 across packages. Confirm the nx per-package total (the step 8
  landing summed 2399 across the packages, 2213 of them in `@kb/ui`).
- A flaky `canvas-camera.test.ts` timeout.

## Agent routing in quota mode

Sonnet builds and lands, GPT-6.1 Sol reviews.

## 3D workspace

Plan, research and owner answers in
[../2026-10-02-kb-3d-workspace/README.md](../2026-10-02-kb-3d-workspace/README.md).
Steps 0-8 are merged (Milestones 1 and 2). Steps 9 (connectors) and 10
(formats) remain, and the deferred 7b.

## How each step lands

Opus builds in its own worktree; GPT-6.1 Sol reviews; rebase onto main;
`bun install` in tools/kb; `bun run verify`, `bun run test`,
`bun run test:ui`; fast-forward; mint its `GAP [GAP-…]` placeholders
(`grep -rn 'GAP \[[A-Z]' tools/kb | grep -v 'GAP \[\['`), close what it
closed, open both stores once to take new seeds (`kb search x` and
`kb --root tools/kb search x`), `docs.materialize`, commit, push, restart
`kb ui`. Check `git config --get core.hooksPath` points at .githooks.
