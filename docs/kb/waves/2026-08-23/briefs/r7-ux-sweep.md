# Brief r7 — Whole-surface UX audit: find every unpolished corner

Agent: codex (second instance). Research only this wave — NO implementation,
NO commits.

## Mission

Owner directive: "find and polish as much as possible — those are the stuff I
said but probably not the only one." Other researchers own outline / graph /
canvas. YOU own every other surface. Find everything that would make a
discerning user feel the app is less than professional.

## Read first

- `tools/kb/ui/src/**` EXCEPT components/outline|graph|canvas (skim others'
  zones only for cross-surface inconsistencies)
  - App.tsx, components/sidebar/**, components/search-box.tsx,
    components/node-panel.tsx, components/prefs/**, components/query-page*,
    view-panel, table/board/cards views, toast lib, ref-autocomplete,
    node-command-palette, breadcrumbs
- `.research/kb-refine/tana/report.md`, `views/report.md` — the bars for
  outliner chrome and database views
- `tools/kb/DESIGN-UI.md`, `DESIGN-RESKIN.md`

## Audit checklist (add findings beyond it)

1. Command palette (⌘K): coverage vs Tana's, fuzzy matching quality, recent/
   frecency, actions missing (create tag, define field, new canvas…).
2. Search: ranking, highlighting, keyboard nav of results, empty state.
3. Node panel: information architecture, field/tag editing flow friction,
   backlinks presentation.
4. Views (Table/Board/Cards): column config, grouping correctness, sort/filter
   persistence, board drag between columns?, cell editing parity with panel.
5. Sidebar: pinned model, counts, active-state clarity, collapse behavior.
6. Query page: error display for bad EDN, autocomplete/insert helpers, saved
   query management.
7. Systemic: loading states, empty states, error/toast copy quality, focus
   management & keyboard traps, inconsistent spacing/type against
   DESIGN-RESKIN tokens, dark/light parity, animation/motion absence where
   expected (Tana-level micro-feedback), scroll restoration, IME safety.
8. Cross-surface consistency: same verb = same shortcut everywhere; selection
   model coherence between outline/select-mode/views/graph.

For each finding: severity (P0 broken → P3 nicety), evidence (file:line or
repro), concrete fix direction, and which wave should own it (i1-editor /
i2-graph / i3-canvas / i4-backend / i5-polish).

## Deliverable

`docs/kb/waves/2026-08-23/reports/r7-ux-sweep.md`: ranked findings list +
top-10 "feel killers" shortlist + i5-polish task proposal sized for one
overnight wave.

## Constraints

- `./intent/gate.sh session codex` first.
- Boot the app freely (`bun tools/kb/src/surface/cli.ts ui`) to experience it;
  modify nothing tracked except your report; no commits.
