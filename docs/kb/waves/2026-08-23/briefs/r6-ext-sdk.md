# Brief r6 — Extension public type surface (how external extensions use our types)

Agent: opencode (second instance). Design research + small impl spec. NO
commits this wave.

## Mission

Owner question: extensions are authored as standalone files in
`.kb/extensions/*.ts` (loaded at runtime by the kb server). Bundled examples
live inside the package (`tools/kb/extensions-bundled/docs.ts`) and can import
internal types freely — but an EXTERNAL extension author has no resolvable
specifier for `ActionDefinition`, context types, store helpers, etc. How do
non-bundled extensions get real type-checking against our internal types,
ground-up clean?

## Read first

- `tools/kb/src/extensions.ts` + loader call sites (how `.kb/extensions/*.ts`
  is imported at runtime — Bun importer semantics, path resolution)
- `tools/kb/extensions-bundled/docs.ts` + `ActionDefinition` definition site(s)
- `tools/kb/package.json` (+ ui/package.json), tsconfig.json
- `tools/kb/DESIGN.md` extension sections, AGENTS.md kb section

## Questions to answer

1. Runtime resolution truth: when Bun imports `/abs/path/.kb/extensions/foo.ts`,
   what do relative imports resolve against? Do bare specifiers work? Does
   `import type ... from "<repo>/tools/kb/src/..."` survive today, and why is
   that wrong as a contract (repo-relative fragility, packaged/Nix layout)?
2. Options analysis (recommend ONE primary):
   a. package `exports` map on `kb` package (`"types"` / `"./ext-sdk"`)
      usable when kb is on npm/linkable;
   b. generated ambient `.d.ts` SDK written next to `.kb/` (e.g. `.kb/sdk.d.ts`)
      or into a stable location, so editors pick it up without any install;
   c. triple-slash reference / tsconfig paths doc for external authors;
   d. runtime contract validation only (structural typing, no imports) +
      documented shape docs.
   Consider: packaged Nix layout (no sources!), repo checkout layout, editor
   DX (completions), drift risk between shipped types and runtime, versioning.
3. Type-only vs value imports: confirm `import type` erases at runtime under
   the loader's transpile path (verify experimentally with bun) — if authors
   need VALUES (helpers), what is the sanctioned runtime surface?
4. Versioning/drift policy: how do we keep SDK types honest with core types
   (single source of truth, generation step?) — propose mechanism, e.g. build
   step emits `.d.ts` bundle derived from src types; test asserts freshness.
5. Authoring loop: exact steps for an external author today → after the fix
   (before/after walkthrough).

## Deliverable

`docs/kb/waves/2026-08-23/reports/r6-ext-sdk.md`: Resolution findings /
Option matrix / Chosen design with rationale / Impl spec (files, build step,
tests incl. freshness assertion, docs updates) / Author walkthrough before vs
after.

## Constraints

- `./intent/gate.sh session opencode` first.
- Experimental verification in /tmp only (scratch files fine); modify nothing
  tracked except your report; no commits.
