/**
 * The two-axis constraint matrix (plan D11). One statement of the rule; the
 * `boundaries` check applies it to the Nx project graph.
 *
 * Deviations from the brief's table, each recorded in
 * docs/kb-waves/2026-09-03/reports/w1-workspace.md:
 *
 * - `layer:extension` may reach `application`. The bundled extensions are
 *   policy modules registered from inside the package, not sandboxed third
 *   party code; the fences that matter (extension ↛ infrastructure,
 *   extension ↛ app) still hold. Third-party `.kb/extensions/*.ts` are fenced
 *   by @kb/ext-sdk's ambient d.ts, which is not a package edge at all.
 * - `layer:test-support` may reach `app`. @kb/render-tests drives the server
 *   through its public surface; it still may not reach infrastructure. The DST
 *   harness (@kb/test-kit) builds the runtime Layer itself, so it is tagged
 *   `layer:app` — a composition root, whatever its audience — rather than
 *   widening this row to everything.
 * - `layer:tooling` / `scope:tooling` are the harness's own row: no workspace
 *   dependencies at all.
 * - There is no `scope:extension` row: no package carries it, and a row
 *   nothing reads is worse than no row.
 */
export const LAYER_ALLOWS: Record<string, readonly string[]> = {
  domain: ["domain"],
  contract: ["domain", "contract"],
  infrastructure: ["domain", "contract"],
  application: ["domain", "contract", "application"],
  extension: ["domain", "contract", "application"],
  app: ["domain", "contract", "infrastructure", "application", "extension", "app"],
  "test-support": ["domain", "contract", "application", "extension", "app", "test-support"],
  tooling: [],
};

export const SCOPE_ALLOWS: Record<string, readonly string[]> = {
  shared: ["shared"],
  backend: ["shared", "backend"],
  browser: ["shared", "browser"],
  "test-support": ["shared", "backend", "test-support"],
  tooling: [],
};

export const LAYERS = Object.keys(LAYER_ALLOWS);
export const SCOPES = Object.keys(SCOPE_ALLOWS);

/** Off-catalog dependency specifiers admitted by an explicit decision. */
export const OFF_CATALOG_BY_DECISION: Record<string, string> = {
  // `vite-plus` and its `vite` alias twin must stay byte-identical, and an
  // alias specifier (`npm:<pkg>@<version>`) cannot reference a catalog entry.
  // Keeping both literal and adjacent is the only way to state the pair once.
  "vite-plus": "0.2.8",
  vite: "npm:@voidzero-dev/vite-plus-core@0.2.8",
};
