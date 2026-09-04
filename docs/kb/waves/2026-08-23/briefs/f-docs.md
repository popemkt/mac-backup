# Brief f-docs — Documentation integration for the 2026-08-23 wave

Harness: claude. Zone: `tools/kb/*.md` design docs, `tools/kb/ui/README.md`,
`docs/kb/waves/2026-08-23/**` (your handoff), and generated `docs/kb/*`
(via the materialize action ONLY). Do NOT touch code or other waves' zones.
Protocol basics apply: gate first, never push/merge.

## Mission

Six implementation waves landed on main tonight; the design docs must tell
the truth again. Work from the merged code + the research reports in
`docs/kb/waves/2026-08-23/reports/`:

1. `DESIGN.md`: add an Ontology section (r5 report §concepts + what i6
   actually shipped: `#ontology` tag kind, membership union semantics,
   cycle-safe extends, ontology.members action, scoped reading mode). Note
   the extension SDK contract (`kb ext sdk --write`, `.kb/sdk.d.ts`,
   freshness test) wherever extensions are documented. Note the JSONL write
   hardening (write-lock + fsync durable-replace) in storage sections.
2. `DESIGN-UI.md`: outline interaction model changes from i1 (transient
   empty nodes replace permanent ghost rows, undo/redo stack, caret
   geometry, Mode A/B keymaps); graph interaction vocabulary from i2
   (select-in-place, animated camera, worker layout, search/filter, arrows,
   weighted edges); canvas model from i3 (multi-select, undo/redo, delete,
   snap guides, zoom-to-fit, sticky tools).
3. `INSPIRATIONS.md`: update/add lineage rows for anything adopted tonight
   (ontology = owner design + Tana supertag lineage; conditional-write
   preconditions idea = zerolang research note, adopted or parked — check
   r8 + whether i4 implemented preconditions; weighted edges/arrows =
   CodeFlow).
4. Run `bun tools/kb/src/bin/docs-materialize.ts` if any generated doc input
   changed, and ensure `kb action-invoke '{"id":"ext.docs.check","input":{}}'`
   passes.
5. Verify every command you document actually runs.

## Deliverable

Commits on your branch + handoff at
`docs/kb/waves/2026-08-23/reports/f-docs.handoff.md`.
