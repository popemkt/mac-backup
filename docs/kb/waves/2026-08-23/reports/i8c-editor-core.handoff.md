# i8c editor-core handoff

## Implementation handoff

Shipped five commits on `popemkt/kb-i8c-editor-core` (not pushed or merged):

- `fc188b5` — CaretIntent: consumable placement slot, offset mapping, and text hosts no longer react to incidental cursor state.
- `e44280d` — FocusRegistry: ancestor expansion, visible-target refusal, mounted-host registration, and selection-mode fallback.
- `139f12b` — HTTP/WS origin correlation skips the originator echo; remote deltas retain queued local text.
- `49337b1` — `NodeTextHost` is the shared outline/title host; title now uses markdown serialization and supports native Shift+Enter.
- `2eadea6` — reconciled forward-delete, multiline rendering, and transient remote-compensation docs.

Shared-file touches: `tools/kb/src/surface/ui/{http,server,session}.ts` add optional HTTP-origin broadcast exclusion. `tools/kb/ui/src/api/{action,ws,live}.ts` carries the stable tab origin and preserves pending text on remote tx. No graph or canvas component files changed.

Verification (final): `bun test` 644 pass; `npm run typecheck` pass; `npm run check` pass; UI `vp test` 434 pass.

Honest gaps: the canvas compatibility `cursorPosition` projection remains until its concurrent owner adopts CaretIntent. Reference-instance renderability is completed by mounted-host validation because query projections own their exact mount timing. Table/board already render through the `NodeContent` compatibility alias of `NodeTextHost`.
