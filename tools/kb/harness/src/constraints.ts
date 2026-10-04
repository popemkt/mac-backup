/**
 * The two-axis constraint matrix (plan D11). One statement of the rule; the
 * `boundaries` check applies it to the import-derived package graph.
 *
 * The original deviations from the brief's table are recorded in
 * docs/kb/waves/2026-09-03/reports/w1-workspace.md:
 *
 * - `layer:extension` may reach `application`. The bundled extensions are
 *   policy modules registered from inside the package, not sandboxed third
 *   party code; the fences that matter (extension ↛ infrastructure,
 *   extension ↛ app) still hold. Third-party `.kb/extensions/*.ts` are fenced
 *   by @kb/ext-sdk's ambient d.ts, which is not a package edge at all.
 * - `layer:extension` may reach `extension`, but only inside one family:
 *   @kb/ext-canvas reads its own family's @kb/canvas document, and
 *   {@link familyEdgeViolation} refuses an edge between two families.
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
 * `kit/` holds the browser host libraries a plugin builds against
 * (`@kb/ui-sdk`, and the scene kit `@kb/scene` with `@kb/scene-gpu`):
 * neither a port adapter nor a use case, they
 * stand on the domain and the contracts, one kit may stand on another, and
 * only extensions and composition roots build on them.
 * - There is no `scope:extension` row: no package carries it, and a row
 *   nothing reads is worse than no row.
 */
export const LAYER_ALLOWS: Record<string, readonly string[]> = {
  domain: ["domain"],
  contract: ["domain", "contract"],
  infrastructure: ["domain", "contract"],
  application: ["domain", "contract"],
  kit: ["domain", "contract", "kit"],
  // Of its own family only: familyEdgeViolation.
  extension: ["domain", "contract", "application", "kit", "extension"],
  // From a composition root only: EXTENSION_ROOTS.
  app: ["domain", "contract", "infrastructure", "application", "kit", "extension", "app"],
  // The UI test kit's scene contract holds the scene kit's handle.
  "test-support": ["domain", "kit", "app"],
};

export const SCOPE_ALLOWS: Record<string, readonly string[]> = {
  shared: ["shared"],
  backend: ["shared", "backend"],
  // A family's UI half builds against the browser host kit (`@kb/ui-sdk`).
  browser: ["shared", "browser"],
  "test-support": ["shared", "backend"],
};

/**
 * Both axes of one package — where it sits, and the runtime it must survive —
 * and, for an extension package, the family it belongs to.
 */
export interface PackageAxes {
  layer: string;
  /** `undefined` when the package carries no `scope:` tag — a `workspace-shape` failure. */
  scope: string | undefined;
  /** The `family:` tag; `undefined` outside the extension layer, and a failure inside it. */
  family: string | undefined;
}

/**
 * One edge measured against one axis of the matrix, or `undefined` when the
 * matrix allows it. Both `boundaries` (over the real workspace) and the
 * import-graph fixtures (over a two-package tree built for one case) ask this,
 * so the direction rule is applied in one place rather than restated per
 * caller.
 *
 * An edge whose endpoints are not both known packages is not this function's
 * business — that a package has exactly one known layer and one known scope is
 * `workspace-shape`'s assertion.
 */
export function matrixViolation(
  axesOf: ReadonlyMap<string, PackageAxes>,
  source: string,
  target: string,
  axis: "layer" | "scope",
): string | undefined {
  const allows = axis === "layer" ? LAYER_ALLOWS : SCOPE_ALLOWS;
  const from = axesOf.get(source)?.[axis];
  const to = axesOf.get(target)?.[axis];
  if (from === undefined || to === undefined) return undefined;
  if ((allows[from] ?? []).includes(to)) return undefined;
  return `${source} (${axis}:${from}) -> ${target} (${axis}:${to})`;
}

/**
 * The extension families (DESIGN.md → Extension families). A family is the
 * packages that share one `family:<name>` tag. The tag is data and not a
 * duplicate of the folder: the layer says where a package sits, the family
 * says whose it is. Its name has one home, the family's `defineExtension`
 * declaration, and the `extension-families` check holds the tag equal to it.
 */
