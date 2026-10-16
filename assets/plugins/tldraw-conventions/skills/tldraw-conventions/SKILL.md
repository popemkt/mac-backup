---
name: tldraw-conventions
description: The owner's house conventions for tldraw canvases — agent ledger page, styling, and a library of layout patterns (drill-down, …). Load alongside tldraw-offline whenever creating or editing a tldraw board, or when the user names a pattern - "drill down", "layered overview", "overview + detail", "zoom levels", "give it its own page", "multilevel canvas".
---

# tldraw conventions

This skill holds **conventions only**. How to drive the app (server, `tq`, `/exec`, scripts,
recipes, lints, screenshots) lives in the `tldraw-offline` skill — load that for mechanics and do
not look for them here. When delegating to the `tldraw-offline` subagent, tell it to read this
file too.

## Every board: agent ledger

Each board carries two bookkeeping pages, placed **last** in the page list:

| Page | Audience | Content |
|---|---|---|
| `Agents` | the owner, at a glance | one row per session that edited the board |
| `Audit log` | agents only — the owner will rarely open it | detailed per-session record |

**`Agents` page** — one row per session, newest on top. Columns, nothing more:

```text
date (YYYY-MM-DD) · agent (harness + model, e.g. "Claude Code / Opus 5.5") · session (short id) · one-line what
```

- Session id: whatever the harness exposes (Claude Code: the session UUID in the scratchpad path /
  transcript name — first 8 chars). Unknown → write `—`, never invent one.
- Same session edits again → update its row's one-liner, do not add a second row.
- Rows are plain text shapes with stable ids `shape:ledger-<session8>` and
  `meta: { ledger: true, agent, session, date }`, so the next agent can find and update them.

**`Audit log` page** — append one block per session: date, agent, session, pages touched, what
was created / changed / deleted (shape ids where useful), anything left unfinished. Free text, no
styling effort. This is where detail goes so the `Agents` page stays one line per row.

Create both pages on first touch of a board that lacks them. Update both before reporting done.

## Styling

- Colour groups and boxes **by concept family**, with a legend. Legends are visual: small swatch
  (or sample arrow) + short label, not a sentence.
- Lines and arrows stay black. Colour them, or dash them, only when it carries meaning (e.g. grey
  dashed = reference vs solid = ownership). One meaning per colour across the board.
- Headings plain; larger group labels are fine.
- No decoration: no header bars, tabs, accent bars, zoom-adaptive or scripted labels. Scripts are
  for behaviour (navigation, controls), not ornament. Ask before adding anything decorative.

## Patterns

A repository of layouts the owner reaches for often. A pattern is a starting point, not a law —
deviate when the content asks for it, and say so. When the request matches a trigger below, read
that pattern file before building.

| Pattern | File | Triggers |
|---|---|---|
| Drill-down | [patterns/drill-down.md](patterns/drill-down.md) | drill down, layered overview, overview + detail, zoom levels, deep dive into item, give it its own page, multilevel / infinite canvas, explode this box |

New pattern → add `patterns/<kebab-name>.md` (sections: *When*, *Shape*, *Rules*, *Checks*) and
a row here, with its trigger words also added to this skill's `description`.
