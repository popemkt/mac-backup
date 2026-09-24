# Wave 2026-09-24: correctness first, then the look

The orchestrator (claude / opus) runs each item as a builder agent in its own
worktree. Every branch gets a read-only review by `omp --model grok-4.7`, or by
a fresh Opus agent if grok is out of budget. Findings are fixed on the branch,
then the branch merges into `main` and `main` is re-verified. Nothing is
pushed.

| # | item | depends on | status |
|---|---|---|---|
| a | field values checked against the field's declared type on every write | — | merged `fc217f4` (grok: approve) |
| b | `(reach ?from <edge> ?to [max])` in EDN | — | review fix in progress (grok: approve-with-nits) |
| c | review leftovers: stale gaps, AGENTS.md, canvas split in the p1 gaps, client/store seams | — | merged `47678b6` (grok: approve) |
| d | the 6 failing graph-render e2e cases (`render.e2e.ts`) | a–c merged | building |
| e | `lab` UI plugin: full-frame surface, lazy 3D, off by default and unloadable | a–c merged | building |
| f1 | tokens, restructure: type scale, elevation, border, mono font; no visual change | d | — |
| f2 | tokens, add: `html[data-theme]` design-system sets and the preference that picks one | f1 | — |
| g | graph polish: one shared scene module (bloom, fog, starfield, link particles, camera fly-to) used by lab and force3d; 2D curved edges, label halos, hover fade | e, f2 | — |

d and e run in parallel. f1 touches most UI components, so nothing else in
the UI runs beside it.

## Inspiration

Captured 2026-09-24 in the session scratchpad (`insp/`).

- **OpenAI GPT-6 Sol/Luna banner** (as described by the user; Cloudflare
  blocks automated browsers, so only the poster frame was captured). An
  "Astra" scene transitions into a sun and a moon, and the viewer can pan to
  move the objects. The poster frame is a starfield with four-point
  diffraction glints and a faint blue nebula vignette at the edges.
- **threejs-journey WebGPU & TSL course hero** (`WebgpuTslHero` bundle plus
  `three.tsl`, real-time). A cloud of a few thousand instanced spheres on a
  deep purple background. A hot orange-yellow emissive core under bloom fades
  to dark maroon spheres at the edges, with depth-of-field-like falloff. The
  cloud follows the pointer and the spheres flow around it, with the glow
  moving along. It is most likely a TSL compute-shader particle simulation
  with pointer attraction.

The lab is where both styles are tried in real time before anything reaches a
functional view.

## The lab and Rule 1

Root `CLAUDE.md` says playful details should express creating, connecting,
discovering or understanding nodes. The lab's scenes should take their data
from the graph: for example, stars as nodes, glints as recently touched
nodes, and sun or moon following the theme. A scene that reads nothing from
the graph is a sketch, and stays inside the lab.
