# Brief r5 — Ontology: ambitious design, core-only implementation spec

Agent: claude. Research/design only this wave — NO implementation, NO commits.

## Mission

Owner's vision (verbatim intent): "ontology is sort of a supertag sets/tree/
graph — when you use an ontology, you only see nodes of such ontology and how
they're connected. Probably ontology is a new node with a new editing
experience but idk."

Deliver TWO things in one report:
1. **Ambitious full-scope design** — the complete ontology concept for kb,
   unbounded by tonight's effort.
2. **Core implementation spec** — the minimal-but-correct subset an overnight
   wave builds (owner: "ambitious for the whole scope, implement only the
   core"). It must be genuinely useful alone and leave clean room to grow.

## Read first

- `tools/kb/DESIGN.md` + `DESIGN-UI.md` — everything-is-a-node, supertag
  mechanics, fields-as-nodes, query nodes, graph perspectives
- `tools/kb/INSPIRATIONS.md` — Tana parity bar; "simplicity beats fidelity";
  CLI/backend source-of-truth rule; #graph-perspective prior art
- `.research/kb-refine/tana/report.md` — supertag config/inheritance material
- `tools/kb/ui/src/components/graph/perspective-picker.tsx` + related — the
  existing "scoped lens" surface ontology should compose with
- `tools/kb/src/foundation/**` schema/type guards — where sys.* types live

## Design questions to answer

1. Data model: is an ontology a `sys.ontology` node whose members are declared
   via fields/tags/queries? Superset/subset relations between ontologies?
   How do tag trees map in/out? Reconcile with existing tags+fields rather
   than inventing a parallel universe.
2. Membership semantics: explicit member lists vs query-defined vs hybrid;
   what happens when both exist; cycle rules for ontology-of-ontology.
3. The scoped experience: entering an ontology = filtered universe (outline +
   graph show only member nodes and their internal connections). Specify how
   this composes with zoom, breadcrumbs, perspectives, search.
4. Editing experience: what does editing an ontology node look like (member
   management UI)? What does it mean for a regular node to join/leave an
   ontology from its own row/panel?
5. Graph integration: ontology-scoped subgraph rendering via the existing
   perspective/query pipeline if possible (prefer reuse over new renderer).
6. Migration: additive-only; zero impact on nodes that never reference
   ontologies; TODO content preserved (hard requirement).
7. Non-goals for core: inference/reasoning, auto-classification, validation
   enforcement — name them and park them.

## Core spec must include

- Exact node shapes (`sys.f.type`, props) with EDN/datoms examples
- New operations (names + semantics) for plan.ts-level action planning
- UI surface list with file-level placement hints
- Test plan: which behaviors get automated tests first
- Explicit "not in core" list

## Deliverable

`docs/kb/waves/2026-08-23/reports/r5-ontology.md`.

## Constraints

- `./intent/gate.sh session claude` first.
- No code changes beyond booting the app to inspect current behavior; no commits.
