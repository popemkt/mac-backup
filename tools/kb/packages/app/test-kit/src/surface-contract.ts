/**
 * The surface contract: what every surface that projects the action registry
 * promises. It is written once and run over all of the surfaces together.
 *
 * The registry is the source of truth. A surface (the CLI's
 * `action-invoke`, the MCP server, the HTTP API, the page's WebMCP tools, the
 * sidebar agent's tools) is a way to reach it and
 * must add nothing and drop nothing. It lists the same ids with the same
 * declared modes, and for the same call it returns the same receipt as the
 * invoke core of the composition it reaches (a `kb ui` also reports the
 * extensions it hosts). A guarantee kept by one surface and broken by another is
 * exactly what this suite catches, so it is not a per-adapter test.
 *
 * Every property runs against a fresh scratch root. That root holds one
 * fixture extension whose actions the root's approval policies decide in
 * each way there is — one requires approval, one is denied, one asks an
 * agent — so every approval path gets exercised even though no core action
 * requires approval. One `kb ui` serves the root for the whole property, as
 * one serves a real root: the surfaces that speak to a server (HTTP, the
 * page's WebMCP) speak to that one, and none starts a second over the same
 * root.
 */
import { writeTrustedExtensionEffect } from "./extension-files.ts";
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import {
  listedOn,
  onWire,
  resolveApproval,
  type ActionInvocation,
  type ActionMode,
  type ActionReceipt,
  type ExtensionRow,
  type SurfaceWire,
} from "@kb/contracts";
import {
  ACTOR_OPTION_IDS,
  DECISION_OPTION_IDS,
  SYSTEM_IDS,
  actsAsOwner,
  approvalPoliciesOf,
  extensionNodeId,
  type ApprovalPolicy,
} from "@kb/model";
import {
  bunFileSystemLayer,
  invoke,
  invokeReceiptEffect,
  kbRuntimeLayer,
  manifest,
  openKb,
} from "@kb/runtime";
import { FakeTab } from "./fake-tab.ts";

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
  /**
   * Whose composition answers a call: the root's `kb ui` (`ui`), which also
   * reports the extensions it hosts, or the surface's own process (`own`),
   * which hosts none. The invoke core it is held to is that composition's.
   */
  readonly host: "ui" | "own";
  close(): Promise<void>;
}

