# kb

Repo-native outliner datastore. Bun is the production runtime; the toolchain
is TypeScript 7 + Vite+ (`vp` 0.2.8). See [DESIGN.md](./DESIGN.md) for the
runtime/tooling boundary and Effect action-handler seam.

```bash
bun test          # recursive from tools/kb: backend + most ui/ tests (needs ui deps)
npm run typecheck # tsc --noEmit, zero-error gate (also in pre-commit)
npm run lint      # vp lint (oxlint; ignores ui/)
npm run check     # vp check --no-fmt (lint-only; typecheck is tsc above)
npm run fmt       # vp fmt (oxfmt; incremental adoption)
```

UI (`tools/kb/ui`) is a separate Vite+ package: `vp test`, `vp build`,
`tsc --noEmit` via `npm run typecheck`. Backend `vp` does not lint or check it.
`bunfig.toml` only excludes Vitest-only UI paths from recursive `bun test`;
install UI deps before relying on a full `bun test` from `tools/kb`.

Core / bundled actions are Effect-native (`ActionDefinition.effect` +
`KbCtx`/`KbStore`/`FileSystem` Layers). Third-party `.kb/extensions` may keep
Promise `handler`s; the registry uses `tryPromise` only for those.
