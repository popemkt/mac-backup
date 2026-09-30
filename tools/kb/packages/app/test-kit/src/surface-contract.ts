/**
 * The surface contract: what every surface that projects the action registry
 * promises. It is written once and run over all of the surfaces together.
 *
 * The registry is the source of truth. A surface (the CLI's
 * `action-invoke`, the MCP server, the HTTP API, the page's WebMCP tools) is
 * a way to reach it and
 * must add nothing and drop nothing. It lists the same ids with the same
 * declared modes, and for the same call it returns the same receipt as the
 * invoke core. A guarantee kept by one surface and broken by another is
 * exactly what this suite catches, so it is not a per-adapter test.
 *
 * Every property runs against a fresh scratch root. That root holds one
 * fixture extension whose action requires approval, so the approval path
 * gets exercised even though no core action requires approval. One `kb ui`
 * serves the root for the whole property, as one serves a real root: the
 * surfaces that speak to a server (HTTP, the page's WebMCP) speak to that
 * one, and none starts a second over the same root.
 */
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import {
  listedOn,
  type ActionInvocation,
  type ActionMode,
  type ActionReceipt,
  type SurfaceWire,
} from "@kb/contracts";
import { bunFileSystemLayer, invoke, manifest, openKb } from "@kb/runtime";

/** One listed action, as a surface's own listing states it. */
export interface ListedAction {
  id: string;
  mode: ActionMode;
}

/** A surface under test, bound to one kb root and speaking its own protocol. */
export interface ActionSurface {
  /**
   * The actions this surface lists, taken from its own listing (a tool list,
   * a manifest route, a manifest call) and not from the registry.
   */
  list(): Promise<readonly ListedAction[]>;
  /**
   * The receipt this surface returns for the call, rebuilt from its wire
   * form. A surface whose wire cannot carry `approved` drops it, just as a
   * real caller of that surface would. `null` means the wire has no way to
   * make the call at all (WebMCP cannot call a tool it did not register),
   * which only an action the surface leaves out of its listing may be.
   */
  invoke(invocation: ActionInvocation): Promise<ActionReceipt | null>;
  /**
   * What this surface's wire can carry, as the surface itself declares it.
   * The properties below prove the declaration by behaviour.
   */
  readonly wire: SurfaceWire;
  close(): Promise<void>;
}

/** The `kb ui` serving the root under test. */
export interface LiveUi {
  /** Where it listens, `http://host:port`. */
  readonly url: string;
  stop(): Promise<void>;
}

/** Start a `kb ui` over a root; the contract stops it when the property ends. */
export type ServeUi = (root: string) => Promise<LiveUi>;

/**
 * Open the surface over a root that already exists, has been opened once, and
 * that `ui` serves.
 */
export type SurfaceFactory = (root: string, ui: LiveUi) => Promise<ActionSurface>;

const APPROVAL_ACTION = "ext.gated.stamp";

/**
 * An approval-required write with no side effect and a fixed output, so
 * that receipts from different surfaces can be compared. Its schemas are
 * bare `{parse}` objects, so the module imports nothing and loads from any
 * scratch directory.
 */
const GATED_EXTENSION = `const passthrough = { parse: (input) => input ?? {} };
export default [
  {
    id: "stamp",
    title: "Stamp",
    description: "an approval-required write for the surface contract",
    mode: { kind: "write", approval: "required" },
    inputSchema: passthrough,
    outputSchema: passthrough,
    handler: async () => ({ stamped: true }),
  },
];
`;

/**
 * Calls whose receipts do not depend on when or where they run: reads, each
 * kind of failure, the listing itself, and an unapproved call to the gated
 * action.
 */
const CALLS: readonly ActionInvocation[] = [
  { id: "kb.manifest", input: {} },
  { id: "node.get", input: { id: "sys.tag", depth: 0 } },
  { id: "node.get", input: { id: "n.surface-contract-missing" } },
  { id: "node.get", input: {} },
  {
    id: "graph.query",
    input: { query: '[:find ?id :where [?e :node/id "sys.tag"] [?e :node/id ?id]]' },
  },
  { id: "render.views", input: {} },
  { id: APPROVAL_ACTION, input: {} },
];

/** A receipt as data on the wire: what any surface can faithfully return. */
function asWireData(receipt: ActionReceipt): unknown {
  return JSON.parse(JSON.stringify(receipt));
}

function byId(actions: readonly ListedAction[]): ListedAction[] {
  return actions.map(({ id, mode }) => ({ id, mode })).toSorted((a, b) => a.id.localeCompare(b.id));
}

/** A scratch root holding the gated extension, removed when the scope closes. */
const scratchRoot = Effect.acquireRelease(
  Effect.gen(function* () {
    const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "kb-surface-contract-")));
    const extensions = join(root, ".kb", "extensions");
    yield* Effect.promise(() => mkdir(extensions, { recursive: true }));
    yield* Effect.promise(() => writeFile(join(extensions, "gated.ts"), GATED_EXTENSION, "utf8"));
    return root;
  }),
  (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
);

/** The root's one `kb ui`, stopped when the scope closes. */
function serveRoot(serve: ServeUi, root: string) {
  return Effect.acquireRelease(
    Effect.promise(() => serve(root)),
    (ui) => Effect.promise(() => ui.stop()),
  );
}

