# kb UI — component architecture

Conventions for `tools/kb/ui`. CLI/backend remains the source of truth; the UI
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

| Layer                                                    | May import                                  | Must not import                  |
| -------------------------------------------------------- | ------------------------------------------- | -------------------------------- |
| `lib/*`, `ds/*`, `api/*`, `actions/*`                    | each other, protocol aliases                | `components/**`                  |
| `stores/*`                                               | `lib`, `ds`, `api`                          | `components/**`                  |
| `components/<surface>/*`                                 | own surface, shared primitives, stores, lib | sibling surface **internals**    |
| `components/outline/{tag-chip,bullet,node-row,field-*} ` | lib, types                                  | graph/canvas/ontology pages      |
| `catalog/*`                                              | components (read-only stories)              | stores mutations except fixtures |

**Shared primitives** (allowed cross-surface): `TagChip`, `Bullet`, `NodeRow`,
`PropValueEditor` / field row, `FieldRow`, `ViewErrorBoundary`, `popover-shell`.

**Surface folders** own their pages and toolbars. Cross-surface reuse goes
through primitives or `lib/`, never by reaching into another page module.

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
stores/, lib/, ds/, api/, actions/
```

Colocate tests as `*.test.ts(x)` next to the unit. Catalog stories are
`catalog/<name>.stories.tsx` — not Storybook CSF runners.

## Catalog decision (i9-arch)

| Option                        | Verdict                                                                  |
| ----------------------------- | ------------------------------------------------------------------------ |
| Storybook 8                   | **Reject** — heavy deps, separate Vite graph, CI tax; fights `vite-plus` |
| Ladle / Histoire              | **Reject** — still a second app + lockfile surface for ~6 primitives     |
| In-app `/__catalog` route     | **Defer** — needs router/App shared edits; low ROI vs tests              |
| Colocated stories + `vp test` | **Adopt** — see `src/catalog/`                                           |

Story modules export named variants; `catalog.smoke.test.tsx` renders each via
`renderToStaticMarkup` (or happy-dom when interaction is required). Existing
`*.test.tsx` next to components remain the behavioral source of truth.

## God components (audit → future waves)

Do **not** split these in i9-arch (other waves own behavior). Plans only:

| File                               | ~LOC | Responsibilities (too many)                          | Future split                                         |
| ---------------------------------- | ---: | ---------------------------------------------------- | ---------------------------------------------------- |
| `canvas/canvas-page.tsx`           | 1859 | doc IO, tools, selection, history, pointer, overlays | page shell / tool machine / selection / render layer |
| `graph/sigma-graph.tsx`            |  540 | sigma lifecycle, events, styling, camera bridge      | host / event bridge / style applicator               |
| `ontology/ontology-page.tsx`       |  532 | definition editor + members + warnings               | page / members panel / warning strip                 |
| `outline/field-value.tsx`          |  481 | every field type editor + autocomplete               | one file per type or `editors/` folder               |
| `outline/table-view.tsx`           |  473 | grid, sort, inline edit, columns                     | grid shell / cell editors                            |
| `outline/board-cards-view.tsx`     |  418 | board layout + empty states + cards                  | board / column / card                                |
| `components/App.tsx`               |  410 | boot, routing, chrome, ontology shell                | keep thin; extract route switcher                    |
| `outline/node-command-palette.tsx` |  393 | index + UI + actions                                 | index hook / palette UI                              |
| `graph/cluster-graph.tsx`          |  392 | layout + communities + render                        | compute / view                                       |
| `outline/node-content.tsx`         |  351 | text, tags, fields, query inline                     | content / metadata strip                             |
| `stores/outline.store.ts`          |  743 | forest, selection, ontology, views                   | selection slice / ontology slice                     |

## Production readiness notes

- Boot path: no unconditional `console.log`. Warnings in `view-config` /
  `graph-lens` are data-driven only.
- A11y: interactive chrome in App/sidebar/palette generally uses
  `button` + `aria-label`. Gaps filed in the i9 handoff (NodeRow click-div,
  TextCard ports, graph search dismiss) — owned by surface waves.
