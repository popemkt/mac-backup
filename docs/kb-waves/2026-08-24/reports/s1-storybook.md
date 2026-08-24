# s1-storybook — handoff

Branch: `popemkt/kb-s1-storybook`. Zone: `tools/kb/ui/.storybook/**`,
`tools/kb/ui/src/catalog/**`, `tools/kb/ui/package.json`.

## What shipped

### Part 1 — install and wire

Storybook (`storybook@10.5.10` + `@storybook/react-vite` +
`@storybook/addon-a11y`) installed and wired.

**Version note.** The brief asked for "Storybook 9". Storybook 9's npm
`latest` tag has since moved to 10.5.10 (registry checked live via
`bunx npm@12 view storybook version`); 9.x's newest release is 9.1.20,
already superseded before this wave started. Installed current `latest`
rather than a dead branch — the acceptance criteria don't pin a major,
and nothing in the brief depends on 9-specific behavior.

**The stated integration risk did not materialize.** `ui/package.json`
overrides `vite` to `npm:@voidzero-dev/vite-plus-core@0.2.8` via
`overrides`, and that override is global — `node_modules/vite/package.json`
resolves to `@voidzero-dev/vite-plus-core` for every dependant, including
Storybook's own `@storybook/builder-vite`. Tested this first, before
writing any story: ran `storybook build` against the *original*
hand-rolled catalog (pre-migration) with a minimal `.storybook/main.ts`.
It got through Vite transforming 39 modules and only failed on CSF shape
("CSF: missing default export" — expected, since those files weren't CSF
yet). No vite-plus-core incompatibility surfaced; the override is
transparent to Storybook's Vite builder. No `viteFinal` escape hatch,
version pin, or Storybook-local Vite resolution was needed to make the
*builder* work.

`.storybook/main.ts` does supply its own `viteFinal`, but only to add
what a story actually needs and the builder doesn't supply: the Tailwind
plugin and the `@` / `@kb/*` path aliases that every catalog/component
import uses. It does **not** import `../vite.config.ts` — that file's
`defineConfig` comes from `vite-plus` (`vp`) and carries `lint`/`check`
options the plain Vite builder Storybook drives doesn't understand;
importing it directly would either crash or silently no-op those keys.
`.storybook/preview.tsx` loads the same `src/index.css` the app loads
(`main.tsx`), so a story gets the real tokens/Tailwind/fonts, not a bare
DOM.

`bun run storybook` (dev, port 6006) and `bun run build-storybook`
added to `package.json`, matching the brief's ask ("Add a `storybook`
script and a `build-storybook` script").

The a11y addon is wired (`addons: ["@storybook/addon-a11y"]`,
`parameters.a11y.test = "todo"` in preview) — confirmed present in the
production build (`storybook-static/sb-addons/a11y-1/...`).

Verified both entry points work, not just installed:
- `bun run storybook` → hub-started, readiness matched on
  `"Storybook ready"` + TCP port 6006, `curl 127.0.0.1:6006/index.json`
  returned all 37 stories.
- `bun run build-storybook` → "Storybook build completed successfully",
  `storybook-static/index.json` lists 37 entries.
- Loaded 12+ individual story iframes in a real headless Chromium tab
  (`browser` device) against the built static output: zero console
  errors, zero page errors, non-empty (or correctly-empty, for the
  render-nothing case) `#storybook-root` HTML in every case. Screenshot
  of `outline-nodetexthost--multiline-with-tag` visually confirms the
  pinned typography regression state (tag pill narrows line one only;
  lines two and three run full width).

### Part 2 — coverage

**One story format.** All six pre-existing hand-rolled `stories = {...}`
modules (`bullet`, `tag-chip`, `node-row`, `field-value`, `canvas-card`,
`graph-toolbar`) migrated to CSF3 (`meta` + named `StoryObj` exports).
No hand-rolled catalog module remains. `tag-chip.stories.tsx` previously
mixed two components (`TagChip` + `TagChipGroup`) under one `stories`
bag — not expressible in CSF, where one `Meta<T>` is one component — so
it split into `tag-chip.stories.tsx` and `tag-chip-group.stories.tsx`,
with the group getting its own wrapping/empty states.

