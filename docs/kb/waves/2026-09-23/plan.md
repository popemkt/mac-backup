# Wave 2026-09-23 — outside lint, then plugins that own their UI

Single worker (claude / opus) on `main`, in order.

| wave | what | status |
|---|---|---|
| l1-lint | anti-slop subset vendored, oxlint 1.83, `@shadcn/lint` measured | done — `reports/l1-lint.md` |
| p1-plugins | a DeepSeek-Harness-style plugin kernel under every extension, server and browser | in progress — `briefs/p1-plugins.md` |

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
