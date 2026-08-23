# Brief i7-tags — Tag chips + field/prefs alignment polish

Harness: omp. Zone: `ui/src/components/outline/tag-chip.tsx`,
`tag-config-panel.tsx`, tag-render call sites in `node-content.tsx` /
`node-panel.tsx` / views, `fields-section.tsx`, `field-row.tsx`,
`field-value.tsx` (ref-label rendering only), `components/prefs/**`,
`tokens.css`, `index.css`. Protocol:
`docs/kb-waves/2026-08-23/briefs/impl-protocol.md`.

## Owner directives (verbatim intent)

1. Tags must NOT share node-content weight/size — smaller, and tokenized
   (nxus editor does smaller; add a design token like --tag-size). Chips must
   fit tight.
2. Hover-only controls (remove ×) must not reserve layout space when hidden
   (current chip leaves 12px gaps; use display-based reveal, not opacity-0).
3. Remove the configure (⚙) affordance entirely. In Tana, clicking the tag
   enters the tag's own page (everything-is-a-node; tag config IS the tag
   node with fields). Ensure tag click → tag node page works consistently
   everywhere chips render (outline rows, node panel, views). Remove
   tag-config-panel if it becomes dead.
4. Field rows (owner screenshot): label and value vertical alignment is off
   ("status" vs "done" rows; watch multiline values — labels must not center
   against tall values; consistent rule: labels align to the first value
   line). `sys.f.type` rows render a raw ULID + warning glyph instead of the
   referenced tag name — resolve refs to labels; only warn when the ref
   actually fails to resolve.
5. Preferences popover (owner screenshot): the debug row wraps under the
   checkbox and misaligns; make every prefs row a proper aligned row (control
   + label baseline, no orphan wraps).

## Do

- Add the tag-size token to tokens.css (consult DESIGN-RESKIN.md tokens;
  nxus is the reference); thread it through TagChip; verify dark/light.
- Sweep EVERY TagChip usage site for consistent behavior + no reserved
  hover space; add component tests asserting: no reserved space, click
  navigates, remove reveals on hover.
- Field-row geometry: single source of alignment rules (first-line baseline
  alignment, icon column consistent); multiline field values keep labels
  top-aligned; add tests where feasible.
- sys.f.type ref resolution in field-value: lookup via store; graceful
  fallback; tests for resolved/unresolved/deleted-target cases.
- Prefs popover: fix row layout; verify with the debug-fields pref on.

## Acceptance

Owner screenshots' defects unreproducible; chips visibly tighter and smaller;
configure affordance gone everywhere; click-tag enters tag page from every
surface; suite green per protocol; handoff appended to
`docs/kb-waves/2026-08-23/reports/i7-tags.handoff.md` with shared-file touch
list (node-content.tsx is shared with i8 — keep your edits surgical).
