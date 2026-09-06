# kb UI — component architecture

Conventions for `tools/kb/packages/app/ui`. CLI/backend remains the source of truth; the UI
is a projection. This file is the encapsulation contract for new work.

## Tree (App → surfaces)

```
main.tsx
└─ App                         shell: load graph, route, global shortcuts
   ├─ Sidebar                  nav (pins, surfaces) — ViewErrorBoundary
   └─ main column
      ├─ GraphPage             lazy + ViewErrorBoundary   (route /graph*)
      ├─ OutlineShell          header + connection chrome
      │  ├─ OntologyPage       lazy + ViewErrorBoundary
      │  ├─ OntologyListPage   lazy + ViewErrorBoundary
      │  ├─ CanvasPage/List    lazy + ViewErrorBoundary
      │  └─ OutlineEditor      eager + ViewErrorBoundary
      └─ SharedChrome          prefs, filters, ⌘ palette, toasts
```

Lazy chunks: graph, canvas, ontology. Outline stays eager (primary path).

## Error isolation

| Surface              | Boundary? | Notes                                       |
| -------------------- | --------- | ------------------------------------------- |
| Graph                | yes       | `resetKey` = perspective / ontology id      |
| Canvas               | yes       | `resetKey` = canvas id                      |
| Ontology page / list | yes       |                                             |
| Outline              | yes       | added i9-arch; keeps sidebar + chrome alive |
| Sidebar              | yes       | crash must not blank the workspace          |
| SharedChrome         | no        | tiny; failures are non-fatal UI             |

Use `ViewErrorBoundary` / `ViewError` from
`components/view-error-boundary.tsx`. Do not invent a second boundary type.
`console.error` in `componentDidCatch` is intentional (devtools signal).

## Import / ownership rules

Who may import whom inside `src/` is one table: `UI_ALLOWS` in
[`tools/kb/harness/src/constraints.ts`](../../../harness/src/constraints.ts),
keyed by the zone a file sits in — the surface folders under `components/`,
the named shared primitives, and `ds`, `lib`, `api`, `actions`, `session`,
`stores`, `fixtures`, `catalog`, `types` and the shell. The harness applies it
to every intra-package import (`harness/tests/ui-boundaries.test.ts`, part of
`bun run verify`), so this file states no rows of its own; the doc comment
beside the table carries the reasoning, and the shared-primitives list is the
`UI_PRIMITIVES` set next to it.

A sanctioned breach carries `// GAP [[id]]` on its import line and a `#gap`
node naming what would close it — see
[`docs/kb/rules.md`](../../../../../docs/kb/rules.md) under **UI import
matrix**. Adding an edge to `UI_ALLOWS` is a decision about the architecture,
not a way past a red test.

**Stores:** prefer selectors (`useXStore(s => s.field)`). Do not pass the whole
store through props. Do not call mutations during render.

**Side effects:** data fetch, WS, and document listeners live in `useEffect` /
event handlers — never in the render body.

## File layout

```
components/
  App.tsx                 shell only (routing + chrome composition)
  view-error-boundary.tsx shared recovery UI
  outline/                editor + list/table/board projections
  graph/                  renderers + toolbar (lazy page)
  canvas/                 page + cards (lazy)
  ontology/               scope + definition pages (lazy)
  sidebar/, palette/, prefs/, ui/
catalog/                  story modules + smoke tests (dev/test only)
stores/, lib/, api/, actions/
ds/                       one-file @kb/query seam (runQuery, queryBacklinks, DatascriptIndex, extractMentions)
```

Colocate tests as `*.test.ts(x)` next to the unit. Catalog stories are
`catalog/<name>.stories.tsx` in Storybook CSF3 format.

## Component catalog

Storybook 10 is the component viewer. The CSF3 modules in `src/catalog/` are
also consumed by the Vitest smoke suite through Storybook portable stories, so
the viewer and the admission test share one set of variants.

Existing `*.test.tsx` files next to components remain the behavioral source of
truth.

## God components (audit → future waves)

Do **not** split these in i9-arch (other waves own behavior). Plans only:

| File                               | ~LOC | Responsibilities (too many)                     | Future split                                                                      |
| ---------------------------------- | ---: | ----------------------------------------------- | --------------------------------------------------------------------------------- |
| `canvas/canvas-page.tsx`           |  297 | selectors, pointer reducer wiring, composition  | split complete: doc, keyboard, gestures, selection, edge actions, stage, overlays |
| `graph/sigma-graph.tsx`            |  540 | sigma lifecycle, events, styling, camera bridge | host / event bridge / style applicator                                            |
| `ontology/ontology-page.tsx`       |  532 | definition editor + members + warnings          | page / members panel / warning strip                                              |
| `outline/field-value.tsx`          |  481 | every field type editor + autocomplete          | one file per type or `editors/` folder                                            |
| `outline/table-view.tsx`           |  473 | grid, sort, inline edit, columns                | grid shell / cell editors                                                         |
| `outline/board-cards-view.tsx`     |  418 | board layout + empty states + cards             | board / column / card                                                             |
| `components/App.tsx`               |  410 | boot, routing, chrome, ontology shell           | keep thin; extract route switcher                                                 |
| `outline/node-command-palette.tsx` |  393 | index + UI + actions                            | index hook / palette UI                                                           |
| `graph/cluster-graph.tsx`          |  392 | layout + communities + render                   | compute / view                                                                    |
| `outline/node-content.tsx`         |  351 | text, tags, fields, query inline                | content / metadata strip                                                          |
| `stores/outline.store.ts`          |  743 | forest, selection, ontology, views              | selection slice / ontology slice                                                  |

## Production readiness notes

- Boot path: no unconditional `console.log`. Warnings in `view-config` /
  `graph-lens` are data-driven only.
- A11y: interactive chrome in App/sidebar/palette generally uses
  `button` + `aria-label`. Gaps filed in the i9 handoff (NodeRow click-div,
  TextCard ports, graph search dismiss) — owned by surface waves.
