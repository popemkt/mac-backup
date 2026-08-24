# kb ui — browser outliner

Vite+ (`vite-plus@0.2.8`) + React 19 + Tailwind 4 + Zustand + DataScript.

```bash
bun install       # what `kb ui` itself runs
bun run dev       # proxies /api and /ws → 127.0.0.1:4321 (or $KB_UI_API_PORT)
bun run test      # vp test (Vitest); ./node_modules/.bin/vp test also works
bun run typecheck # tsc --noEmit
bun run check     # vp check --no-fmt (lint-only)
bun run build
bun run storybook         # component viewer at http://localhost:6006
bun run build-storybook   # static build → ui/storybook-static (gitignored)
```

**Use `bun run`, not `npm run`, in this package.** `package.json` declares
`devEngines.packageManager npm@12.0.2`, so every `npm` invocation (including
`npm install` and `npm run test`) hard-fails with `EBADDEVENGINES` on an
npm 10 host. Bun ignores `devEngines`, and the `kb ui` auto-build shells out to
`bun install && bun run build` anyway.

`kb ui` (repo root) auto-builds this package into gitignored `ui/dist` when it
is missing or stale (source fingerprint vs `dist/.kb-build-hash`); `kb ui --dev`
spawns `vp dev` here with `KB_UI_API_PORT` set to the backend port. The Vite
server port is `KB_UI_DEV_PORT` (default 5173) and the proxy target is
`KB_UI_API_PORT` (default 4321).

Force fixtures (no server): `VITE_USE_FIXTURES=1 bun run dev`

Shape: `src/actions/{plan,mutations}.ts` is the optimistic mutation pipeline
(plan → local tx → `POST /api/action`, with `invertPlan` backing undo/redo);
`src/api/ws.ts` feeds live deltas into `outlineStore.applyTx`;
`src/stores/outline.store.ts` holds outline + selection + ontology-scope state;
`src/lib/` holds the pure, unit-tested helpers (caret/markdown, canvas
selection + history + tools, graph lens, ontology scope, router).

`src/catalog/*.stories.tsx` is the one place components render in isolation
— Storybook CSF3, `.storybook/main.ts` glob-scoped to this directory. Every
story is also a test: `catalog.smoke.test.tsx` reads the same files via
Storybook's portable-stories `composeStories` and asserts each variant
renders without throwing, so there is no second fixture set to keep in sync.

The interaction contracts these implement are in
[../DESIGN-UI.md](../DESIGN-UI.md).
