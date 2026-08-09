# kb

Repo-native outliner datastore. Bun is the production runtime; the toolchain
is TypeScript 7 + Vite+ (`vp` 0.2.8). See [DESIGN.md](./DESIGN.md) for the
runtime/tooling boundary.

```bash
bun test          # backend tests (Bun-dependent tests stay on bun:test)
npm run typecheck # tsc --noEmit, zero-error gate (also in pre-commit)
npm run lint      # vp lint (oxlint)
npm run check     # vp check --no-fmt (lint + typecheck)
npm run fmt       # vp fmt (oxfmt; incremental adoption)
```

UI (`tools/kb/ui`) is a separate Vite+ package: `vp test`, `vp build`,
`tsc --noEmit` via `npm run typecheck`.

M1: model, JsonlStore, DataScript adapter, action registry, `node.*` / `field.define` / `tag.define` / `graph.query`.
