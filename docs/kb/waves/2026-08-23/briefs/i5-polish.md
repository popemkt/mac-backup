# Brief i5-polish — Whole-surface polish wave

Harness: codex. Zone: everything OUTSIDE components/outline|graph|canvas:
`App.tsx` chrome, `components/sidebar/**`, search-box, node-panel, prefs,
query-page, view-panel, table/board/cards views, toast lib,
ref-autocomplete, node-command-palette, breadcrumbs, systemic states.
Protocol: `docs/kb/waves/2026-08-23/briefs/impl-protocol.md`.

NOTE: your zone includes App.tsx/tokens.css which other waves also touch
minimally — keep edits surgical and list them all in the handoff note.

Research input: `docs/kb/waves/2026-08-23/reports/r7-ux-sweep.md` — normative.
Work its ranked findings; prioritize the "feel killers" shortlist. Command
palette coverage/frecency, search ranking/highlighting, view config
persistence, loading/empty/error state consistency, focus management,
keyboard coherence across surfaces.

If a finding turns out to belong to another wave's zone, skip it and log to
handoff (orchestrator routes).

Acceptance beyond the suite: every surface has deliberate loading, empty, and
error states; palette covers the report's action list; no keyboard traps;
dark/light parity verified by eye on both.
