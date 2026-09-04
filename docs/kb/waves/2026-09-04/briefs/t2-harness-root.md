# t2-harness-root — the harness is root tooling, not a workspace package

Wave `t2` of `docs/kb/waves/2026-09-04/plan.md`. Harness: claude. Branch from
`main`. Runs in parallel with `t1` (omp), which owns
`packages/harness/src/constraints.ts` **only for deleting
`OFF_CATALOG_BY_DECISION`** and `tests/version-authored-once.test.ts` **only for
the lines that read it**, plus the two package.json files and `bun.lock`.
Expect a trivial merge on those two files; do not otherwise edit them.

Read first: `AGENTS.md` Rule 1 and "Module Boundaries"; `tools/kb/DESIGN.md`
§§ "Two axes" (tag table + isomorphism fence), "Runtime/tooling boundary",
"Ratchet scope", the Effect severity lanes paragraphs (~L110-140, ~L185-215);
`tools/kb/packages/harness/src/*.ts` and every test in `tests/`;
`docs/kb/waves/2026-09-03/reports/recon-refrepo.md` § "39 source files …
reached by no lint target" (why a dot-dir is the wrong home).
Run `intent/gate.sh session claude-code` first.

## 0. Why (owner question, coordinator decision)

The harness checks the workspace's shape; it is not part of the product. Today
it is `@kb/harness` under `packages/`, and the matrix carries a `tooling` row
on both axes that exists only so the checker can be a member: `LAYER_ALLOWS.tooling`,
`SCOPE_ALLOWS.tooling`, `RUNTIME_PRESET_BY_SCOPE.tooling`,
`toolingPackageDirs()` in `snapshot.ts`, the `exclude` in the
`tsconfig.bun.json` Effect override, `srcGlobsForScope("tooling")`, the
`ratchet-scope` test's tooling case, `tsconfig-contract`'s
"effect-severity-lanes" exclude assertion, and `boundaries.test.ts` reaching
into `../../model/src/present.ts`. A row that exists for the checker is a
special case (Rule 1). Move the checker out; every one of those falls away.

## 1. Move

- `tools/kb/packages/harness/` → `tools/kb/harness/` (`git mv`; keep `src/`,
  `tests/`, `lint-warn-baseline.json`). Delete its `package.json` — it is not a
  workspace member. Its `tsconfig.json` stays, `extends: "../tsconfig.bun.json"`,
  `include: ["src", "tests"]`.
- Typing: the root `devDependencies` already carry `@types/bun`; nothing to add.
- Typecheck: `nx run-many -t typecheck` must still cover it. Add a root
  `tools/kb/project.json` (name `kb-workspace` or similar) with a `typecheck`
  target `tsc --noEmit -p harness/tsconfig.json` and `default` inputs; verify
  `typecheck-scope` still proves every TS file under `tools/kb` is in exactly
  one project (`harness/**` must be assigned once).
- Scripts in `tools/kb/package.json`: `lint` → `oxlint … packages harness`;
  `fmt`/`fmt:check` → `vp fmt packages harness [--check]`; `harness` →
  `bun test harness`; `harness:snapshot` → `bun harness/src/snapshot.ts`.
  `lint-scope-coverage` parses the `lint` positional scopes, so `harness` is a
  scope by construction — confirm the test passes without edits to its parser.