`catalog.smoke.test.tsx` rewritten to read the CSF files via
Storybook's portable-stories `composeStories`, rather than the old
per-file `stories` bag import. There is no second fixture set: a story
variant added to any catalog file is exercised by this suite for free.
37 stories → 49 smoke-test cases (36 per-variant renders + 11
"documents ≥2 variants" + 2 App error-boundary checks — no glob-count
check, see the pitfall below).

**Coverage tier 1 (the six original)** — migrated, all with their
original named states intact (`bullet`: leaf/collapsed-branch/query-kind/
media-override; `tag-chip`: static/navigable/with-actions;
`tag-chip-group`: pair/wrapping/empty; `node-row`: depth0/nested-selected/
active; `field-value` (`PropValueEditor`): checkbox-checked/text-filled/
url-empty; `canvas-card` (`TextCard`): idle/selected/empty;
`graph-toolbar`: idle/with-selection/tree-partial/empty-graph).

**Coverage tier 2 (`outline/`)** — new files:
- `node-content.stories.tsx` (`NodeTextHost`, brief's "node-content" +
  "editable-text" line items — the outline row-level `contentEditable`
  host): `OneLineWithTag`, `MultilineWithTag` (pins the exact
  `ui/tests-render/typography.e2e.ts` "a trailing pill yields only the
  first line" regression — verified visually, see screenshot evidence
  above), `ReadOnlySysNode` (padlock, `readOnly` is derived purely from
  `isSysPrefixed(nodeId)` — no store seeding needed), `ActiveEditing`
  (the `contentEditable` mode). No purity refactor was needed: the
  component reads `useOutlineStore` for `nodes`/`zoomTo`/`pendingCaret`,
  but the store's untouched default state (empty `nodes` Map, `null`
  `pendingCaret`) is a valid render input, not a live-connection
  requirement.
- `field-value-stack.stories.tsx` (`FieldValueStack`, brief's "field row
  and value stack"): `SingleValue`, `TwoValues` (the exact case the
  component's own doc comment says it was extracted to fix — a field
  with two values used to repeat the whole `FieldRow`, including its
  label, once per value), `Empty`, `ReadOnlySysField`. Already pure
  (explicit `NodeMap` prop), no refactor needed.
- `tag-chip-group.stories.tsx` — see tier 1 (split out of the
  pre-existing combined file).
- "the bullet/collapse affordances" — already covered by `bullet`'s
  `CollapsedBranch` story (kept from the original catalog).
- "editable-text" — the low-level widget (`EditableText`, internal to
  `field-value.tsx`, `data-editable-text="true"`) is exercised by
  `field-value.stories.tsx`'s `TextFilled`/`UrlEmpty` (fieldType
  `text`/`url` both route through it); the row-level editing affordance
  is `node-content.stories.tsx`'s `ActiveEditing`.

**Coverage tier 3 (graph chrome)** — `graph-canvas-frame.stories.tsx`
(`GraphCanvasFrame`, as named in the brief): `Idle`, `Empty` (legend
hides itself once `buckets.length <= 1`), `QueryError` (the in-canvas
error path from r10 §2 row 10 — chrome stays interactive, only the
canvas area swaps to the message). `graph-toolbar.stories.tsx` (tier 1)
already covers the toolbar/legend info-chip states independently.

Gap, named: the renderer components underneath the frame
(`sigma-graph.tsx`, `tree-graph.tsx`, `force3d-graph.tsx`,
`cluster-graph.tsx`) are canvas-imperative — they take a DOM container
ref and drive a sigma/three.js instance directly, not a props-driven
React tree a story can render meaningfully. Not attempted; would need a
sigma/three.js-in-jsdom-or-real-browser mock, which is exactly the "mock
empire" the brief says to avoid rather than build.