/** The `kb ui` serving the root under test. */
export interface LiveUi {
  /** Where it listens, `http://host:port`. */
  readonly url: string;
  /** The extensions it hosts beside the registry's, as its `kb.manifest` reports them. */
  readonly hosted: readonly ExtensionRow[];
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
/** A plain write that a policy denies to every actor. */
const DENIED_ACTION = "ext.gated.blocked";
/** A plain write that a policy asks an agent about. */
const ASKED_ACTION = "ext.gated.checked";
/**
 * A family's write that the repository's policy asks an agent about: typing
 * a relation (the graph family's), which a person's gesture never asks.
 */
const TYPED_ACTION = "ext.graph.relation.type";
/** One of the seeded default policies. */
const SEEDED_POLICY = "approval.agent-delete";

/** An extension's node every store holds (core's), and a field the root declares a setting of it. */
const EXTENSION_NODE = extensionNodeId("core");
const SETTING_FIELD = "sys.f.surface-contract-setting";

/**
 * The root's setting: a system field that configures core's node, as a
 * family's own seeded field would. Only a system field is a setting, so the
 * owner mints it with force.
 */
const SETTING_INVOCATION: ActionInvocation = {
  id: "node.add",
  input: {
    id: SETTING_FIELD,
    force: true,
    text: "surface contract setting",
    props: [
      { field: SYSTEM_IDS.typeField, value: { t: "ref", v: SYSTEM_IDS.field } },
      { field: SYSTEM_IDS.configuresField, value: { t: "ref", v: EXTENSION_NODE } },
    ],
  },
};

/** The one tab connected to the root's `kb ui`, which applies every command it gets. */
const CONTRACT_TAB = "tab.surface-contract";
const MISSING_TAB = "tab.surface-contract-missing";

/**
 * Writes with no side effect and a fixed output, so that receipts from
 * different surfaces can be compared: one that requires approval, and two
 * plain ones for the policies to decide. Their schemas are bare `{parse}`
 * objects, so the module imports nothing and loads from any scratch
 * directory.
 */
const GATED_EXTENSION = `const passthrough = { parse: (input) => input ?? {} };
const write = (id, output, mode = { kind: "write" }) => ({
  id,
  title: id,
  description: "a write for the surface contract",
  mode,
  inputSchema: passthrough,
  outputSchema: passthrough,
  handler: async () => output,
});
export default [
  write("stamp", { stamped: true }, { kind: "write", approval: "required" }),
  write("blocked", { blocked: false }),
  write("checked", { checked: true }),
];
`;

/**
 * The root's policies, beside the seeded defaults: a denial for everyone, an
 * ask for an agent, an exact allow that lowers the declared approval of the
 * stamp for the command line only, a pattern allow for an agent that lowers
 * nothing the stamp declares, and an allow of every write to anyone, which a
 * write to a policy ignores; and the repository's ask before an agent types
 * a relation.
 */
const POLICIES: readonly Omit<ApprovalPolicy, "id">[] = [
  { match: DENIED_ACTION, actor: null, decision: "deny" },
  { match: ASKED_ACTION, actor: "agent", decision: "ask" },
  { match: APPROVAL_ACTION, actor: "cli", decision: "allow" },
  { match: "ext.gated.*", actor: "agent", decision: "allow" },
  { match: "node.update", actor: null, decision: "allow" },
  { match: TYPED_ACTION, actor: "agent", decision: "ask" },
];

/** A policy as a node, written through the invoke core with a person's approval. */
function policyInvocation(policy: Omit<ApprovalPolicy, "id">): ActionInvocation {
  return {
    id: "node.add",
    approved: true,
    input: {
      text: `${policy.actor ?? "anyone"}: ${policy.decision} ${policy.match}`,
      props: [
        { field: SYSTEM_IDS.typeField, value: { t: "ref", v: SYSTEM_IDS.approvalPolicyTag } },
        { field: SYSTEM_IDS.approvalMatchField, value: { t: "str", v: policy.match } },
        ...(policy.actor === null
          ? []
          : [
              {
                field: SYSTEM_IDS.approvalActorField,
                value: { t: "ref", v: ACTOR_OPTION_IDS[policy.actor] },
              },
            ]),
        {
          field: SYSTEM_IDS.approvalDecisionField,
          value: { t: "ref", v: DECISION_OPTION_IDS[policy.decision] },
        },
      ],
    },
  };
}

/**
 * Calls whose receipts do not depend on when or where they run: reads, each
 * kind of failure, the listing itself, an unapproved call to the gated
 * action, and the screen actions against the root's one tab, which answers
 * every command the same way.
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
  { id: "render.view", input: { id: "lens.all-mentions", format: "md" } },
  // An outline kb refuses writes nothing: a line that does not parse, a ref nothing names.
  { id: "node.addTree", input: { outline: "- a\n    - b\n  - c" } },
  { id: "node.addTree", input: { outline: "- see [[n.surface-contract-missing]]" } },
  // A proposal kb refuses writes nothing, so every surface sees the same refusal.
  { id: "view.propose", input: { view: "outline.nope" } },
  { id: "view.propose", input: { view: "outline.board", params: { groupFieldId: 7 } } },
  { id: APPROVAL_ACTION, input: {} },
  { id: DENIED_ACTION, input: {} },
  { id: ASKED_ACTION, input: {} },
  // A write to a policy asks whatever the policies say, and writes nothing when refused.
  { id: "node.update", input: { id: SEEDED_POLICY, text: "agents never ask" } },
  // A system field that is not one of an extension's settings is not written on its node.
  {
    id: "node.update",
    input: {
      id: EXTENSION_NODE,
      setProps: [
        { field: SYSTEM_IDS.colorField, value: { t: "str", v: "red" } },
        { field: SETTING_FIELD, value: { t: "str", v: "beside the color" } },
      ],
    },
  },
  { id: "ui.screen", input: {} },
  { id: "ui.screen", input: { tab: MISSING_TAB } },
  { id: "ui.navigate", input: { route: "/canvas" } },
  { id: "ui.navigate", input: {} },
  { id: "ui.navigate", input: { camera: { preset: "front" } } },
  { id: "ui.capture", input: { view: { preset: "top" } } },
  { id: "ui.select", input: { selection: [] } },
  { id: "ui.select", input: { tab: MISSING_TAB, focus: "sys.tag" } },
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
    yield* writeTrustedExtensionEffect(root, "gated.ts", GATED_EXTENSION);
    return root;
  }),
  (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
);

/**
 * The root's one `kb ui`, with one tab connected to it, both gone when the
 * scope closes. Every surface reaches that one tab: HTTP and WebMCP through
 * the server, the CLI, MCP and the invoke core through `.kb/ui.json`.
 */
function serveRoot(serve: ServeUi, root: string) {
  return Effect.acquireRelease(
    Effect.gen(function* () {
      const ui = yield* Effect.promise(() => serve(root));
      return { ui, tab: yield* FakeTab.open(ui.url, CONTRACT_TAB) };
    }),
    ({ ui, tab }) => tab.close.pipe(Effect.andThen(Effect.promise(() => ui.stop()))),
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
  /** The root's approval policies, as the invoke core reads them. */
  readonly policies: readonly ApprovalPolicy[];
  /**
   * The invoke core's receipt for the call, on the same root, as it arrives
   * from this surface: made by the actor the surface declares for it.
   */
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
 * so the system seed and the root's policies are written before any surface
 * opens it, and every surface then reads the same store; then its one
 * `kb ui` starts. The
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
        for (const invocation of [...POLICIES.map(policyInvocation), SETTING_INVOCATION]) {
          const written = yield* Effect.promise(() => invoke(ctx, invocation));
          expect(written.status).toBe("succeeded");
        }
        const policies = approvalPoliciesOf(ctx.nodes);
        const { ui } = yield* serveRoot(serve, root);
        yield* Effect.forEach(
          Object.entries(surfaces),
          ([name, open]) =>
            Effect.scoped(
              Effect.gen(function* () {
                const surface = yield* openSurface(open, root, ui);
                const hosted = surface.host === "ui" ? ui.hosted : [];
                const core = (invocation: ActionInvocation) =>
                  invokeReceiptEffect(ctx, onWire(surface.wire, invocation)).pipe(
                    Effect.provide(kbRuntimeLayer(ctx, undefined, Effect.succeed(hosted))),
                  );
                const via = (invocation: ActionInvocation) =>
                  Effect.promise(() => surface.invoke(invocation));
                yield* check({ name, surface, root, policies, core, via });
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
      "leaving out only what is denied to its actor or asks where its wire cannot approve",
    (set) =>
      overSurfaces(set, ({ name, surface, root, policies }) =>
        Effect.gen(function* () {
          const registry = yield* manifest(root).pipe(Effect.provide(bunFileSystemLayer));
          expect(registry.some((entry) => entry.id === APPROVAL_ACTION)).toBe(true);
          const callable = registry.filter((entry) =>
            listedOn(
              surface.wire,
              resolveApproval(policies, { action: entry, actor: surface.wire.actor }).decision,
            ),
          );
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
          // The screen calls compare against a live tab, not two empty answers.
          const screen = yield* core({ id: "ui.screen", input: {} });
          expect(screen).toMatchObject({
            status: "succeeded",
            output: { tabs: [{ tab: CONTRACT_TAB }] },
          });
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
          const call: ActionInvocation = { id: ASKED_ACTION, input: {}, approved: true };
          // Where the wire cannot carry approval, the call that arrives is the unapproved one.
          const { carriesApproval } = surface.wire;
          const arrives = carriesApproval ? call : { id: call.id, input: call.input };
          const expected = yield* core(arrives);
          // The command line is never asked about this action; an agent is.
          const asked = surface.wire.actor === "agent";
          expect(expected.status).toBe(carriesApproval || !asked ? "succeeded" : "failed");
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
  [
    "one policy decides the same on every surface: a denial refuses, an ask refuses an " +
      "unapproved call, and only a policy naming the action lowers a declared approval",
    (set) =>
      overSurfaces(set, ({ name, surface, via }) =>
        Effect.gen(function* () {
          const listed = new Set((yield* Effect.promise(() => surface.list())).map((a) => a.id));
          // What a call came to: "ran", its failure code, or "uncallable" where
          // the wire cannot make it at all, which only an unlisted action may be.
          const outcome = (id: string, input: unknown = {}) =>
            Effect.map(via({ id, input }), (receipt) => {
              if (receipt !== null) return receipt.status === "failed" ? receipt.code : "ran";
              expect({ name, id, listed: listed.has(id) }).toEqual({ name, id, listed: false });
              return "uncallable";
            });
          // The refusal `code`, or the wire's own where it cannot make the call.
          const refusal = (code: string, seen: string) =>
            seen === "uncallable" && !surface.wire.carriesApproval ? seen : code;
          const agent = surface.wire.actor === "agent";
          const denied = yield* outcome(DENIED_ACTION);
          const asked = yield* outcome(ASKED_ACTION);
          const declared = yield* outcome(APPROVAL_ACTION);
          // Nodes the root does not hold: a call that runs reaches the action and is not_found.
          const typed = yield* outcome(TYPED_ACTION, {
            source: "n.x",
            target: "n.y",
            field: "f.z",
          });
          expect({ name, denied, asked, declared, typed }).toEqual({
            name,
            // Denied to every actor, whatever the wire.
            denied: refusal("forbidden", denied),
            // Asked of an agent, never of the command line.
            asked: agent ? refusal("approval_required", asked) : "ran",
            // The exact allow is the command line's; an agent's pattern allow lowers nothing.
            declared: agent ? refusal("approval_required", declared) : "ran",
            // A family's write asks an agent under the repository's policy, as core's do.
            typed: agent ? refusal("approval_required", typed) : "not_found",
          });
        }),
      ),
  ],
  [
    "every surface writes an extension's setting on its node as it writes any field, " +
      "and nothing else of that node; a caller acting for the owner only with approval",
    (set) =>
      overSurfaces(set, ({ name, surface, via }) =>
        Effect.gen(function* () {
          const write = (value: string): ActionInvocation => ({
            id: "node.update",
            input: {
              id: EXTENSION_NODE,
              setProps: [{ field: SETTING_FIELD, value: { t: "str", v: value } }],
              unsetProps: [{ field: SETTING_FIELD }],
            },
          });
          const receipt = yield* via(write(name));
          if (receipt === null) {
            // Only a surface that cannot reach the write at all may not make it.
            const listed = new Set((yield* Effect.promise(() => surface.list())).map((a) => a.id));
            expect({ name, listed: listed.has("node.update") }).toEqual({ name, listed: false });
            return;
          }
          if (!actsAsOwner(surface.wire.actor)) {
            // Configuration is the owner's: a caller acting for them asks first.
            expect({ name, code: receipt.status === "failed" ? receipt.code : "ran" }).toEqual({
              name,
              code: "approval_required",
            });
            const approved = yield* via({ ...write(name), approved: true });
            const ran = approved?.status === "succeeded";
            expect({ name, ran }).toEqual({ name, ran: surface.wire.carriesApproval });
            if (!ran) return;
          } else {
            expect({ name, status: receipt.status }).toEqual({ name, status: "succeeded" });
          }
          // Read back through the surface: the session the contract opened has not seen the write.
          const read = yield* via({ id: "node.get", input: { id: EXTENSION_NODE, depth: 0 } });
          expect({ name, read: read?.status === "succeeded" ? read.output : read }).toMatchObject({
            name,
            read: { node: { text: "Core", props: { [SETTING_FIELD]: [{ t: "str", v: name }] } } },
          });
          // The same node is still write-protected beyond its settings.
          const renamed = yield* via({
            id: "node.update",
            input: { id: EXTENSION_NODE, text: "renamed" },
          });
          expect({ name, code: renamed?.status === "failed" ? renamed.code : "ran" }).toEqual({
            name,
            code: "forbidden",
          });
        }),
      ),
  ],
  [
    "force is the owner's: a surface whose caller acts for the owner sets it, and one whose " +
      "caller acts for them is refused, whatever the policies say",
    (set) =>
      overSurfaces(set, ({ name, surface, via }) =>
        Effect.gen(function* () {
          // A forced write that changes nothing but the node's stamp.
          const forced = yield* via({
            id: "node.update",
            input: { id: EXTENSION_NODE, setProps: [], force: true },
          });
          if (forced === null) {
            const listed = new Set((yield* Effect.promise(() => surface.list())).map((a) => a.id));
            expect({ name, listed: listed.has("node.update") }).toEqual({ name, listed: false });
            return;
          }
          expect({ name, outcome: forced.status === "failed" ? forced.code : "ran" }).toEqual({
            name,
            outcome: actsAsOwner(surface.wire.actor) ? "ran" : "forbidden",
          });
        }),
      ),
  ],
  [
    "the commit holds every action to the system-write rule: no surface renames, deletes or " +
      "files under a system node without force, whichever action plans the write",
    (set) =>
      overSurfaces(set, ({ name, surface, via }) =>
        Effect.gen(function* () {
          const listed = new Set((yield* Effect.promise(() => surface.list())).map((a) => a.id));
          const writes: readonly ActionInvocation[] = [
            { id: "node.update", input: { id: EXTENSION_NODE, text: "renamed" } },
            { id: "node.delete", input: { id: EXTENSION_NODE } },
            { id: "node.addTree", input: { outline: "- filed", parent: EXTENSION_NODE } },
          ];
          for (const write of writes) {
            // Approved, so where a policy asks first the commit still decides.
            const receipt = yield* via({ ...write, approved: true });
            const outcome =
              receipt === null ? "uncallable" : receipt.status === "failed" ? receipt.code : "ran";
            // Only a surface that does not list the action may be unable to make it, and only
            // one whose wire cannot carry the approval may stop at the ask.
            const before =
              (outcome === "uncallable" && !listed.has(write.id)) ||
              (outcome === "approval_required" && !surface.wire.carriesApproval);
            expect({ name, action: write.id, outcome }).toEqual({
              name,
              action: write.id,
              outcome: before ? outcome : "forbidden",
            });
          }
        }),
      ),
  ],
  [
    "no surface writes a policy without a person behind the call, whatever the policies say",
    (set) =>
      overSurfaces(set, ({ name, surface, via }) =>
        Effect.gen(function* () {
          // A policy that would allow every write to anyone: it lowers nothing here.
          const edit: ActionInvocation = {
            id: "node.update",
            input: { id: SEEDED_POLICY, setProps: [] },
          };
          const unapproved = yield* via(edit);
          expect({ name, code: unapproved?.status === "failed" ? unapproved.code : "ran" }).toEqual(
            { name, code: "approval_required" },
          );
          const approved = yield* via({ ...edit, approved: true });
          // Approved, it runs exactly where the wire carries the approval.
          const ran = approved?.status === "succeeded";
          expect({ name, ran }).toEqual({ name, ran: surface.wire.carriesApproval });
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
