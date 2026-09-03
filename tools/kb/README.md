# kb

Repo-native outliner datastore, built as a Bun workspace: every concept is a
package under `packages/<name>`. Bun is the production runtime; the toolchain
is TypeScript 7 + Vite+ (`vp` 0.2.8) + oxlint + Nx. See
[DESIGN.md](./DESIGN.md) for the workspace shape, the runtime/tooling
boundary, and the Effect action-handler seam.

```bash
bun install         # one lockfile for the whole workspace
bun run verify      # typecheck + lint + knip + harness — the entry point
bun run typecheck   # nx run-many -t typecheck (authoritative, also pre-commit)
bun run lint        # oxlint --type-aware over packages/
bun run test        # bun test packages
bun run test:ui     # Vitest inside @kb/ui
bun run test:dst    # deterministic simulation sweep
bun run harness     # repo-shape checks (boundaries, public surface, versions)
```

Two runners, split by package rather than by file: everything except `@kb/ui`
runs on `bun test`; the browser package runs on Vitest because its suite needs
happy-dom, `vi.mock` hoisting and fake timers. `bunfig.toml` states that split
once.

Core / bundled actions are Effect-native (`ActionDefinition.effect` +
`KbCtx`/`KbStore`/`FileSystem` Layers). Third-party `.kb/extensions` may keep
Promise `handler`s; the registry uses `tryPromise` only for those.

### External extension types

```bash
kb ext sdk --write   # writes .kb/sdk.d.ts matching this kb binary
```

```ts
/// <reference path="../sdk.d.ts" />
import type { ExtensionAction } from "kb-ext-sdk";

const actions: ExtensionAction[] = [/* … */];
export default actions;
```

No repo-relative imports, no npm install of kb. Regenerate the embedded
string after changing `packages/ext-sdk/src/surface.ts`: `bun run gen:ext-sdk`.
