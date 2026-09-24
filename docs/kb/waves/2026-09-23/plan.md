# Wave 2026-09-23 — outside lint, then plugins that own their UI

Single worker (claude / opus) on `main`, in order.

| wave | what | status |
|---|---|---|
| l1-lint | anti-slop subset vendored, oxlint 1.83, `@shadcn/lint` measured | done — `reports/l1-lint.md` |
| p1-plugins | a DeepSeek-Harness-style plugin kernel under every extension, server and browser | phases 1–3 done; 4–5 wait on a `@kb/ui-sdk` decision — `briefs/p1-plugins.md` |

## p1 in one paragraph

Today an extension is a default-exported array of actions and templates,
backend only; the UI hardcodes canvas, graph and ontology (routes, sidebar,
bullets, view modes, the literal `"ext.canvas.tx.apply"`). p1 puts one
Effect-native plugin kernel (`@kb/plugin`, `scope:shared`) under both halves:
a plugin declares what it `inject`s, `provide`s services other plugins call,
`contribute`s to typed points (actions, templates, and later UI surfaces),
talks over typed events, and loads children. Every registration is tied to
the plugin's `Scope`, so unload — and reload — is closing that scope, and a
dependent whose service disappears goes back to pending instead of holding a
dead reference. Prior art and the reasoning: DeepSeek Harness
(`dsh.client` + Cordis), OpenCode (`.` + `./tui`), VS Code contribution
points; the survey is summarised in the brief.

Phases, each its own commit, restructure before add:

1. `@kb/plugin` — the kernel and its contract tests. Nothing uses it yet.
2. The backend registry is the kernel: core actions, the three bundled
   extensions and `.kb/extensions/*.ts` load as plugins; the array format is
   the declarative form of a plugin, bridged, not a second path.
   Behaviour-preserving: every existing test passes unchanged in meaning.
3. The browser runs a kernel too; routes, sidebar sections, bullet kinds,
   view modes and commands become points the built-in views contribute to.
4. Canvas moves into `ext-canvas`: its seeds, its action and its UI, one
   extension with a backend entry and a `./ui` entry.
5. `.kb/extensions/<name>/ui.tsx` loaded at runtime (server-built ESM plus an
   import map), unload/reload on change.

## Status

| phase | commit | state |
|---|---|---|
| 1 kernel | `77f0133` | done — 14 contract tests |
| 2 backend registry on the kernel | `aacf165` | done — registry shape unchanged, clash fails a plugin as a unit |
| 3 browser kernel: surfaces + sidebar sections | `6bf48dc` | done — route table asserted over contributions |
| 4 canvas into `ext-canvas` (`./ui`) | — | gap: canvas's UI lives in @kb/ui |
| 5 runtime UI for `.kb/extensions` | — | gap: repository extensions cannot ship UI |
| — hot reload | — | gap: the action registry is build-once per process |

4 and 5 share a prerequisite that is a design decision, not a mechanical
step: `@kb/ui-sdk`, the host API an extension's browser half may use. The
canvas UI reaches the outline store, the text-host primitive and
`actions/mutations`; which of those become public API decides both phases.

Render e2e: 9/15 pass; the 6 graph-renderer cases (`render.e2e.ts`) fail
identically with phase 3 stashed, so they predate this wave and were not
investigated here.