export const EXTENSION_LAYER = "extension";

/**
 * An edge between two extension packages, measured against the family axis,
 * or `undefined` when it stays inside one family (or is not between two
 * extension packages at all). A backend package reads its own family's
 * shared model; two families meet only through core's points.
 */
export function familyEdgeViolation(
  axesOf: ReadonlyMap<string, PackageAxes>,
  source: string,
  target: string,
): string | undefined {
  const from = axesOf.get(source);
  const to = axesOf.get(target);
  if (from?.layer !== EXTENSION_LAYER || to?.layer !== EXTENSION_LAYER) return undefined;
  if (from.family !== undefined && from.family === to.family) return undefined;
  return `${source} (family:${from.family ?? "none"}) -> ${target} (family:${to.family ?? "none"})`;
}

/** The two hosts that load extension entries: the server registry and the browser kernel. */
export type ExtensionHost = "server" | "browser";

/** One file that may import extension packages, and the hosts whose entries it loads. */
export interface ExtensionRoot {
  /** Package-relative path of the one file. */
  readonly file: string;
  /**
   * Whose entries it loads. `@kb/bundled` folds declarations into the seed
   * and loads nothing, so it pairs no host.
   */
  readonly hosts: readonly ExtensionHost[];
}

/**
 * The composition-root fence. An `app` package may import an extension
 * package from these files only — elsewhere, core would name a feature.
 * Keyed by package name, not directory, because the sanction is about the
 * package and survives it being moved. Test files are exempt, as they are
 * from {@link UI_ALLOWS}: a test reaches for whatever it drives. A root may
 * not re-export an extension package, or other files would reach the
 * feature through it.
 *
 * The same table is what pairing reads: every extension package must be
 * loaded — imported for its value, not only its types — by a root of each
 * host its scope runs in ({@link HOSTS_BY_SCOPE}), so a family nobody loads
 * is a dead seam that fails rather than one that reads as covered.
 */
export const EXTENSION_ROOTS: Readonly<Record<string, readonly ExtensionRoot[]>> = {
  "@kb/runtime": [{ file: "src/bundled.ts", hosts: ["server"] }],
  "@kb/cli": [{ file: "src/host-plugins.ts", hosts: ["server"] }],
  "@kb/ui": [{ file: "src/ui-plugins.ts", hosts: ["browser"] }],
  "@kb/bundled": [{ file: "src/index.ts", hosts: [] }],
};

/**
 * The hosts a package of each scope runs in as an entry. A `scope:shared`
 * package runs in neither on its own: a root of a host loads it as the entry
 * itself, or a loaded package of its own family loads it as a child, and
 * pairing asks for one of the two.
 */
export const HOSTS_BY_SCOPE: Readonly<Record<string, readonly ExtensionHost[]>> = {
  backend: ["server"],
  browser: ["browser"],
  shared: [],
};

/** Known imports of one extension package from outside every root: the exact files, each package-relative. */
export interface SanctionedExtensionImport {
  readonly target: string;
  readonly files: readonly string[];
}

/**
 * The fence's sanctioned breaches, each leaving with the step that moves its
 * importer out of core. Every file is named, so a new file that imports the
 * feature fails, and a named file that no longer imports it fails too: the
 * list is frozen and can only shrink, like a ratchet's baseline.
 *
 * - The docs and check pre-commit entries parse their family's output
 *   schema to print it: they leave when the family's report reaches them
 *   through the registry instead.
 */
// GAP [[01M41H30Y60D3G9WJJX6NFQD2T]]
export const EXTENSION_ROOT_BREACHES: Readonly<
  Record<string, readonly SanctionedExtensionImport[]>
> = {
  "@kb/cli": [
    { target: "@kb/ext-check", files: ["src/bin/check-audit.ts"] },
    { target: "@kb/ext-docs", files: ["src/bin/docs-check.ts", "src/bin/docs-materialize.ts"] },
  ],
};

/**
 * A family's browser half is one package, `@kb/<family>-ui` (DESIGN.md →
 * Extension families): `scope:browser`, named for the family its tag names,
 * and loaded by the browser root like every extension package. The suffix is
 * that name's one statement.
 */
