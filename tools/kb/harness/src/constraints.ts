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
 * - `layer:extension` may reach `extension` for @kb/ext-canvas's shared
 *   @kb/canvas document. GAP [[01M3F923QWH9HSAW61VNFWHANV]] records the
 *   missing distinction between a plugin's own model and another's.
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
  application: ["domain", "contract"],
  // GAP [[01M3F923QWH9HSAW61VNFWHANV]]
  extension: ["domain", "contract", "application", "extension"],
  // Any app file may import an extension: GAP [[01M41H30Y60D3G9WJJX6NFQD2T]]
  app: ["domain", "contract", "infrastructure", "application", "extension", "app"],
  "test-support": ["domain", "app"],
};

export const SCOPE_ALLOWS: Record<string, readonly string[]> = {
  shared: ["shared"],
  backend: ["shared", "backend"],
  browser: ["shared"],
  "test-support": ["shared", "backend"],
};

/** Both axes of one package: where it sits, and the runtime it must survive. */
export interface PackageAxes {
  layer: string;
  /** `undefined` when the package carries no `scope:` tag — a `workspace-shape` failure. */
  scope: string | undefined;
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
type UiSurface =
  | "agent"
  | "canvas"
  | "chart"
  | "code"
  | "graph"
  | "lab"
  | "layout"
  | "ontology"
  | "outline"
  | "palette"
  | "prefs"
  | "sidebar";

const UI_SURFACES: readonly UiSurface[] = [
  "agent",
  "canvas",
  "chart",
  "code",
  "graph",
  "lab",
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
  | "ds"
  | "lib"
  | "api"
  | "actions"
  | "session"
  | "stores"
  | "fixtures"
  | "scene"
  | "sdk"
  | "test-support"
  | "catalog"
  | "sandbox"
  | "components/canvas/3d"
  | `components/${UiSurface}`;

/**
 * The shared primitives, by path: the components any surface may reach for.
 * `ARCHITECTURE.md` listed them by exported name, which no check can match to
 * a file; the list is a path prefix set so a colocated `*.test.tsx` or a
 * second file of the same component lands in the same zone as its subject.
 */
const UI_PRIMITIVES: readonly string[] = [
  "components/view-error-boundary",
  "components/ui/",
  "components/outline/tag-chip",
  "components/outline/bullet",
  "components/outline/node-row",
  "components/outline/field-row",
  "components/outline/field-value",
  "components/outline/value-slot",
  "components/outline/value-views",
  "components/outline/field-picker",
];

/**
 * The canvas's 3D projection: the scene, its layers and the stage that hosts
 * it, lifted out of the canvas folder's zone so that only these files may
 * reach the scene kit. The 2D canvas cannot import three by accident.
 */
const UI_CANVAS_3D =
  /^components\/canvas\/canvas-(?:scene(?:-items|-edges|-solids)?\.ts|3d-stage\.tsx)$/;

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
  if (UI_CANVAS_3D.test(file)) return "components/canvas/3d";
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
 * The row of a zone that leaves `@kb/ui` as an extension's UI half
 * (DESIGN-UI.md → Extension UI halves): itself, the `sdk` zone, and only the
 * extras it names (the scene kit, for 3D). What such a zone uses of the shell
 * is therefore listed once, in the sdk's barrel. The row is deleted when its
 * package leaves.
 */
function extensionRow(self: UiZone, ...extras: readonly UiZone[]): readonly UiZone[] {
  return [self, "sdk", ...extras];
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
    "sdk",
    "primitives",
    "components/agent",
    "components/canvas",
    "components/chart",
    "components/code",
    "components/graph",
    "components/lab",
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
    "ds",
  ],
  ds: ["ds"],
  lib: ["lib", "api", "actions", "session", "ds"],
  api: ["lib", "api", "actions", "session", "ds"],
  actions: ["lib", "api", "actions", "session", "ds"],
  session: ["lib", "api", "actions", "session", "ds"],
  stores: ["stores", "lib", "api", "session", "ds"],
  fixtures: ["fixtures", "lib"],
  // The host API a feature's UI builds against, the future `@kb/ui-sdk`. Its
  // barrel names primitives, `lib` helpers and `ds` row shapes whose code
  // still lives there; it never names a store, and the shell's state reaches
  // a feature only through `BrowserHost`. GAP [[01M3EZRFTS1W8SB97GFJAWD92X]]
  sdk: ["sdk", "primitives", "lib", "ds"],
  // The scene kit: the GPU stage, post chain, palette roles, light rig and
  // starfield every real-time 3D view stands on — the lab's studies and the
  // 3D graph alike — so neither surface owns a copy. Mechanism only: it reads
  // tokens and timing from `lib` and knows no surface.
  scene: ["scene", "lib"],
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
    "components/canvas",
    "components/graph",
    "components/ontology",
    "components/outline",
    "components/palette",
    "components/prefs",
    "components/sidebar",
  ],
  // The page loads the 3D projection (lazily); only the projection reaches the scene kit.
  "components/canvas": [
    "components/canvas",
    "components/canvas/3d",
    "primitives",
    "stores",
    "actions",
    "lib",
  ],
  // The 3D projection stands on the scene kit, as the 3D graph does.
  "components/canvas/3d": [
    "components/canvas/3d",
    "components/canvas",
    "primitives",
    "stores",
    "actions",
    "lib",
    "scene",
  ],
  "components/graph": ["components/graph", "primitives", "stores", "actions", "lib", "scene"],
  "components/lab": ["components/lab", "primitives", "stores", "actions", "lib", "scene"],
  "components/ontology": ["components/ontology", "primitives", "stores", "actions", "lib"],
  // Panes and layouts: a pane draws whatever page its path resolves to, by
  // route and view key, so it imports no other surface.
  "components/layout": ["components/layout", "primitives", "stores", "actions", "lib"],
  // The agent sidebar draws what the agent channel says; the shell hands it
  // the socket and the invoke path as ports (`src/agent.ts`), so it reaches
  // neither `api` nor `session` itself.
  "components/agent": ["components/agent", "primitives", "stores", "lib"],
  // A chart draws its query node's rows; the rows and its saves come through the host.
  "components/chart": extensionRow("components/chart"),
  // A code view hosts a sandbox frame; the page's end of the bridge comes through the host.
  "components/code": extensionRow("components/code"),
  // The sandbox frame's own script, a separate build that runs in the frame:
  // it reaches nothing of the page, and nothing of the page reaches it.
  sandbox: ["sandbox"],
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
 * The UI's entry module: what the page loads before anything else, so the
 * eager-import closure from here is the always-loaded bundle.
 */
export const UI_ENTRY = "main.tsx";

/**
 * The lazy-chunk fence: specifiers the page loads only inside a chunk of
 * their own. three is the whole real-time 3D stack (the scene kit's GPU
 * modules are three by another name, and are caught through the three they
 * import), and only a view that draws 3D — a lab study's scene, the 3D graph
 * — may load it. `@kb/vega` is the whole chart stack (Vega, Vega-Lite and the
 * expression interpreter, which only it imports), and only a chart's drawing
 * may load it.
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
export const UI_LAZY_ONLY = /^(?:three|@kb\/vega|vega(?:-lite|-interpreter)?)(?:\/|$)/;

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
