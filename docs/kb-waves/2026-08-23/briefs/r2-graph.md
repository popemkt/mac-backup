# Brief r2 — Graph view: CodeFlow-parity overhaul plan

Agent: opencode. Research only this wave — NO implementation, NO commits.

## Mission

The graph view must reach the polish of CodeFlow (github.com/braedonsaunders/
codeflow) — the owner's stated benchmark ("if we can reach the level of polish
of codeflow I will be very pleased"). Modern graph libs with great ideas are
explicitly on the table; deps are allowed if justified.

## Read first

- `.research/kb-refine/graphviz/report.md` — distilled CodeFlow study; locks
  the principle "one graph, many lenses": datalog query → {nodes,edges} → renderer
- `.research/kb-refine/nxus/report.md` — in-graph UX/tools bar + skin tokens
- `.research/kb-refine/viz/report.md`
- `tools/kb/ui/src/components/graph/**` (sigma-graph, tree-graph,
  cluster-graph, force3d-graph, perspective-picker, graph-page)
- `tools/kb/INSPIRATIONS.md` rows for graph aspects

You may re-clone CodeFlow to /tmp for source reference (`git clone
https://github.com/braedonsaunders/codeflow /tmp/codeflow-study`). Do not
modify anything outside your report.

## Do

1. Gap analysis: current renderers vs CodeFlow's catalog — layout quality,
   label rendering, hover/select states, camera/zoom behavior, filtering,
   lens switching, cluster interactions, 3D mode value, perceived performance.
2. Layout engine decision: evaluate keeping hand-rolled force layout vs
   sigma.js+ForceAtlas2 tuning vs modern alternatives (e.g. elkjs/d3-dag for
   hierarchy, regl-based renderers, webgpu options). Recommend ONE primary
   path + fallback; justify on quality, bundle size, maintenance, license.
3. Interaction spec: hover, select, multi-select?, open-node-in-outline,
   search-in-graph, filter-by-tag/query, perspective switching transitions,
   empty/large-graph behavior. Define what "polished" means per interaction.
4. Performance notes: target node/edge counts, budget per frame, what changes
   make 10k nodes smooth.
5. Implementation plan sized for one overnight worker wave: file-level task
   breakdown, ordered, with risk flags.

## Deliverable

`docs/kb-waves/2026-08-23/reports/r2-graph.md` with sections: Gap analysis /
Renderer & layout decision / Dependency proposal (exact packages+versions) /
Interaction spec (MUST statements) / Perf budget / Task breakdown.

## Sweep mandate

Also audit graph-page chrome (toolbar, perspective picker, legend, empty
states) — owner wants polish found beyond what was named.

## Constraints

- `./intent/gate.sh session opencode` first.
- No code changes, no commits. Report file only.
