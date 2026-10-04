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

## To do, in order (updated 2026-10-04)

Owner's priority: finish extension isolation first, then the rest.

1. **Extension isolation** (plans:
   [README](../2026-10-04-kb-extension-boundaries/README.md),
   [sdk.md](../2026-10-04-kb-extension-boundaries/sdk.md)). Landed: E0-E12,
   E9b, the card text-binding gap. In flight: E13 (`@kb/canvas-ui`), E15a
   (`GraphWrites`; ext-check and ext-docs leave `@kb/operations`). Left, in
   rounds of two: E15b + E17, E15c + E16, E18, then E14 (close gaps, flip
   the rule to `harness`).
2. **Dependency upgrades** (survey:
   [../2026-10-04-kb-upgrades/README.md](../2026-10-04-kb-upgrades/README.md)),
   after isolation so the lockfile does not fight the builders:
   safe minors and patches with `bun audit fix` (35 advisories, 15 high;
   rerun `bun audit` for the full list); oxlint 1.83 to 1.86 with
   `@oxlint/plugins` and `oxc-parser`; Effect 4.0.0 stable with
   `@effect/tsgo`; the Vite+ 1.0 stack (vitest 5, plugin-react 6,
   `vp migrate`); commander 15. Drop the root `overrides` that repeat the
   catalog's vite and vitest.
3. **E20: boundary errors in the editor.** One oxlint JS plugin that calls
   the harness's `matrixViolation` (`harness/src/constraints.ts`) with the
   importing file, the specifier and the `nx.tags` in package.json, so the
   rule table stays single. The harness keeps the whole-graph checks
   (shrinking breach lists, pairing, composition roots). After the oxlint
   upgrade. Neither oxlint nor `vp` has a built-in boundary rule (checked
   2026-10-04).
4. **Cordis-level plugin integration** (owner wants it, "maybe more"). kb's
   kernel already has Cordis's core. Missing, in order: plugin config as
   fields on the `sys.extension.<name>` node with re-apply on change; a
   graph-driven loader replacing `bundled.ts`'s list (one node per plugin
   instance); a plugin view (status, services, contributions as nodes and
   edges); hot reload; optional injects and lifecycle events. First step:
   a Sonnet survey of Cordis's real features against kb, then an Opus plan
   (`integration.md`).
5. **Sidebar agent config** (model, executable). Folds into item 4's
   first step. Today `@kb/agent-claude` runs local Claude Code with the
   login's default model; `host-plugins.ts` passes only `cwd`.
6. **E19**: the screen protocol's canvas vocabulary leaves core, at a 3D
   step boundary.
7. **3D steps 9 (connectors) and 10 (JSON Canvas and GLB export).**
8. **Step 7b** (canvas items become nodes), the owner's call.

## Open questions

- The test:ui count: the landing report saw 2218 in `@kb/ui`, against the
  builder's 2404 across packages. Confirm the nx per-package total (the step 8
  landing summed 2399 across the packages, 2213 of them in `@kb/ui`).
- A flaky `canvas-camera.test.ts` timeout.

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
