# Wave 2026-09-24: correctness first, then the look

The orchestrator (claude / opus) runs each item as a builder agent in its own
worktree. Every branch gets a read-only review by `omp --model grok-4.7`, or by
a fresh Opus agent if grok is out of budget. Findings are fixed on the branch,
then the branch merges into `main` and `main` is re-verified. Nothing is
pushed.

| # | item | depends on | status |
|---|---|---|---|
| a | field values checked against the field's declared type on every write | — | building |
| b | `(reach ?from <edge> ?to [max])` in EDN | — | built, in review |
| c | review leftovers: stale gaps, AGENTS.md, canvas split in the p1 gaps, client/store seams | — | building |
| d | the 6 failing graph-render e2e cases (`render.e2e.ts`) | a–c merged | — |
| e | `lab` UI plugin: full-frame surface, lazy 3D, off by default and unloadable | a–c merged | — |
| f1 | tokens, restructure: type scale, elevation, border, mono font; no visual change | d | — |
| f2 | tokens, add: `html[data-theme]` design-system sets and the preference that picks one | f1 | — |
| g | graph polish: one shared scene module (bloom, fog, starfield, link particles, camera fly-to) used by lab and force3d; 2D curved edges, label halos, hover fade | e, f2 | — |

d and e run in parallel. f1 touches most UI components, so nothing else in
the UI runs beside it.

## Inspiration

Captured 2026-09-24 in the session scratchpad (`insp/`).

- **OpenAI GPT-6 Sol/Luna hero.** A video, not WebGL; the page has no
  canvas. Its first frame is a dense starfield with four-point diffraction
  glints and a faint blue nebula vignette at the edges.
- **threejs-journey.com hero.** A stylised isometric low-poly room with baked
  lighting and a saturated purple/pink palette. It is a drag-to-rotate
  sequence of pre-rendered frames on a 2D canvas, not a real-time scene.

The lab is where both styles are tried in real time before anything reaches a
functional view.

## The lab and Rule 1

Root `CLAUDE.md` says playful details should express creating, connecting,
discovering or understanding nodes. The lab's scenes should take their data
from the graph: for example, stars as nodes, glints as recently touched
nodes, and sun or moon following the theme. A scene that reads nothing from
the graph is a sketch, and stays inside the lab.
