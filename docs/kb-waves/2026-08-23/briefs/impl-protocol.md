# Implementation worker protocol (wave I1/I2, 2026-08-23)

Applies to every implementation worker. Your individual brief names your zone,
your research input, and your acceptance bar.

## Non-negotiables

1. `./intent/gate.sh session <harness>` before any work.
2. **Zone ownership is absolute.** Edit only files in your zone + the shared
   touch-list below. If you believe you need something outside it, implement
   around it and record the need in your handoff note — do not reach in.
3. Quality bar: inspiration-parity polish (Tana/CodeFlow/Excalidraw level).
   "Works" ≠ done; "feels designed" = done. Ground-up correctness: replace
   wrong abstractions inside your zone rather than patching over them.
4. CLI/backend stays source of truth; UI is a projection.
5. Data compat: additive only; `.kb/nodes.jsonl` keeps loading; TODO content
   preserved.
6. Shared-file touch policy: minimize edits to `App.tsx`, `index.css`,
   `tokens.css`, `ds/**`, wire format in `src/surface/ui.ts`. Keep them
   additive; list EVERY shared-file edit (path + why) in your handoff note so
   the orchestrator can merge cleanly.
7. Do not run `rtk rebuild`, do not push, do not merge into main. Commit on
   YOUR branch (`popemkt/<worktree-name>` already checked out).

## Verification before every commit (and final)

```bash
cd tools/kb && bun install && bun test          # core suite
npm run typecheck                                # authoritative tsc --noEmit
npm run check                                    # vp check --no-fmt (lint)
cd ui && ./node_modules/.bin/vp test             # dedicated UI suite
```

All four green = committable. If a pre-existing failure blocks you that is NOT
yours, note it and move on; do not fix outside your zone.

## Commits

Conventional style (`feat:`, `fix:`, `refactor:`, `docs:`), small logical
commits, each passing the suite. Leave work committed on your branch; the
orchestrator merges.

## Handoff note (required at end)

Append to your report file under `## Implementation handoff`: what shipped,
what was cut and why, every shared-file touch, follow-ups for later waves,
and a self-grade against the quality bar with honest gaps named.

## Research inputs

Your research report lives at
`docs/kb-waves/2026-08-23/reports/<name>.md` (committed on your branch base).
Treat its MUST statements as normative; deviate only with written rationale.
