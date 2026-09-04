# Wave 2026-09-04 — workspace shape: catalog exception, harness as root tooling, layer folders

Owner asks, verbatim essentials (2026-09-04):

> 1. `OFF_CATALOG_BY_DECISION` "feels like it can be gone?"
> 2. "harness is a package inside packages hmm, can it be a package outside?
>    like .harness (same level as .kb) … did we at some point parse all edges
>    of imports in the project? could we use some 3rd party package …?"
> 3. "can we move packages to some logical parent folder, for easy skim"
> "please delegate to other agents like omp for these once you figured out
> what to do."

Base: `main` @ `1f150e8` (oxlint trimmed, harness owns every boundary).

## Decisions (coordinator, from measured facts)

| # | Fact measured | Decision |
|---|---|---|
| 1 | Bun catalogs accept `npm:<pkg>@<ver>` alias specs (probed: scratch workspace, `bun install --lockfile-only` resolved `vite: npm:@voidzero-dev/vite-plus-core@0.2.8` from `catalog:`). The refrepo has no equivalent exception table. | `vite` and `vite-plus` move into the catalog; every consumer says `catalog:`; `OFF_CATALOG_BY_DECISION` and its two `if`s are deleted. The one real invariant — the alias pins the same version as `vite-plus` — becomes a harness assertion. |
| 2 | Harness is `@kb/harness`, a workspace package tagged `layer:tooling`/`scope:tooling`. That row exists only for it: `LAYER_ALLOWS.tooling`, `SCOPE_ALLOWS.tooling`, `RUNTIME_PRESET_BY_SCOPE.tooling`, `toolingPackageDirs()` in the ratchet collector, the tsconfig Effect-override `exclude`, `ratchet-scope` and `tsconfig-contract` tests about it. The refrepo keeps `.harness/` at the root as plain `node --test` files — and its recon (§ "39 source files … reached by no lint target") shows a dot-dir is exactly how tooling code escapes every gate. Import edges come from a regex scanner (`import-graph.ts`) that misses side-effect imports (`import "@kb/x"`). | `packages/harness` → `tools/kb/harness/` (visible, not dotted), **not** a workspace package: root tooling typed by the root `@types/bun`, typechecked by a root Nx project, in the lint/fmt scopes by name. Every `tooling` row and special case is deleted. Import extraction moves from regex to a real parser (`ts.preProcessFile` if the installed `typescript` exposes it, else `oxc-parser`). A repo-wide `.harness` beside `.kb` is rejected: the checks are about the kb workspace and need its toolchain. dependency-cruiser / `@nx/enforce-module-boundaries` rejected: both take path-pattern rules, which would mean generating a mirror of the tag matrix — the thing `4b63dff` just removed. |
| 3 | 17 packages flat under `packages/`, each carrying `layer:*` and `scope:*` in `nx.tags`. A folder per layer would be a second statement of the layer. | `packages/<layer>/<pkg>`, and the folder **is** the layer: `layer:*` tags are deleted, the harness derives layer from the path; `scope:*` stays a tag (runtime target, orthogonal). Runs **after** t2 lands, because both rewrite the workspace reader. Owner may veto before t3 starts. |

Layer folders (t3): `domain/{model,query,canvas}` `contract/{contracts,ext-sdk}`
`infrastructure/{store-jsonl}` `application/{operations}`
`extension/{ext-canvas,ext-docs}` `app/{runtime,server,cli,mcp,ui,test-kit}`
`test-support/{render-tests}`.

## Waves

| id | brief | harness | depends on | status |
|---|---|---|---|---|
| t1 | `briefs/t1-catalog-alias.md` | omp | — | |
| t2 | `briefs/t2-harness-root.md` | claude | — | |
| t3 | `briefs/t3-layer-folders.md` | claude | t2 merged | queued |
| t4 | `briefs/t4-favicon.md` | omp | — | |

Standing rules for every worker: `intent/gate.sh session <harness>` first;
`.kb/nodes.jsonl` only through `bun tools/kb/packages/cli/src/main.ts …`
(never the `kb` shim on PATH); never hand-edit
`lint-warn-baseline.json` (`bun run harness:snapshot`); regenerate docs with
`action-invoke '{"id":"docs.materialize","input":{}}'`; no push; commit in
`<type>: <description>` style; report to `reports/<id>.md`.
