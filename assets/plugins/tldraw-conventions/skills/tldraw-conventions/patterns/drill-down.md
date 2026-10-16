# Drill-down

Layered comprehension across pages: an overview shows many items at one altitude; any item that
deserves more gets a badge that opens its own page, where it can go all out. Pages link freely, so
the board is a graph of zoom levels, not a single giant canvas.

## When

- A set of things (swimlanes, services, decisions, components, people…) needs both a "see it all"
  view and a "go deep on one" view.
- An overview is getting crowded with detail that only matters for one item.
- The user asks to drill down, layer it, or give an item its own page.

## Shape

```text
[Overview page]                     [Item page: "Overview / Item"]
 ┌──────┐ ┌──────┐ ┌──────┐          ‹ Overview   ‹ Other grouping      ← back badges
 │ A  ↘ │ │ B    │ │ C  ↘ │  ─────▶   full detail: sub-diagrams, notes,
 └──────┘ └──────┘ └──────┘           tables, flows…   │ sub-item ↘ │ ──▶ deeper page
   only items with a page get ↘                          └──────────┘
```

- **Overview page** — uniform cards, one per item, same size and style; the generic presentation.
  Enough to compare items, nothing more.
- **Drill badge** — small, consistent marker on a card's corner (`↘` or `details ›`, pick one per
  board). Only on items that have a page; a missing badge means "nothing deeper".
- **Item page** — named as a breadcrumb, `Overview / Item` (deeper: `Overview / Item / Sub`), so
  the page list reads as a tree. Top-left carries **back badges** to every page that drills into
  it — not only the parent; any grouping page counts. Below that, anything goes.
- **Cross-links** — an item page may drill into other item pages or other overviews. It's a graph:
  the same item can be reached from several groupings, and each of them appears in its back badges.

## Rules

- **One altitude per page.** If an overview card grows detail, move the detail down a level and
  leave a badge. If an item page only restates its card, delete the page and the badge.
- **Same identity on every level.** An item keeps its title text and family colour on the overview,
  its own page, and anywhere else it appears.
- **Navigation is data + one handler.** A badge is a locked control shape with
  `meta.drill = { to: '<pageId>', focus?: '<shapeId>' }`. One board script handles every control
  carrying `meta.drill` — switch page, then zoom to `focus` or fit the page. Never a handler per
  badge. Build it from the `clickable-card-or-button-ui` recipe (see `tldraw-offline`); tell the
  user the badges are locked.
- **Page order** — root overview first, item pages grouped after their primary parent in breadcrumb
  order, `Agents` and `Audit log` last.

## Checks

Before reporting done, verify on the board (via `/exec`):

- every `meta.drill.to` resolves to an existing page (no dead badges);
- every item page has a back badge for each page that drills into it;
- every page except the root is reachable from the root;
- `helpers.getLints()` is clean on each page you touched.