export const BROWSER_HALF_SUFFIX = "-ui";

/**
 * Families whose browser half is still a surface of `@kb/ui` rather than its
 * `-ui` package, each with the gap that records it. A surface named for a
 * family and not listed here fails, and a listed one that no longer is a
 * surface fails too, so the list can only shrink.
 */
// Every family's browser half is its package now; the list stays the place a
// deferred one would be named.
export const CORE_BROWSER_HALVES: ReadonlySet<string> = new Set<string>();

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
 * What a test builds its world from, which a test file may import whatever
 * layer it sits in: `@kb/test-kit`, where the DST harness, the scenario
 * runners and the contract suites live; `@kb/bundled`, the seed kb ships
 * (`bundledSeed()`), from which a test makes a fresh store; and
 * `@kb/ui-test-kit`, a browser test's DOM and GPU stand-ins. As production
 * edges each would point the wrong way (domain → app, app → test-support),
 * so only test files and devDependencies may name them.
 */
const TEST_WORLD_PACKAGES: ReadonlySet<string> = new Set([
  "@kb/test-kit",
  "@kb/bundled",
  "@kb/ui-test-kit",
]);

/**
 * A test file, by its package-relative path: anything in the package's own
 * `tests/` or `tests-render/` folder, or a `*.test.ts(x)` anywhere. A
 * `tests/` folder deeper in `src/` is production code like the rest of
 * `src/`, so no file escapes a fence by where it is nested.
 */
export function isPackageTestFile(file: string): boolean {
  return /^(?:tests|tests-render)\//.test(file) || /\.test\.tsx?$/.test(file);
}

/** Test files may import a {@link TEST_WORLD_PACKAGES} package without inverting the production matrix. */
export function testMayImportTestWorld(file: string, target: string): boolean {
  return TEST_WORLD_PACKAGES.has(target) && isPackageTestFile(file);
}