**Coverage tier 4 (command surfaces)** — `ref-autocomplete.stories.tsx`
(`RefAutocomplete`, the `[[` mention popup): `FirstHighlighted`,
`LaterHighlighted`, `OneCandidate`. Fully presentational
(candidates/activeIndex/onSelect props only), no store coupling.

Gap, named: `NodeCommandPalette` (the `/` command menu) is not covered.
It positions itself via
`document.querySelector('[data-node-id="..."] .node-row')` — a DOM
element **outside its own render tree** — and reads
`selectedNodeId`/`activeNodeId`/`wireNodes` from the outline store
directly (`if (!open || !anchorRect || !targetNodeId) return null;`).
Covering it would need a decorator that both seeds the store *and*
renders a synthetic anchor element alongside the palette purely to
satisfy `document.querySelector`, which is the "mock empire" the brief
explicitly says to avoid rather than build. Left as a named gap.

## Cut, and why

- Storybook 9 → installed latest (10.5.10) instead; see version note
  above. Not a scope cut, a version-currency call.
- `NodeCommandPalette` (tier 4) and the four canvas-imperative graph
  renderers (tier 3) — not covered; reasons above. Both are "as far as
  they get" per the brief's own tier-3/4 language, not silent gaps.
- No purity refactor was needed anywhere in `ui/src/components/**` —
  every tier-2/3/4 target turned out renderable with its existing props
  boundary (see the reasoning per-component above), so there's nothing
  to list under "small purity refactors."

## Shared-file touches

- `.gitignore` (repo root) — added `tools/kb/ui/storybook-static/`
  next to the existing `tools/kb/ui/dist/` entry. One line, additive,
  same block. Should merge cleanly against g1/t1 (neither wave touches
  the kb-ui gitignore block).