/** One surface over the root, closed when the scope closes. */
function openSurface(open: SurfaceFactory, root: string, ui: LiveUi) {
  return Effect.acquireRelease(
    Effect.promise(() => open(root, ui)),
    (surface) => Effect.promise(() => surface.close()),
  );
}

/** What one property checks against one surface. */
interface SurfaceCase {
  readonly name: string;
  readonly surface: ActionSurface;
  readonly root: string;
  /** The invoke core's receipt for the call, on the same root. */
  readonly core: (invocation: ActionInvocation) => Effect.Effect<ActionReceipt>;
  /** The surface's receipt for the call, or `null` when its wire cannot make it. */
  readonly via: (invocation: ActionInvocation) => Effect.Effect<ActionReceipt | null>;
}

/** What the contract runs over: how a root is served, and the surfaces by name. */
export interface SurfaceSet {
  readonly serve: ServeUi;
  readonly surfaces: Readonly<Record<string, SurfaceFactory>>;
}

/**
 * Each surface in turn over one scratch root. The root is opened once first,
 * so the system seed is written before any surface opens it, and every
 * surface then reads the same store; then its one `kb ui` starts. The
 * surfaces run one after another because each owns process-wide resources
 * (stdout, a port).
 */
function overSurfaces(
  { serve, surfaces }: SurfaceSet,
  check: (c: SurfaceCase) => Effect.Effect<void>,
): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* scratchRoot;
        const ctx = yield* Effect.promise(() => openKb(root));
        const ui = yield* serveRoot(serve, root);
        const core = (invocation: ActionInvocation) =>
          Effect.promise(() => invoke(ctx, invocation));
        yield* Effect.forEach(
          Object.entries(surfaces),
          ([name, open]) =>
            Effect.scoped(
              Effect.gen(function* () {
                const surface = yield* openSurface(open, root, ui);
                const via = (invocation: ActionInvocation) =>
                  Effect.promise(() => surface.invoke(invocation));
                yield* check({ name, surface, root, core, via });
              }),
            ),
          { discard: true },
        );
      }),
    ),
  );
}

const PROPERTIES: ReadonlyArray<readonly [string, (set: SurfaceSet) => Promise<void>]> = [
  [
    "every surface lists the registry's action ids with their declared modes, " +
      "leaving out only the actions its wire could never approve",
    (set) =>
      overSurfaces(set, ({ name, surface, root }) =>
        Effect.gen(function* () {
          const registry = yield* manifest(root).pipe(Effect.provide(bunFileSystemLayer));
          expect(registry.some((entry) => entry.id === APPROVAL_ACTION)).toBe(true);
          const callable = registry.filter((entry) => listedOn(surface.wire, entry.mode));
          const listed = yield* Effect.promise(() => surface.list());
          expect({ name, listed: byId(listed) }).toEqual({ name, listed: byId(callable) });
        }),
      ),
  ],
  [
    "every surface returns the invoke core's receipt for the same call, " +
      "or cannot make a call to an action it does not list",
    (set) =>
      overSurfaces(set, ({ name, surface, core, via }) =>
        Effect.gen(function* () {
          const listed = new Set((yield* Effect.promise(() => surface.list())).map((a) => a.id));
          yield* Effect.forEach(
            CALLS,
            (call) =>
              Effect.gen(function* () {
                const receipt = yield* via(call);
                if (receipt === null) {
                  expect({ name, call, listed: listed.has(call.id) }).toEqual({
                    name,
                    call,
                    listed: false,
                  });
                  return;
                }
                expect({ name, call, receipt: asWireData(receipt) }).toEqual({
                  name,
                  call,
                  receipt: asWireData(yield* core(call)),
                });
              }),
            { discard: true },
          );
        }),
      ),
  ],
  [
    "an approved call runs only through a surface whose wire carries the approval",
    (set) =>
      overSurfaces(set, ({ name, surface, core, via }) =>
        Effect.gen(function* () {
          const call: ActionInvocation = { id: APPROVAL_ACTION, input: {}, approved: true };
          // Where the wire cannot carry approval, the call that arrives is the unapproved one.
          const { carriesApproval } = surface.wire;
          const arrives = carriesApproval ? call : { id: call.id, input: call.input };
          const expected = yield* core(arrives);
          expect(expected.status).toBe(carriesApproval ? "succeeded" : "failed");
          const receipt = yield* via(call);
          // A wire that cannot make the call cannot run it either: no answer is
          // right only where the wire cannot carry approval and so does not
          // list the action. The listing property above runs in this same
          // suite and proves the second half for every surface, so a null
          // here cannot hide a surface that drops a call it does list.
          if (receipt === null) {
            const listed = new Set((yield* Effect.promise(() => surface.list())).map((a) => a.id));
            expect({ name, carriesApproval, listed: listed.has(call.id) }).toEqual({
              name,
              carriesApproval: false,
              listed: false,
            });
            return;
          }
          expect({ name, receipt: asWireData(receipt) }).toEqual({
            name,
            receipt: asWireData(expected),
          });
        }),
      ),
  ],
];

/**
 * Run the contract over every surface at once.
 *
 * @param set - how a root is served, and each surface's factory by name. The
 *   map is the list of surfaces, so adding a surface means adding an entry,
 *   and it then has to meet every property here.
 */
export function surfaceContract(set: SurfaceSet): void {
  const names = Object.keys(set.surfaces).join(", ");
  describe(`action surfaces (${names}) — one registry contract`, () => {
    for (const [title, property] of PROPERTIES) test(title, () => property(set));
  });
}
