# The page-head backdrop as a plugin point

Record of 2026-10-17. It is built on `feature/kb-backdrop-point` as two
commits: first the restructure, then the change. What it states is stated
once, in
[DESIGN-UI.md → Page-head backdrops](../../../tools/kb/DESIGN-UI.md#page-head-backdrops).
This file records the decisions and what is left open.

## What the owner asked

> "the header viz, should be a kind of plugin as well, or a surface for plugin to be able to influence"

## Before

- `@kb/ui-sdk` named the backdrops in a closed table: `HEADER_BACKDROPS`,
  their labels and `HEADER_BACKDROP_PRESENTATION`.
- `outline-ui`'s `HeaderBackdrop` chose between them with a switch.
- Preferences had its own picker over the same table.
- The choice, its strength and its direction were device preferences in
  `localStorage`.

A third backdrop meant editing the kit, the outline and Preferences.

## What is built

1. **`BackdropPoint`** (`ui.backdrops`) sits beside the view, sidebar, dock
   and overlay points.
   - A contribution carries its key (the declared id and label), its
     presentation (the row the closed table held) and its component.
   - The component receives the colour, the node, the strength, the
     direction and the opacity at that strength.
   - The kit names no backdrop.
2. **One slot.** `PageBackdrop` frames the chosen contribution behind any
   page head. Today, the outline's home head and a zoomed node's head render
   it.
3. **Backdrops are declared, as views are.** A declaration lists its
   backdrops' keys (`backdrops`). The seed fold derives one option node per
   key under `sys.f.backdrop`, owned by the family, the way it derives view
   options under `sys.views`.
4. **A `backdrops` family** declares and contributes kb's two backdrops,
   unicorn and gradient. The family is `@kb/backdrops` (the declaration,
   optional and on by default) plus `@kb/backdrops-ui` (the contributions).
5. **The choice is fields.** Core seeds three settings of
   `sys.extension.core`. Each one is a ref to its own field's children:
   - `sys.f.backdrop`: the derived backdrop options;
   - `sys.f.backdrop.strength`: `subtle`, `soft` or `vivid`;
   - `sys.f.backdrop.direction`: `down` or `up`.

   The same fields on a node choose for that node's page, one setting at a
   time, before core's settings apply (`backdropChoice`).
6. **One picker.** Preferences draws the three settings with the page's
   field editor, as the agent's settings are drawn. The backdrop field's
   options are the one list of backdrops; the closed enum select is gone.
7. **The contract** (`app/ui/src/backdrop-point.contract.test.tsx`) runs
   over every contribution, including a test plugin with its own
   declaration.
   - Each contribution answers to its declared id, and its option is in the
     seed.
   - The slot shows each one at every strength and direction, framed by its
     presentation.
   - Choosing one writes core's setting, which the row and the slot then
     show.
   - A page's own node overrides core's settings.

## Decisions

- **A family of its own, not outline-ui's.**
  - A backdrop is page ambience. The outline renders the slot in its heads,
    but it owns no backdrop, and a canvas or graph head will render the
    same slot.
  - Leaving kb's backdrops in `outline-ui` would make switching the outline
    off take every page's backdrop with it. It would also make the outline
    the place a second backdrop is added.
  - A small family makes backdrops switchable on their own, and gives them a
    footprint (`kb ext footprint backdrops`), like any family.
- **Core owns the settings, not the backdrops family.**
  - The slot is kit mechanism, and the choice is the slot's: it picks among
    every family's contributions, so it is not the setting of whichever
    family ships a backdrop.
  - Core's node is where a setting of a core mechanism lives. With the
    settings on `sys.extension.backdrops`, choosing another family's
    backdrop would mean writing kb's family's node, and switching the family
    off would strand the choice.
- **The backdrop is an option node, derived from a declaration.**
  - A first cut held the contribution's id as text, because contributions
    exist only in the page's kernel.
  - The coordinator asked to close that gap instead of recording it. The
    fold already derives option nodes from declared view keys, so a
    declared backdrop key gets the same treatment.
  - The page plugin contributes under that key (`provideBackdrop`), so the
    option and the contribution share one id.
  - Repository extensions cannot declare backdrops, just as they cannot
    declare views. They have no page half, and `decodeDeclaration` refuses
    the key.
- **The preferences are dropped, not migrated.**
  - The old keys are ignored on read and dropped on the next write, as the
    `font` preference was.
  - Behaviour is unchanged: with no settings, the head shows the first
    contribution (unicorn), subtle, facing down, as the old defaults did.
  - A device that had chosen otherwise shows the default once, until someone
    picks again. Reading a device preference into repository data on load
    would make opening the page a write.
- **The contract lives in `app/ui`.** It covers the page's families and the
  one picker, and only the shell holds both.

## Left open

- **Canvas and graph pages have no head** (gap 01M54CEKJJXNDPYNT55AR6KEV8).
  The slot is available to them, but nothing renders it there. No head was
  invented. The canvas packages belong to another builder.
- **A page's own backdrop has no gesture** (gap 01M54CEM0Z5SMAS7KABS7QZ67C). The slot reads the page node's
  fields, but `sys.*` props are hidden from field rows. So a page's choice can
  be written only from the CLI or MCP, or with debug fields shown.

## Review round 4 (GPT-6.1 Sol, 2026-10-17): batch B

A review of the backdrop point as it landed (main `c00a439a`). Each finding
was verified against the code before it was fixed.

| # | Severity | Finding | Fix |
|---|---|---|---|
| B1 | minor | A stale backdrop id falls back to the wrong choice: `chosenBackdrop` returns the first backdrop for an unknown id, and `backdropChoice` takes the page's stale value first. | An unknown id counts as absent in `backdropChoice`, falling through to core as strength and direction do; a stale-id case in the contract. |
