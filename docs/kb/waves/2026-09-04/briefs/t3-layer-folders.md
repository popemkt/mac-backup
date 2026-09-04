# t3-layer-folders — packages live under their layer; the folder is the layer

Wave `t3` of `docs/kb/waves/2026-09-04/plan.md`. Harness: claude. **Branch
from `main` only after `t2` has merged** (the workspace reader is rewritten
there; read `reports/t2-harness-root.md` first, it lists every
`@kb/${dir}` site).

Read first: `AGENTS.md` Rule 1 ("bridges over mirrors"), "Module Boundaries";
`tools/kb/DESIGN.md` "Two axes"; `tools/kb/harness/src/workspace.ts`,
`constraints.ts`, every harness test; `pkgs/kb/default.nix`;
`.githooks/pre-commit`; `.github/workflows/validate.yml`.
Run `intent/gate.sh session claude-code` first.

## 0. Decision (coordinator)

Skimmability was the ask. A folder per layer gives it, but a folder that
merely repeats `layer:*` in `nx.tags` is a mirror. So the folder **is** the
layer: `layer:*` tags are deleted; the harness derives `layer` from the path
segment. `scope:*` stays a tag — it names the runtime the code must survive,
which is orthogonal to placement. Two axes, two homes, one statement each.

Target tree:

```
packages/
  domain/          model  query  canvas
  contract/        contracts  ext-sdk
  infrastructure/  store-jsonl
  application/     operations
  extension/       ext-canvas  ext-docs
  app/             runtime  server  cli  mcp  ui  test-kit
  test-support/    render-tests
```

Layer names are exactly the `LAYER_ALLOWS` keys; a folder whose name is not a
key is a red case for `workspace-shape`.

## 1. Move (one commit, behaviour-preserving)

- `git mv` each package into its layer folder. Package names (`@kb/<pkg>`) do
  not change.
- `tools/kb/package.json` `workspaces.packages`: `["packages/*/*"]`.
- Every package `tsconfig.json`: `extends` gains one `../`. `packages/ui`'s
  `paths` (`@/*`) and its vite/storybook/vitest configs: check every relative
  path. `render-tests/playwright.config.ts` likewise.
- `tsconfig.bun.json` Effect override `include`: `packages/*/*/src/**/*`.
- `.oxlintrc.json`: no boundary globs remain; check the test override list.
- `knip.json` workspace keys; `tools/kb/package.json` scripts
  (`test:dst`, `bench`, `gen:ext-sdk`, anything naming a package path);
  `bin/kb` (`packages/app/cli/src/main.ts`); `.githooks/pre-commit` and
  `.github/workflows/validate.yml` (`docs-check.ts` path); `AGENTS.md` (every
  `tools/kb/packages/<name>` mention and the "Workspace" bullet);
  `tools/kb/DESIGN.md`, `DESIGN-UI.md` paths.
- `pkgs/kb/default.nix`: `packages/ui` → `packages/app/ui`, `packages/cli` →
  `packages/app/cli`; the wrapper's `$out/lib/kb/packages/ui/dist` and
  `packages/server/src/paths.ts`'s resolution of the UI dist must agree
  (`packages/app/ui/dist`). The two fixed-output hashes will change if the
  bundle bytes change; try `nix build` of the package
  (find how `pkgs/kb` is wired: `git grep -n 'pkgs/kb'`) and update hashes if
  the build reports a mismatch. If the sandbox cannot build here, say so and
  leave a `// GAP [[<gap-node-id>]]` beside the hash with a `#gap` node.
- Harness `workspace.ts`: `packageDirs()` walks `packages/<layer>/<pkg>`;
  `WorkspacePackage` gains `name` (from the manifest) and `layer` (from the
  path); `dir` becomes the path relative to `packages/` (`domain/model`).
  Every `@kb/${dir}` derivation uses `name` instead (t2's report lists them).
  `axisValues(tags, "layer")` callers read `pkg.layer`; `LAYER_ALLOWS` keys
  are unchanged. `project-graph.ts` (Nx tags) — layer no longer comes from Nx;
  scope still does, or read both from the manifest and drop the Nx dependency
  if nothing else needs the graph (measure, then decide; say which).
- `workspace-shape.test.ts`: every package sits directly under a known layer
  folder; no package declares a `layer:*` tag (that is now the red case);
  exactly one `scope:*` tag.

## 2. Delete the tags (second commit)

Remove `layer:*` from every `nx.tags`. `docs.materialize`; update the DESIGN
"Two axes" table: `layer` row says "the folder under `packages/`", `scope`
row unchanged. AGENTS.md "Workspace" bullet: "two tags" → "its layer folder
and one `scope:*` tag".

## Acceptance

- `bun install --frozen-lockfile` succeeds (workspace glob change must not
  alter the lock; if it does, explain). `bun run verify`, `bun test packages`,
  `bun run test:ui`, `bun run test:dst` (once) green.
- `bun run --filter @kb/ui build` succeeds; `bun tools/kb/bin/kb --help`
  runs; `bun tools/kb/packages/app/cli/src/bin/docs-check.ts` is clean.
- `nix flake check --no-build` green; `nix build` of the kb package attempted
  (result in the report).
- `git grep -n 'packages/\(model\|query\|canvas\|contracts\|ext-sdk\|store-jsonl\|operations\|ext-canvas\|ext-docs\|runtime\|server\|cli\|mcp\|ui\|test-kit\|render-tests\)/'`
  returns only historical wave docs under `docs/kb/waves/2026-09-03/` and
  `2026-08-*`.
- Red cases in the report: a package moved to `packages/misc/`; a package
  that still carries `layer:domain`.

## Report

`docs/kb/waves/2026-09-04/reports/t3-layer-folders.md`: the mapping applied,
every config file touched, the Nix outcome, what happened to the Nx
dependency in the harness, and anything that still names a layer twice.