- `.oxlintrc.json` test-file override: `packages/harness/**` → `harness/**`.
- `knip.json`: the `packages/harness` workspace block becomes root entries
  (`"." : { "entry": ["harness/tests/*.test.ts", "harness/src/snapshot.ts"] }`
  — check knip 6's root-workspace form).
- `tsconfig.bun.json` Effect plugin override: delete the `exclude` — the
  harness is no longer under `packages/*/src/**`. Its own `src/` is then not in
  the promoted lane at all, which is the intent (a repo-shape check is not kb).
- `nx.json` `sharedGlobals`: add `{workspaceRoot}/harness/**` only if the
  root project's inputs do not already cover it.
- Nix: `pkgs/kb/default.nix` filters `tools/kb` by basename only; nothing to do,
  but say so in the report.

## 2. Delete the `tooling` row and its special cases

- `constraints.ts`: remove `tooling` from `LAYER_ALLOWS`, `SCOPE_ALLOWS`,
  `RUNTIME_PRESET_BY_SCOPE`; rewrite the docblock bullet about it.
- `snapshot.ts`: remove `toolingPackageDirs()` and the `toolingDirs`
  parameters; `countsTowardRatchet` keeps only the `src/` rule. Update the
  docblock. `ratchet-scope.test.ts`: delete the tooling case.
- `workspace.ts`: remove `srcGlobsForScope` if nothing reads it after the
  tsconfig exclude is gone; `tsconfig-contract.test.ts`'s exclude assertion
  becomes "the Effect override has no `exclude`" or is deleted — whichever the
  contract now needs. Keep the harness's own `src/` out of the Effect lane by
  the file scope alone (`packages/*/src/**`), and say that in DESIGN.md.
- `boundaries.test.ts`: the harness must not import product code. Replace
  `present(...)` from `../../model/src/present.ts` with a local two-line helper
  in `harness/src/` (or `?? throw`). Add a harness test that no file under
  `harness/` imports `@kb/*` or `../packages/` — the checker stays outside.
- `DESIGN.md`: tag table rows lose `tooling`; the sentences about
  `scope:tooling` in the Effect-lane and Ratchet-scope sections become "the
  harness lives outside `packages/`, so the `src/` file scope alone excludes
  it"; "Runtime/tooling boundary" script list follows the new script text.
  `AGENTS.md` L225-233 path `tools/kb/packages/harness` → `tools/kb/harness`.
- kb `#rule` nodes whose `gate` names `packages/harness` (query them:
  `bun tools/kb/packages/cli/src/main.ts search "harness" --json`) — update
  the `gate` text via `set`/`unset`; materialize docs.

## 3. Exact import extraction

`import-graph.ts` scans with a regex that requires `from`, `import(` or
`require(`; a side-effect `import "@kb/x"` is invisible, and `export * from`
only works by accident of the word `from`. Replace the regex with a parser:

- First choice: `import ts from "typescript"` and `ts.preProcessFile(source,
  true, true).importedFiles` — it returns every static/dynamic import and
  `export … from` specifier, side-effect imports included, plus triple-slash
  refs (ignore those). Confirm the installed `typescript` (`~7.0.2`, catalog)
  exposes the JS API in this workspace; if TS 7 no longer ships it, use
  `oxc-parser` (`parseSync(file, source).module.staticImports/dynamicImports`),
  added to the catalog and root devDependencies.
- Keep `importSites()` / `importEdges()` signatures. Drop `stripComments` (the
  parser does not read comments). Add a red-case test in `boundaries.test.ts`
  or a new `import-graph.test.ts`: a fixture string with a side-effect import
  and an `export { x } from "@kb/y"` yields both sites.
- Do **not** adopt dependency-cruiser or `@nx/enforce-module-boundaries`:
  both take path-pattern rules, which would regenerate the tag-matrix mirror
  removed in `4b63dff`. Record that rejection in DESIGN.md next to the fence
  paragraph, one sentence.

## Acceptance

- `bun run verify` green (typecheck via Nx now includes the root project;
  lint scopes `packages harness`; knip clean of new findings; harness tests
  green from `bun test harness`). `bun test packages` green. `bun run
  harness:snapshot` produces no ledger change (or explain the change).
- `git grep -n tooling tools/kb/harness tools/kb/DESIGN.md tools/kb/tsconfig.bun.json`
  returns nothing but the "Runtime/tooling boundary" heading.
- `git grep -n 'packages/harness'` across the repo returns only historical
  wave docs under `docs/kb/waves/2026-09-03/`.
- Red cases demonstrated in the report: side-effect import to a forbidden
  package; a harness file importing `@kb/model`.
- Commits: (1) `refactor(kb): move the harness to tools/kb/harness as root
  tooling` (move + scripts + configs, behaviour-preserving, tests pass);
  (2) `refactor(kb): delete the tooling matrix row and its special cases`;
  (3) `feat(kb): parse imports instead of regex-scanning them`.

## Report

`docs/kb/waves/2026-09-04/reports/t2-harness-root.md`: what moved, every
special case deleted (file:line before), which parser was chosen and why, the
red-case outputs, and any path the next wave (`t3`, layer folders) must know
about in the workspace reader (`packageDirs`, `WorkspacePackage.dir`,
`@kb/${dir}` derivations — list every site so t3 can replace them with the
manifest name).
