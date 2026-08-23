# Brief i10-polish — owner polish round (typography, zero layout shift, tags-as-nodes)

Harness: omp. Source: owner's live-UI review on 2026-08-24 after the seven
merged waves. Protocol: `docs/kb-waves/2026-08-23/briefs/impl-protocol.md`.
Supporting research: `reports/r7-ux-sweep.md`, `reports/i7-tags.handoff.md`,
`reports/i9-arch.handoff.md` (its NodeRow a11y follow-up is item 5 here).

Five items. 1–4 are the owner's verbatim asks; 5 is a standing mandate.

## 1. Typography — font weight reads too heavy

Evaluate swapping the UI font stack to **Inter variable** (Tana's font).
Self-host via `@fontsource-variable/inter` under Vite; do not hotlink Google
Fonts (offline-first, and no third-party request from a local tool).

This is a designed decision, not a token swap: set `--font-sans` in
`tokens.css`, and re-audit the body font-size and font-weight tokens against
it — Inter at the same numeric weight reads lighter than the current stack, so
weights likely need re-picking, not just inheriting. Verify every surface in
BOTH dark and light. Guarantee no layout shift on font load
(`font-display: swap` plus a preloaded subset, and check the fallback metrics
actually match — a swap with mismatched metrics IS a layout shift, which item
2 forbids).

## 2. Eliminate layout shifts — thoroughly

Known offender: the tag pill's `×` reveal on hover changes the pill LENGTH.
Fix so hover NEVER resizes the chip. Options, pick per the design: a fixed-
width `×` slot that is always occupied (reserve the space, render the glyph at
zero opacity), an absolutely-positioned overlay `×`, or a min-width with the
label truncating. Research note: CodeFlow/Tana-style chips put the `×` over or
near the hash rather than appending it to the right of the label — consider
that placement.

Then sweep the WHOLE UI for other state-induced reflow. Tailwind is in use, so
grep for the usual culprits: `group-hover:` rules that toggle padding/width/
display, conditional `hidden`, and any element that appears rather than
occupies. Check at minimum: value/field row expansions, palette width jumps
between empty and matched states, toolbar toggles, board/table column widths,
sidebar collapse, and the graph header chips. Prefer occupying space always
(opacity/visibility) over inserting nodes on hover.

## 3. Tag font size still reads like node content

i7 set 10/12px, but the perceived size is still large. Hypothesis to verify
first: there are TWO tag render paths — the inline striped tags inside
`node-content.tsx` and the `TagChip` component — and they do not share the
token. Audit both, find any hardcoded larger size, and **unify them onto one
component with one token**. Do not fix by nudging a number in one path.

## 4. Tag configuration = the tag's own node page, with typed field editors

The bespoke tag config panel was removed in i7 by design: a tag IS a node, so
it must be configured like any node. "Configure"/opening a tag should land on
its node page showing its fields/props, edited with per-field-type renderings.

Required: a **color swatch picker** rendering for `sys.f.color`, so a tag's
colour is edited through the ordinary field editor rather than a bespoke
panel. Cover the other field types the tag node actually carries (text, ref,
etc.) with renderings appropriate to their type. Treat tags un-specially and
make node-page field editing genuinely good — that is the deliverable, not a
one-off picker bolted onto a tag page.

## 5. Standing mandate — find more unpolished spots and fix them

Sweep and fix: outline row focus state, ghost/creation affordances after i8,
palette keyboard coverage, empty and loading states, reduced-motion
consistency, focus-ring consistency, and a11y roles on interactive row divs
(`NodeRow` role/keyboard — flagged by i9 as a follow-up; take it here).

## Zone

`ui/src/components/outline/**`, `ui/src/tokens.css`, `ui/src/index.css`,
`ui/src/components/prefs/**`, the tag node page rendering in
`node-panel`/`schema-section`, `ui/src/components/ds/**` for the shared chip,
plus `ui/package.json` for the Inter dependency.

Do NOT touch `components/graph/**` or `components/canvas/**` — a separate
graph wave (r10/i11) owns those concurrently, and i8c owns the outline
editor's caret/focus/text-host internals. If your shift sweep finds a real
offender inside graph or canvas, **record it in your handoff instead of
fixing it**. If item 3's unification collides with i8c's `NodeTextHost` work
in `node-content.tsx`, keep your edit to the tag render path only and say so
in the handoff.

Shared-file policy applies (protocol §6): list EVERY edit to `tokens.css`,
`index.css`, `ds/**`, and `package.json` in your handoff with a why.

## Verify (all four green before each commit)

```bash
cd tools/kb && bun install && bun test
npm run typecheck
npm run check
cd ui && ./node_modules/.bin/vp test
```

Baseline at dispatch: core 643 pass / 0 fail, typecheck clean, lint clean, UI
433 pass / 0 fail. Any failure is yours.

## Acceptance

A layout-shift regression test exists for the tag chip (hovering does not
change its measured width) and for at least the palette and one field row.
Tag font size is provably one token on one path. A tag's colour is editable
from its node page with no bespoke panel. Inter is self-hosted, loads without
shift, and both themes are verified. Self-grade against the Tana-level bar in
your handoff with honest gaps named.

Handoff: `docs/kb-waves/2026-08-23/reports/i10-polish.handoff.md`.
