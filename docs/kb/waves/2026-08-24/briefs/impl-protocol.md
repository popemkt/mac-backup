# Implementation worker protocol (wave 2026-08-24)

Applies to every worker in this wave. Your brief names your zone, your
normative input, and your acceptance bar.

## Rule 1 outranks everything

`AGENTS.md` opens with **Abstraction before addition**, and it outranks speed,
diff size, and "it already works". Read it before you write code. The specific
failure modes it forbids, restated for this wave:

- No second mechanism for a concept that already has one. If you are adding a
  config file, a runner, a story format, or a clock, first find whether one
  exists and collapse into it.
- Prefer deleting a special case to adding one.
- A declared abstraction no code path reads is worse than none, because it
  reads as covered. Do not land config that lints nothing, a test helper
  nothing calls, or a story file the viewer does not load.
- If the clean version is too big for your wave, **say so in the handoff and
  stop**. A named gap is cheaper than a silent fork. Do not ship the stopgap.

## Non-negotiables

1. `./intent/gate.sh session <your-harness-name>` before any work.
2. **Zone ownership is absolute.** Edit only files in your zone plus your
   brief's declared shared touch-list. If you need something outside it,
   implement around it and record the need in the handoff — do not reach in.
3. Data compat: additive only. `.kb/nodes.jsonl` keeps loading. Never write to
   the owner's live store; if you need a store, copy it to a scratch dir.
4. **Do not run `rtk rebuild`. Do not push. Do not merge into main.** Commit on
   your own branch; the orchestrator merges.
5. Do not touch `.kb/nodes.jsonl` (owner data, currently dirty on main).

## Verification before every commit (and final)

```bash
cd tools/kb && bun install && bun test          # core suite  (baseline: 740 pass)
npm run typecheck                                # authoritative tsc --noEmit
npm run check                                    # vp check --no-fmt (lint)
cd ui && ./node_modules/.bin/vp test             # dedicated UI suite (baseline: 510 pass)
```

All four green = committable. Report the counts you actually observed, not the
baselines quoted above.

**Known pre-existing failures at this wave's base — not yours, do not fix:**
three render specs in `ui/tests-render/graph.e2e.ts` (force2d and force3d
report zero nodes; cluster never switches). Everything else passing is the bar.

The render harness needs npm 12: `cd ui && bunx npm@12 run test:render`
(system npm is 10.9.8 and fails `EBADDEVENGINES`).

## Commits

Conventional style (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`), small
logical commits, each passing the suite. End every commit message with:

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

## Handoff note (required at end)

Write `docs/kb/waves/2026-08-24/reports/<your-wave>.md` with:

- What shipped, per acceptance criterion, with the command output that proves it.
- What was cut and why.
- Every shared-file touch: path + why (so the orchestrator merges cleanly).
- **Evidence your guardrail/test has teeth**: for anything you add that is
  supposed to catch a defect, show it failing on a deliberately broken input,
  then passing. A rule that has never gone red is not known to work.
- Follow-ups, and a self-grade with honest gaps named.

## Merge order (orchestrator, informational)

`g1-guardrails` → `t1-property-mutation` → `t2-dst` → `s1-storybook`.
`tools/kb/package.json` is expected to conflict between g1 and t1; keep your
edits to it minimal and contiguous so the merge is mechanical.
