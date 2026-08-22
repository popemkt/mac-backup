# Brief r3 — Canvas: professionalism overhaul plan

Agent: omp (second instance). Research only this wave — NO implementation, NO
commits.

## Mission

The canvas is clunky and limited — you cannot even delete nodes today. Produce
the spec that brings it to Excalidraw/draw.io/Miro-tier feel within kb's
deliberate simplicity rule.

## Read first

- `.research/kb-refine/canvas/report.md` — prior canvas study
- `tools/kb/INSPIRATIONS.md` canvas rows: purpose = free-form thinking surface;
  edges are drawings not relationships (Logseq stance, deliberate); JSON Canvas
  1.0 format with round-trip preservation; simplicity beats fidelity
- `tools/kb/DESIGN-REFINE.md` canvas sections
- `tools/kb/ui/src/components/canvas/**` (all files)

## Do

1. Audit current canvas: everything broken/clunky/missing. Node delete is the
   headline but enumerate all CRUD gaps, selection gaps, keyboard gaps,
   pointer-quality issues (drag thresholds, hit targets, cursor feedback).
2. Spec the interaction model: tool strip behavior, place/move/resize, select
   (single + rubber-band multi), delete (key + menu), copy/paste stance, undo
   (recommend: adopt or defer — justify via simplicity rule), z-order stance,
   snapping/guides stance.
3. Edge UX within the "edges are drawings" constraint: create/delete/re-route,
   labels, arrowheads, hit area.
4. Node-card UX: node-backed cards vs shape cards, inline edit affordance,
   media cards (planned per inspirations).
5. Format: confirm JSON Canvas round-trip stays lossless while adding whatever
   new fields are needed (unknown-type preservation rule).
6. Task breakdown for one overnight implementation wave, ordered by impact.

## Deliverable

`docs/kb-waves/2026-08-23/reports/r3-canvas.md`: Audit / Interaction spec
(MUST statements) / Data-format delta / Deliberate non-goals (simplicity-rule
cuts) / Task breakdown.

## Sweep mandate

Include canvas-list-page and canvas creation flows in the audit — owner wants
polish found beyond what was named.

## Constraints

- `./intent/gate.sh session omp` first.
- No code changes beyond booting/testing the app; no commits.
