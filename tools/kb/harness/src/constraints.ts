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

/**
 * The UI's intra-package import matrix (wave u1 / plan D5).
 *
 * `packages/app/ui` is one package, so the workspace matrix above sees none of
 * its internal edges — `ARCHITECTURE.md` carried them as a markdown table that
 * nothing read. This is that table, moved to where a check can apply it; the
 * doc now links here instead of restating it.
 *
 * A **zone** is a file's position under `src/`, and {@link uiZoneOf} is the one
 * function that knows the mapping. Zones are the folders that exist: the
 * `ui-boundaries` check fails on a row for a folder that is gone and on a
 * folder with no row, so this table cannot quietly outlive the tree.
 */
export const UI_SRC = "packages/app/ui/src";

/** A surface folder under `components/`: one page family and its chrome. */
type UiSurface = "canvas" | "graph" | "ontology" | "outline" | "palette" | "prefs" | "sidebar";

const UI_SURFACES: readonly UiSurface[] = [
  "canvas",
  "graph",
  "ontology",
  "outline",
  "palette",
  "prefs",
  "sidebar",
];

export type UiZone =
  | "shell"
  | "primitives"
  | "ds"
  | "lib"
  | "api"
  | "actions"
  | "session"
  | "stores"
  | "fixtures"
  | "types"
  | "test-support"
  | "catalog"
  | `components/${UiSurface}`;

/**
 * The shared primitives, by path: the components any surface may reach for.
 * `ARCHITECTURE.md` listed them by exported name, which no check can match to
 * a file; the list is a path prefix set so a colocated `*.test.tsx` or a
 * second file of the same component lands in the same zone as its subject.
 */
const UI_PRIMITIVES: readonly string[] = [
  "components/view-error-boundary",
  "components/ref-autocomplete",
  "components/ui/",
  "components/outline/tag-chip",
  "components/outline/bullet",
  "components/outline/node-row",
  "components/outline/field-row",
  "components/outline/field-value",
];

/**
 * A file's zone, from its path relative to {@link UI_SRC}.
 *
 * `main.tsx` and `components/App.tsx` are the composition root, so they are
 * `shell` — as is anything else sitting directly under `src/`, which is where
 * boot-time files live. Everything else is its first path segment, except
 * under `components/`, where a surface folder is its own zone and the named
 * primitives are lifted out of theirs.
 */
export function uiZoneOf(file: string): UiZone {
  if (!file.includes("/") || file === "components/App.tsx") return "shell";
  if (UI_PRIMITIVES.some((prefix) => file.startsWith(prefix))) return "primitives";
  const [head, next] = file.split("/");
  if (head === "components") {
    const surface = UI_SURFACES.find((candidate) => candidate === next);
    if (surface === undefined) {
      throw new Error(`${file}: no zone — a components/ file is a surface folder or a primitive`);
    }
    return `components/${surface}`;
  }
  return head as UiZone;
}

/**
 * Who may import whom inside the UI. Read as `UI_ALLOWS[zoneOf(importer)]`
 * must contain `zoneOf(imported)`; a zone always contains itself, spelled out
 * rather than implied, because "own surface" is a row of the original table.
 *
 * Deviations from that table, each recorded in
 * docs/kb/waves/2026-09-07/reports/u1.md:
 *
 * - A surface may import `actions`. The table's "may import" column omitted
 *   it while its "must not" column named only sibling-surface internals, and
 *   all seven surfaces call `actions/mutations` — that is the command layer
 *   the UI is built on, not drift. A gap must name what would close it, and
 *   nothing would close these.
 * - `session` has no row in the table because the zone did not exist when the
 *   table was written (wave w5 added it). It is a runtime seam like `api`, so
 *   it takes the same row and the same family membership.
 * - The table's "types" means the `lib/types` module, not `src/types/`, which
 *   holds ambient declarations only: that folder imports nothing and nothing
 *   imports it, so its row is itself alone.
 * - `catalog` is not exempt from the matrix, only permissive within it:
 *   stories read components, primitives, `lib` and `fixtures`, and the table's
 *   "must not: stores mutations" is enforced rather than assumed.
 * - `shell` may reach every zone below it, on the same reasoning as
 *   `layer:app` in {@link LAYER_ALLOWS}: a composition root wires the layers
 *   together and is imported by nothing.
 */
export const UI_ALLOWS: Record<UiZone, readonly UiZone[]> = {
  shell: [
    "shell",
    "primitives",
    "components/canvas",
    "components/graph",
    "components/ontology",
    "components/outline",
    "components/palette",
    "components/prefs",
    "components/sidebar",
    "stores",
    "actions",
    "session",
    "api",
    "lib",
    "ds",
  ],
  ds: ["ds"],
  lib: ["lib", "api", "actions", "session", "ds"],
  api: ["lib", "api", "actions", "session", "ds"],
  actions: ["lib", "api", "actions", "session", "ds"],
  session: ["lib", "api", "actions", "session", "ds"],
  stores: ["stores", "lib", "api", "session", "ds"],
  fixtures: ["fixtures", "lib"],
  types: ["types"],
  // Test helpers (`resetOutlineStore`): imported only by test files, which the
  // surface rows exempt, so no row names it; it reaches the store it resets.
  "test-support": ["test-support", "stores"],
  primitives: ["primitives", "lib"],
  catalog: [
    "catalog",
    "fixtures",
    "lib",
    "primitives",
    "components/canvas",
    "components/graph",
    "components/ontology",
    "components/outline",
    "components/palette",
    "components/prefs",
    "components/sidebar",
  ],
  "components/canvas": ["components/canvas", "primitives", "stores", "actions", "lib"],
  "components/graph": ["components/graph", "primitives", "stores", "actions", "lib"],
  "components/ontology": ["components/ontology", "primitives", "stores", "actions", "lib"],
  "components/outline": ["components/outline", "primitives", "stores", "actions", "lib"],
  "components/palette": ["components/palette", "primitives", "stores", "actions", "lib"],
  "components/prefs": ["components/prefs", "primitives", "stores", "actions", "lib"],
  "components/sidebar": ["components/sidebar", "primitives", "stores", "actions", "lib"],
};

/**
 * The one bare-specifier rule inside the UI: `ds/` is the single `@kb/query`
 * seam, so a second DataScript entry point is a boundary breach rather than a
 * package edge. Every other `@kb/*` and third-party specifier belongs to the
 * package matrix above, not to this one.
 */
export const UI_SPECIFIER_ALLOWS: Record<string, readonly UiZone[]> = {
  "@kb/query": ["ds"],
};

/**
 * Test files answer to {@link UI_SPECIFIER_ALLOWS} but not to
 * {@link UI_ALLOWS}: a test reaches for whatever it drives, and holding a
 * colocated `*.test.tsx` to its subject's row would fence the tests instead of
 * the product.
 */
export function isUiTestFile(file: string): boolean {
  return /\.test\.tsx?$/.test(file);
}