/** Listing a {@link TEST_WORLD_PACKAGES} package as a devDependency is the test-file reachability edge. */
export function isTestWorldDevDependency(target: string): boolean {
  return TEST_WORLD_PACKAGES.has(target) || target.endsWith("/test-kit");
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
type UiSurface = "graph" | "layout" | "ontology" | "outline" | "palette" | "prefs" | "sidebar";

export const UI_SURFACES: readonly UiSurface[] = [
  "graph",
  "layout",
  "ontology",
  "outline",
  "palette",
  "prefs",
  "sidebar",
];

export type UiZone =
  | "shell"
  | "primitives"
  | "lib"
  | "api"
  | "actions"
  | "session"
  | "stores"
  | "fixtures"
  | "test-support"
  | "catalog"
  | "sandbox"
  | `components/${UiSurface}`;

/**
 * The shared primitives, by path: the components any surface may reach for.
 * `ARCHITECTURE.md` listed them by exported name, which no check can match to
 * a file; the list is a path prefix set so a colocated `*.test.tsx` or a
 * second file of the same component lands in the same zone as its subject.
 */
const UI_PRIMITIVES: readonly string[] = [
  "components/ui/",
  "components/outline/field-row",
  "components/outline/field-value",
  "components/outline/value-slot",
  "components/outline/value-views",
  "components/outline/field-picker",
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
 * - The table's "types" means the `lib/types` module, which is `lib`. The
 *   `src/types/` folder of ambient declarations it once shadowed is gone:
 *   `three` is typed by `@types/three` now, not by a hand-written stub.
 * - `catalog` is not exempt from the matrix, only permissive within it:
 *   stories read components, primitives, `lib` and `fixtures`, and the table's
 *   "must not: stores mutations" is enforced rather than assumed.
 * - `shell` may reach every zone below it, on the same reasoning as
 *   `layer:app` in {@link LAYER_ALLOWS}: a composition root wires the layers
 *   together and is imported by nothing.
 */
// GAP [[01M3F8EJSWHS38PMSSQ2BVN8DG]]
export const UI_ALLOWS: Record<UiZone, readonly UiZone[]> = {
  shell: [
    "shell",
    "primitives",
    "components/graph",
    "components/layout",
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
  ],
  lib: ["lib", "api", "actions", "session"],
  api: ["lib", "api", "actions", "session"],
  actions: ["lib", "api", "actions", "session"],
  session: ["lib", "api", "actions", "session"],
  stores: ["stores", "lib", "api", "session"],
  fixtures: ["fixtures", "lib"],
  // Test helpers: imported only by test files, which the surface rows exempt,
  // so no row names it. It reaches what it stands in for — the store
  // `resetOutlineStore` resets, and the `api/ws` port `FakeWsSocket` doubles.
  "test-support": ["test-support", "stores", "api"],
  primitives: ["primitives", "lib"],
  catalog: [
    "catalog",
    "fixtures",
    "lib",
    "primitives",
    "components/graph",
    "components/ontology",
    "components/outline",
    "components/palette",
    "components/prefs",
    "components/sidebar",
  ],
  "components/graph": ["components/graph", "primitives", "stores", "actions", "lib"],
  "components/ontology": ["components/ontology", "primitives", "stores", "actions", "lib"],
  // Panes and layouts: a pane draws whatever page its path resolves to, by
  // route and view key, so it imports no other surface.
  "components/layout": ["components/layout", "primitives", "stores", "actions", "lib"],
  // The sandbox frame's own script, a separate build that runs in the frame:
  // it reaches nothing of the page, and nothing of the page reaches it.
  sandbox: ["sandbox"],
  "components/outline": ["components/outline", "primitives", "stores", "actions", "lib"],
  "components/palette": ["components/palette", "primitives", "stores", "actions", "lib"],
  "components/prefs": ["components/prefs", "primitives", "stores", "actions", "lib"],
  "components/sidebar": ["components/sidebar", "primitives", "stores", "actions", "lib"],
};

/**
 * The one bare-specifier rule inside the UI: `@kb/ui-sdk`'s query module is
 * the page's single `@kb/query` seam, so no zone of `@kb/ui` may import
 * `@kb/query` itself — a second DataScript entry point is a boundary breach
 * rather than a package edge. Every other `@kb/*` and third-party specifier
 * belongs to the package matrix above, not to this one.
 */
export const UI_SPECIFIER_ALLOWS: Record<string, readonly UiZone[]> = {
  "@kb/query": [],
};

/**
 * The UI's entry module: what the page loads before anything else, so the
 * eager-import closure from here is the always-loaded bundle.
 */
export const UI_ENTRY = "main.tsx";

/**
 * The lazy-chunk fence: specifiers the page loads only inside a chunk of
 * their own. three is the whole real-time 3D stack (`@kb/scene-gpu` is three
 * by another name, and is caught through the three it imports, since the walk
 * follows the page into every browser package), and only a view that draws 3D — a lab study's scene, the 3D graph
 * — may load it. `@kb/chart-vega` is the whole chart stack (Vega, Vega-Lite
 * and the expression interpreter, which only it imports), and only a chart's
 * drawing may load it.
 *
 * Its own chunk means {@link UI_LAZY_DEPTH} dynamic `import()`s on every path
 * from the entry: the entry chunk loads on every visit, and a surface's
 * route chunk on every visit to that surface, so three sits behind one more
 * lazy boundary inside the surface — the 3D host, a study's `load()`. A
 * static three import in the graph page is as much a breach as one in the
 * entry.
 *
 * One rule over the import graph, so no surface lists which of its files may
 * import three. `ui-lazy-fence.test.ts` applies it.
 */
export const UI_LAZY_ONLY = /^(?:three|@kb\/chart-vega|vega(?:-lite|-interpreter)?)(?:\/|$)/;

/** Dynamic imports every path from {@link UI_ENTRY} to a {@link UI_LAZY_ONLY} import crosses. */
export const UI_LAZY_DEPTH = 2;

/**
 * Test files answer to {@link UI_SPECIFIER_ALLOWS} but not to
 * {@link UI_ALLOWS}: a test reaches for whatever it drives, and holding a
 * colocated `*.test.tsx` to its subject's row would fence the tests instead of
 * the product.
 */
export function isUiTestFile(file: string): boolean {
  return /\.test\.tsx?$/.test(file);
}
