/**
 * The two-axis constraint matrix (plan D11). One statement of the rule; the
 * `boundaries` check applies it to the import-derived package graph.
 *
 * Deviations from the brief's table, each recorded in
 * docs/kb/waves/2026-09-03/reports/w1-workspace.md:
 *
 * - `layer:extension` may reach `application`. The bundled extensions are
 *   policy modules registered from inside the package, not sandboxed third
 *   party code; the fences that matter (extension ↛ infrastructure,
 *   extension ↛ app) still hold. Third-party `.kb/extensions/*.ts` are fenced
 *   by @kb/ext-sdk's ambient d.ts, which is not a package edge at all.
 * - `test-support` may reach `app`. @kb/render-tests drives the server
 *   through its public surface; it still may not reach infrastructure. The DST
 *   harness (`@kb/test-kit`) builds the runtime Layer itself, so it sits under
 *   `app/` as a composition root, whatever its audience, rather than widening
 *   this row to everything.
 * - There is no `tooling` row on either axis. The harness is the only thing
 *   that would have carried one, and it lives outside `packages/` as root
 *   tooling; the matrix describes workspace members.
 *
 * The keys of `LAYER_ALLOWS` are also the layer folder names under
 * `packages/`: a package's layer is where it sits, so this table is the one
 * place the set of layers is written down.
 * `application/` owns infrastructure-free use cases; `app/` owns composition
 * roots and delivery surfaces that wire the lower layers together.
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
};

export const SCOPE_ALLOWS: Record<string, readonly string[]> = {
  shared: ["shared"],
  backend: ["shared", "backend"],
  browser: ["shared", "browser"],
  "test-support": ["shared", "backend", "test-support"],
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

/**
 * `tsconfig.base.json` is the strictness contract and nothing else. Three
 * runtime presets reach it, and a package picks one — by the `scope` tag it
 * already carries, not by a name restated per package.
 *
 * `scope:shared` compiles against {@link ISO_PRESET}: no `types`, so Bun's
 * globals are not there and `Buffer` or `process` in a shared package is a
 * compile error rather than a hole the import fence cannot see.
 * `scope:browser` compiles against a DOM; everything else against Bun.
 */
export const RUNTIME_PRESET_BY_SCOPE: Record<string, string> = {
  shared: "tsconfig.iso.json",
  backend: "tsconfig.bun.json",
  browser: "tsconfig.browser.json",
  "test-support": "tsconfig.bun.json",
};

/**
 * The preset that authors the Effect language-service block. `tsconfig.bun.json`
 * extends it, so both lanes get the same diagnostics from one copy — and the
 * ratchet, the severity-lane check and the plugin reader all name it here
 * rather than each spelling out a filename.
 */
export const ISO_PRESET = "tsconfig.iso.json";

/**
 * A package's second `tsc -p` project, present only when a package needs one:
 * `bun test` is Bun whatever the code under test targets, so a `scope:shared`
 * package compiles `src/` against the isomorphic preset and `tests/` against
 * {@link TEST_PRESET}. Every other scope already compiles against Bun and
 * needs no second project.
 *
 * It sits inside `tests/` rather than beside the first config, because the
 * type-aware linter resolves a file's options by walking up to the nearest
 * `tsconfig.json` — a sibling `tsconfig.tests.json` is invisible to that walk,
 * and those files would be linted with no strictness contract at all.
 */
export const TESTS_TSCONFIG = "tests/tsconfig.json";
export const TEST_PRESET = "tsconfig.bun.json";

/**
 * The only compiler options a package tsconfig may declare on top of its
 * preset, keyed by package name, each with the reason it cannot be inherited.
 * Anything absent from this table is a redeclaration: fix the preset, not the
 * package. Keyed by name, not directory, because the sanction is about the
 * package and survives it being moved.
 */
export const SANCTIONED_TSCONFIG_DELTAS: Record<string, Record<string, string>> = {
  "@kb/render-tests": {
    lib: "Playwright `page.evaluate` bodies typecheck against the browser realm, so this one Bun package also needs the DOM lib. Widening the Bun preset would let backend code reference `document`.",
  },
  "@kb/ui": {
    paths:
      "`@/*` is ui's own intra-package source alias, not a workspace alias map; `@kb/*` still resolve as real packages.",
  },
};
