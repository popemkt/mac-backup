/**
 * The two-axis constraint matrix (plan D11). One statement of the rule; the
 * `boundaries` check applies it to the Nx project graph.
 *
 * Deviations from the brief's table, each recorded in
 * docs/kb/waves/2026-09-03/reports/w1-workspace.md:
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

/**
 * The isomorphism fence. A `scope:shared` package runs in the browser too, so
 * it may not import a runtime-only module; platform access belongs to an
 * infrastructure or app package. It sits beside the matrix because it is the
 * one boundary the package graph cannot see — the target is not a package.
 */
export const RUNTIME_ONLY_SPECIFIERS = /^(bun:|node:|@effect\/platform-bun)/;

export function isIsomorphicScope(scope: string): boolean {
  return scope === "shared";
}

/**
 * Test files may import `@kb/test-kit` without inverting the production
 * matrix. The DST harness and scenario runners live there; a domain package
 * depending on test-kit as a production edge would be domain → app.
 */
export function isPackageTestFile(file: string): boolean {
  return (
    /(^|\/)tests\//.test(file) || /(^|\/)tests-render\//.test(file) || /\.test\.tsx?$/.test(file)
  );
}

export function testMayImportTestKit(file: string, target: string): boolean {
  return target === "@kb/test-kit" && isPackageTestFile(file);
}

/** Listing `@kb/test-kit` as a devDependency is the test-file reachability edge. */
export function isTestKitDevDependency(target: string): boolean {
  return target === "@kb/test-kit" || target.endsWith("/test-kit");
}

/** Off-catalog dependency specifiers admitted by an explicit decision. */
export const OFF_CATALOG_BY_DECISION: Record<string, string> = {
  // `vite-plus` and its `vite` alias twin must stay byte-identical, and an
  // alias specifier (`npm:<pkg>@<version>`) cannot reference a catalog entry.
  // Keeping both literal and adjacent is the only way to state the pair once.
  "vite-plus": "0.2.8",
  vite: "npm:@voidzero-dev/vite-plus-core@0.2.8",
};

/**
 * `tsconfig.base.json` is the strictness contract and nothing else. Two runtime
 * presets extend it, and a package picks one — by the `scope` tag it already
 * carries, not by a name restated per package. `scope:browser` compiles against
 * a DOM; every other scope compiles against Bun.
 */
export const RUNTIME_PRESET_BY_SCOPE: Record<string, string> = {
  shared: "tsconfig.bun.json",
  backend: "tsconfig.bun.json",
  browser: "tsconfig.browser.json",
  "test-support": "tsconfig.bun.json",
  tooling: "tsconfig.bun.json",
};

/**
 * The only compiler options a package tsconfig may declare on top of its
 * preset, per package, each with the reason it cannot be inherited. Anything
 * absent from this table is a redeclaration: fix the preset, not the package.
 */
export const SANCTIONED_TSCONFIG_DELTAS: Record<string, Record<string, string>> = {
  "render-tests": {
    lib: "Playwright `page.evaluate` bodies typecheck against the browser realm, so this one Bun package also needs the DOM lib. Widening the Bun preset would let backend code reference `document`.",
  },
  ui: {
    paths:
      "`@/*` is ui's own intra-package source alias, not a workspace alias map; `@kb/*` still resolve as real packages.",
  },
};
