# Brief i9-arch — Component architecture, encapsulation, error isolation

Harness: cursor-agent. Zone: audits + NEW files for boundaries/stories only;
no behavioral rewrites of components owned by other waves
(outline/graph/canvas internals are read-only for you — i7/i8 work there).
Protocol: `docs/kb-waves/2026-08-23/briefs/impl-protocol.md`.

## Mission (owner directive)

"I want us to have good frontend component design and encapsulation so
abstractions are clean and errors are isolated. Make them production ready,
storybook if needed."

## Do

1. Architecture audit: map the current component tree (App → surfaces),
   identify God components (oversized files, >2 responsibilities), prop
   drilling vs store misuse, side effects in render, missing error
   boundaries. We have `view-error-boundary.tsx` — assess whether surfaces
   (outline/graph/canvas/views) are each isolated so one bad subtree can't
   blank the app; add boundaries where missing (small, new code only).
2. Encapsulation rules: propose + implement a component-boundary convention
   (file layout, colocation, what may import what) documented as
   `ui/ARCHITECTURE.md`; refactor only where the change is pure-moving
   (renames/re-exports) and provably zero-behavioral — anything deeper gets
   documented as a finding, not done.
3. Component catalog decision: evaluate Storybook vs lighter options (e.g. a
   dev-only in-app catalog route, vite story files, Ladle). kb is Bun+Vite;
   weigh maintenance + binary-weight + CI cost. If a catalog is worth it,
   implement the minimal version for the core primitives (TagChip, Bullet,
   NodeRow, FieldValue, canvas card, graph toolbar) with 2-3 stories each and
   a `vp`-friendly test story; if not worth it, document why + what we have
   instead (component tests today).
4. Production-readiness pass: console noise on boot, dev-only warnings,
   accessibility quick wins that don't change visuals (aria labels, roles on
   interactive divs where trivially correct).

## Deliverable

Commits on your branch (boundaries + catalog + docs) + handoff at
`docs/kb-waves/2026-08-23/reports/i9-arch.handoff.md` including the God
component list with refactor plans for future waves.
