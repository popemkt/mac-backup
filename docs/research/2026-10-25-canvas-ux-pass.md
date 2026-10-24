# kb canvas, second UX pass against tldraw

Date: 2026-10-25. Scope: kb's canvas (`kb ui`, `/canvas/<id>`) used by a
person, compared with tldraw (the tldraw offline app, inspected only). The
fixes are in [popemkt/kb#33](https://github.com/popemkt/kb/pull/33).

The owner asked whether the canvas really is "as good as tldraw" for a human.
It was not. The feature list matched tldraw's, but the basic gestures did
not:

- You could not draw a shape by dragging it out.
- The arrow tool did not draw arrows.
- A trackpad pinch overshot to the 300% limit.
- There was no context menu.
- In bb's side panel the toolbar ran over the header.

Those are fixed now, and the remaining gaps are scored below.

## How it was tested

- `kb ui --dev` was run against a scratch `KB_HOME` from the PR branch, and
  driven with agent-browser at 1440×900 and at bb side-panel sizes (480×640,
  520×620, 600×640). The checks used real pointer, wheel and key events: drags,
  pinches (wheel with ⌃), right-clicks and keys.
- A generated "Perf 500" canvas (500 items, 200 bound edges) was used for the
  load check.
- tldraw offline was opened at 600×640 for reference
  (`ref-tldraw-600x640*.png`) and inspected only.
- Evidence is in `.kb/assets/overnight/2026-10-25/canvas-ux-pass/`. That
  folder is backed up by Mackup and is not committed. Files `01`–`20` are
  the survey and files `21`–`31` were taken after the fixes. There are no
  video recordings: the browser session received a steady stream of stray
  key events from outside the page, which made long recordings unreliable.
  Mid-gesture screenshots stand in for them (`24`, `27`).

## Scored gaps

Severity is how much a person notices: High (3), Medium (2), Low (1).
Effort is Tiny, Small, Medium or Large. The fixes were done in order of
severity per effort.

| # | Gap | Sev | Effort | Status |
|---|---|---|---|---|
| 1 | Shapes, frames and text could not be dragged out. A click placed a preset with its top-left corner at the pointer, where tldraw centres it. | High | Medium | **Fixed**: drag draws corner to corner, ⇧ squares, a click centres (`24`, `25`) |
| 2 | The arrow tool did not draw. Pressed on a shape, it dragged the shape (`12`). On empty canvas it placed a fixed 200×24 stub. | High | Medium | **Fixed**: dragging from item to item writes a bound edge that follows the items (`26`, `27`); dragging on empty canvas draws a free arrow |
| 3 | A trackpad pinch zoomed 8% per wheel event, so a gentle pinch jumped from 100% to 300%. | High | Small | **Fixed**: the zoom step follows the pinch delta, capped at 10% per event (tldraw's rule); a pinch measured 100%→135% |
| 4 | In bb's side panel the tool strip overflowed into the header and page strip (`09`), the style panel covered the selected item (`18`, `19`), and the selection bar wrapped onto two lines. | High | Small | **Fixed**: the strip wraps inside the stage, the dock folds under 720px, and the selection bar stays on one line (`21`, `22`) |
| 5 | Right-click showed the browser's own menu (`16`). | High | Medium | **Fixed** in 2D: the menu is built from the keymap's commands and shows their keys (`28`–`30`). In 3D it is still missing (gap) |
| 6 | Double-clicking empty canvas made a text card that was not open for typing. | Med | Tiny | **Fixed** (`23`) |
| 7 | ↵ did not edit the selected item. | Med | Small | **Fixed** |
| 8 | There was no ⌘X. | Med | Small | **Fixed**: copy then delete, as one undo step |
| 9 | The "100%" in the header could not be clicked, so there was no zoom UI. | Med | Small | **Fixed**: it is now a zoom menu (`31`) |
| 10 | There are no undo or redo buttons; undo is only on keys and in the context menu. | Med | Small | Open (kb todo) |
| 11 | Shape labels are one-line inputs cut off with "…", where tldraw's labels wrap over several lines. | Med | Medium | Open (kb todo) |
| 12 | Only the four corners resize. The side port dots look like side handles but are not. | Med | Medium | Open (kb todo) |
| 13 | With nothing selected there is no style panel, so you cannot set the next shape's styles. | Med | Med–Large | Open (kb todo) |
| 14 | The text tool makes a bordered card of fixed size, not tldraw's borderless text that grows as you type. | Med | Large | Open (kb todo) |
| 15 | An arrow drawn from an item to empty canvas is free, not bound at its start. A JSON Canvas edge needs both ends. | Med | Medium | Gap `01M5QP271PQ15E7WZ36KEN055N` |
| 16 | A shape being drawn does not snap; only moves and resizes do. | Low | Small | Gap `01M5QP28SNK7S9B95ZXD0KWCKR` |
| 17 | There is no context menu in 3D, where the right button pans. | Low | Medium | Gap `01M5QQVBJFGF3GKZJVF151CABJ` |
| 18 | Unedited shapes show a "Label" placeholder in both painters (`03`). | Low | Small | Open (kb todo) |
| 19 | A label can keep a stale text-selection highlight after a drag or an edit (`27`). | Low | Small | Open (kb todo) |
| 20 | An empty canvas gives no hint of how to start (`01`). | Low | Small | Open (kb todo) |
| 21 | Tooltips are the browser's plain `title`. | Low | Small | Open (kb todo) |
| 22 | There is no eraser (E extrudes) and no sticky-note preset (N is the kb node). | Low | Medium | Open (kb todo) |
| 23 | Snap guides run across the whole viewport, not just between the shapes they align (`10`, `11`). | Low | Medium | Open (kb todo) |
| 24 | The points of a path cannot be dragged. | Low | Medium | Existing gap |

## What already held up

- Snap guides appear while dragging (`10`, `11`).
- Double-clicking a shape edits its label (`14`).
- Undo steps match the gestures (`13`).
- `?` opens the shortcut sheet, which comes from the same table as the keys
  (`07`).
- The page strip and the style panel work.
- Load: "Perf 500" (`20`) panned at about 51 fps and zoomed at about 50 fps
  in dev mode, so the canvas perf work (kb `docs/research/2026-10-24-canvas-perf.md`)
  holds at this size. The scripted drag benchmark did not run because the
  stray browser key events stalled it.

## The fixes, briefly

kb#33 is three commits. Each one goes through an existing seam rather than
adding a parallel path:

- **Drafts** go through the pointer reducer that strokes already use.
  - A new `draft` drag uses `draftItem`.
  - A line uses `lineThrough`, which is now shared with freehand strokes.
  - An arrow from one item to another writes the same edge record as port
    drags and agents (`connectItems`).
  - In 3D, a placing tool now draws on the floor where it used to orbit.
- **The menus** list rows from `CANVAS_SHORTCUTS` by label (`CANVAS_MENUS`).
  - Each row is sent through the keymap's own handler, so a row and its key
    cannot behave differently.
  - The context menu and the zoom menu are one `CommandMenu` component.
  - The view menu shares their surface, rows and arrow keys.
  - The popover-dismiss contract test covers the menu.
- **Pinch** uses tldraw's delta-based step in both projections.
- **Side panel**: the tool strip wraps, and the dock folds below
  `DOCK_COMPACT_WIDTH`.

Gates: `bun run verify`, `bun run test` (2731 pass) and `bun run test:ui`
(canvas-ui: 815 pass) are all green.

## Next

The rest is tracked in the kb repo as a `#todo` ("Canvas UX pass 2") with 11
children, ordered by severity per effort. Undo and redo buttons beside the
zoom menu are the cheapest next fix, then multi-line shape labels and side
resize handles. Auto-sizing text is the largest item and the most visible
remaining difference from tldraw.
