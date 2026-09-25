# Wave 2026-09-24: correctness first, then the look

The orchestrator (claude / opus) runs each item as a builder agent in its own
worktree. Every branch gets a read-only review by `omp --model grok-4.7`, or by
a fresh Opus agent if grok is out of budget. Findings are fixed on the branch,
then the branch merges into `main` and `main` is re-verified. Nothing is
pushed.

| # | item | depends on | status |
|---|---|---|---|
| a | field values checked against the field's declared type on every write | — | merged `fc217f4` (grok: approve) |
| b | `(reach ?from <edge> ?to [max])` in EDN | — | merged `609c130` (grok: approve) |
| c | review leftovers: stale gaps, AGENTS.md, canvas split in the p1 gaps, client/store seams | — | merged `47678b6` (grok: approve) |
| d | the 6 failing graph-render e2e cases (`render.e2e.ts`) | a–c merged | merged `93aa59a` (grok: approve; 15/15 render) |
| e | `lab` UI plugin: full-frame surface, lazy 3D, off by default and unloadable; four studies on one kit | a–c merged | merged `01594bf` (grok: approve after 4 rounds) |
| f1 | tokens, restructure: type scale, elevation, border, mono font; no visual change | d | merged `ca97673` (grok: approve after 5 rounds) |
| f2 | tokens, add: `html[data-theme]` design-system sets and the preference that picks one | f1 | merged `ac0fcf7` (grok: approve); kb light AA contrast merged `c77709b7` |
| g | graph polish: one shared scene module (bloom, fog, starfield, link particles, camera fly-to) used by lab and force3d; 2D curved edges, label halos, hover fade | e, f2 | merged `1ddb4f9` (grok: approve after 4 rounds) |
| h | CI green: push-time pin verify checks consistency only; refresh pins; push `main` and watch `Validate` | a–g merged | paused — see `resume.md` (Validate nix red; fix on PINS branch, unreviewed) |
| z | whole-wave audit, then a prioritised fix pass: polish, tests, UX, visual impact, modularity, design cleanliness | h | paused — audit done; WP1–WP5 not started (WP2 has a repro); see `resume.md` |

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
discovering or understanding nodes. The first draft of item e read that as
"every lab scene takes its data from the graph".

**Decision (the user, 2026-09-24):** the lab is an off-by-default sketchbook.
Its purpose is to experiment with and learn aesthetically pleasing effects,
3D techniques and motion — lighting, polish, uniformity — so its scenes are
studies, not product features. A study *may* read the graph when that helps
the study (the Sky's stars are nodes), but it does not have to, and nothing a
study does is a kb milestone. What a study proves graduates into functional
views only through the lab's shared kit (stage, palette, timing, rig,
controls), for example in item g's graph polish, never as a copy of a study.
The studies and the Lab principles they follow are specified in
`tools/kb/DESIGN-UI.md` → The lab.