- `tools/kb/ui/vite.config.ts` — one line, added `storybook-static/**`
  to the existing `lint.ignorePatterns` array (was `["dist/**",
  "**/node_modules/**"]`) so `vp check` doesn't walk into the Storybook
  build's minified bundles. This file is not in my declared zone
  (`ui/package.json` is, `vite.config.ts` isn't), but the change is a
  single array-literal addition with no semantic overlap with g1/t1
  (backend `tools/kb/package.json` conflict zone) — flagging per
  protocol rather than reaching in silently.
- `tools/kb/ui/package.json` — declared zone. Added two scripts
  (`storybook`, `build-storybook`) and three devDependencies
  (`storybook`, `@storybook/react-vite`, `@storybook/addon-a11y`,
  `@storybook/react`). No existing script/dependency touched.
- `tools/kb/ui/README.md` — not explicitly listed in the zone, but
  it's ui-package documentation with no other wave's stated interest;
  added the two new scripts to the command list and one paragraph on
  the catalog/CSF convention.

## Guardrail evidence (red → green)

The smoke test is the guardrail: "every story renders without
throwing." Demonstrated it has teeth under **both** runners this repo
actually uses (`bun test` from `tools/kb`, and `vp test` from `ui/`):

1. Broke `field-value-stack.stories.tsx`'s `SingleValue` story
   (`values: undefined as unknown as []`, or `null as any` in an
   earlier pass — same effect).
2. `bun test catalog` → **red**:
   `(fail) component catalog smoke > field-value-stack > renders SingleValue`,
   `TypeError: undefined is not an object (evaluating 'values.length')`.
3. `vp test catalog` (vitest) → **red**, same story, same underlying
   `TypeError`, surfaced through `expect(...).not.toThrow()`.
4. Reverted the story file.
5. `bun test catalog` → **green**, 49/49. `vp test catalog` → **green**,
   49/49.

Also caught a real regression during development, not staged: the
smoke test's first draft used `import.meta.glob` to auto-discover
`*.stories.tsx` files (avoiding a maintained import list). `vp test`
(Vitest, real Vite transform) was fine with it. Running the *actual*
required verification command, `cd tools/kb && bun test` (which
recurses into `ui/` — see `AGENTS.md`), failed immediately:
`TypeError: import.meta.glob is not a function` — Bun's runtime doesn't
implement Vite's glob-import special form. Fixed by going back to one
static `import * as X from "./x.stories"` line per catalog file (11
lines, one per file) plus a small array — the dual-runtime constraint
(this suite runs under both Bun and Vitest) means the DRY glob approach
isn't actually available here; documented in the test file's own
top-of-file comment so the next contributor doesn't reintroduce it.

## Verification (counts actually observed, this session)

```
cd tools/kb && bun install && bun test
  → 766 pass, 0 fail, 3290 expect() calls   (baseline quoted: 740 — the
    +26 delta is exactly the new catalog-smoke test cases, since
    `bun test` at tools/kb recurses into ui/)

npm run typecheck   (tools/kb root, tsc --noEmit)
  → clean, no output = 0 errors

npm run check       (tools/kb root, vp check --no-fmt)
  → "Found no warnings or lint errors in 89 files"

cd ui && ./node_modules/.bin/vp test
  → Test Files 77 passed (77), Tests 536 passed (536)   (baseline: 510 —
    no regression, +26 new catalog-smoke test cases; the dedicated UI
    suite did not shrink)

cd ui && ./node_modules/.bin/tsc --noEmit   (ui-local typecheck; not one
    of the four listed commands, but the ui package's own authoritative
    typecheck per its README — run as an extra safety net on new/changed
    files)
  → clean, no output

cd ui && ./node_modules/.bin/vp check --no-fmt   (ui-local lint; same
    rationale)
  → "Found 0 errors and 20 warnings in 222 files" — the 20 warnings are
    pre-existing, in files this wave never touched (cluster-graph.tsx,
    refs.ts, mutations.ts, command-palette.tsx, palette-index.ts); 0
    errors is the bar.

cd ui && bun run build-storybook
  → "Storybook build completed successfully", storybook-static/index.json
    lists 37 story entries. Re-run clean at the very end of the session
    (after all commits), same result. Build output deleted after each
    check (gitignored, not committed).
```

The three pre-existing `ui/tests-render/graph.e2e.ts` failures noted in
the protocol as not-mine were not touched and were not re-verified
(out of scope for this wave; `vp test` above is the dedicated UI suite,
not the Playwright render harness).

## Follow-ups (not this wave)

- `NodeCommandPalette` storybook coverage, if a later wave wants it: the
  clean path is decoupling its anchor lookup from `document.querySelector`
  into a passed-in ref/rect, which is a real (if not small) purity
  refactor — worth doing on its own merits, not just for a story.
- Graph renderer components (`sigma-graph.tsx`, `tree-graph.tsx`,
  `force3d-graph.tsx`, `cluster-graph.tsx`) have no isolation story path
  without a canvas/WebGL mock; likely permanently a gap for Storybook
  specifically, covered instead by their existing component tests and
  the Playwright render harness.
- Storybook version: pinned to `^10.5.10` (whatever `latest` resolved to
  at install time, 2026-08-24). No CI job runs `build-storybook` yet —
  worth adding once this wave merges, since it's proven CI-able here.

## Self-grade

- Part 1 (install/wire): done, including the explicit early
  compatibility check the brief asked for, with real (not assumed)
  evidence it passed.
- Part 2 coverage: tiers 1 and 2 complete per the brief's own item list;
  tier 3 covered via the shared frame (not the four renderers, named
  gap); tier 4 covered for the one presentational command surface
  (named gap for the palette).
- Acceptance bullets: "one story format" — yes, verified by grep-level
  inspection (no `stories = {` bag pattern remains) and by the smoke
  test importing CSF exports directly. "`build-storybook` succeeds" —
  yes, twice, first and last commit. "Four-command verification green,
  counts reported" — yes, above, with the dual-runtime bun test count
  called out explicitly since it differs from the ui-only vp test count
  for a real, understood reason (recursion into ui/), not silently.
- Honest gap: I did not attempt a purity refactor on `NodeCommandPalette`
  to make it storyable, judging it a real refactor rather than the
  "small" one the brief authorizes in-zone. Someone could reasonably
  disagree and think it is small enough to have been worth doing here.
