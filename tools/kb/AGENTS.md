# kb — Agent Notes (tools/kb)

Scope: developing kb the tool. Using kb as this repo's knowledge base, and
every repo-wide rule (Rule 1, canonical statements, drift markers, the
admission gate), is in the root [`AGENTS.md`](../../AGENTS.md); nothing here
restates it. Specs: `DESIGN.md`, `DESIGN-UI.md`, `DESIGN-REFINE.md`. Wave
records: `docs/kb/waves/`.

## Shape

Core is mechanism only (store, datalog, registry, subscriptions, render
backbone). Repo-specific policy lives in extensions: `.kb/extensions/*.ts`
modules default-exporting an array of contributions — actions
(`{...ActionDefinition, handler}`) and render templates (`{id, template}`) —
each registered as `ext.<file>.<id>`; loader failures warn and skip, never
crash core. The bundled example `@kb/ext-docs` (`tools/kb/packages/extension/ext-docs`)
owns `ext.docs.materialize`/`ext.docs.check` and the templates
`ext.docs.todos`/`ext.docs.rules` (the bare ids `docs.materialize`,
`docs.check`, `todos` and `rules` remain as aliases, so pre-commit and
existing view specs are unchanged).

- Workspace: `tools/kb` is a Bun workspace; every concept is a package under
  `tools/kb/packages/<layer>/<name>` named `@kb/<name>`, with one curated
  barrel at `src/index.ts`. Its two axes have two homes: the **layer** is the
  folder it sits in (`domain`, `contract`, `infrastructure`, `application`,
  `extension`, `app`, `test-support` — exactly the `LAYER_ALLOWS` keys), and
  the **scope** is one `scope:*` tag in its `nx` key. A `layer:*` tag is a
  duplicate of the folder and fails `workspace-shape`. There is
  no alias map — `@kb/*` resolve as workspace packages, and a package name
  never encodes its layer. Internal deps are
  `workspace:*`, external deps are `catalog:`, and the catalog in the root
  `package.json` is the only file that names a version.
- Runtime/tooling boundary: Bun is the production runtime (Bun APIs stay where
  appropriate); TS 7 + Vite+ (`vp` 0.2.8) + oxlint + Nx own the tooling. Run
  `bun run verify` (typecheck + lint + knip + harness — the entry point a human
  or CI runs), `bun run typecheck` (authoritative zero-error `tsc --noEmit` per
  package via Nx, also in pre-commit when `tools/kb/` changes), `bun run test`,
  `bun run test:ui`. Two runners split by package: everything but `@kb/ui` runs
  on `bun test`; the browser package runs on Vitest. See `tools/kb/DESIGN.md`.
- Linting & boundaries (`tools/kb`): every boundary — layer and scope
  direction, the isomorphism fence (a `scope:shared` package may not import
  `node:*`, `bun:*`, or `@effect/platform-bun`), and the zone matrix inside
  `packages/app/ui` (`UI_ALLOWS`, whose sanctioned breaches carry
  `// GAP [[id]]` on the import line) — is stated once in
  `tools/kb/harness/src/constraints.ts` and enforced by `tools/kb/harness`
  (root tooling, not a workspace package) over what the code imports.
  Three tsconfig presets sit under the one strictness base and a package picks
  one by its scope tag: `tsconfig.iso.json` for `scope:shared` (no `types`, so
  `Buffer` and `process` are compile errors — the half of the fence the import
  graph cannot see), `tsconfig.bun.json` for everything else, and
  `tsconfig.browser.json` for `scope:browser`; a `scope:shared` package carries
  a second `tests/tsconfig.json` on the Bun preset, because `bun test` is Bun
  whatever the code under test targets.
  `tools/kb/.oxlintrc.json` is the single oxlint ruleset: the three categories at `error`, the rules
  beyond them, and overrides only for the test-file and `.d.ts` file classes.
  A file that legitimately breaks a rule carries a pinpoint
  `// oxlint-disable-next-line <rule> -- <reason>`, not an override.

## Extensions

`@kb/ext-check` owns the `ext.check.audit` read action and `ext.check.sync` apply action: it proves that every `rule.check` points to a `#check` whose evidence exists and whose invocation is wired into its declared surface, rejects stale enforcement, simultaneous `gate` and `check`, and broken rule homes, and derives `rule.enforcement` from the check surface. To remove it, delete `packages/extension/ext-check`, its `BUNDLED_EXTENSIONS` registry entry, `packages/app/cli/src/bin/check-audit.ts`, and the `check:audit` script plus its `verify` mention; remove the `@kb/ext-check` manifest dependencies and refresh `bun.lock`; the `check` tag, the `enforcement` field's option children and `rule.check` refs are data and may stay or be removed with `kb rm`, after which the rules index is hand-typed again.

### Effect

`tools/kb` is written in Effect (v4). **Before writing any Effect code, read
`tools/kb/node_modules/effect/AGENTS.md` completely** and follow the links in
it; for APIs it does not cover, read the source under
`tools/kb/node_modules/effect/src`. Never external docs or v3 muscle memory —
both are wrong for v4. That file ships inside the `effect` tarball, so it is
absent on a fresh clone until `bun install --cwd tools/kb`; the pre-commit hook
already guards on the same path.

v4 non-negotiables: `Effect.gen` for inline code; `Effect.fn("name")` (or
`Effect.fnUntraced` on hot paths) for reusable functions, never a plain wrapper
that just returns an `Effect.gen`; `Schema.TaggedError` for errors, not
`Data.TaggedError`; `Context.Service` classes for services, not `Context.Tag`;
`Effect.catch`, not `Effect.catchAll`; `Schema` imported from `"effect"` core,
never `@effect/schema`; `return yield*` when raising, so control flow narrows.

The official Effect skills (`effect-ts`, `effect-v3-to-v4`) are installed at
repo scope by the skills CLI, with their lockfile committed; `effect-ts` is a
setup skill and is redundant once the pointer above is followed, and
`effect-v3-to-v4` is explicit-invoke only (kb was born on v4).
