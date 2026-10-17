/**
 * A `BrowserHost` for a UI half's tests (DESIGN-UI.md → Extension UI halves).
 * A half reaches the page only through its host, so its tests hold it to
 * that port, not to the shell: the shell's own host is held to the shell's
 * stores by `@kb/ui`'s tests.
 *
 * It keeps the little a port promises: a graph the test sets, one active
 * node with the caret placement addressed to it, and the pane reports views
 * make. Every other gesture is inert, every write makes nothing, every call
 * answers that this host makes none, and a test replaces any member it
 * watches.
 */
import { definePlugin, type Plugin } from "@kb/plugin";
import {
  appearanceOf,
  type BrowserHost,
  BrowserHostService,
  type CaretIntent,
  DEFAULT_DESIGN_SYSTEM,
  type NodeMap,
  type OutlineNode,
  type PageGraphState,
  type PageWrites,
  type PaneCarryOut,
  type PaneReport,
  type Prefs,
  refInkOf,
  type SchemaIndex,
  schemaOfGraph,
  WORKSPACE_ROOT_ID,
} from "@kb/ui-sdk";

/** One pane's report, as a view last made it. */
export interface HeldReport {
  readonly pane: string;
  readonly report: PaneReport;
  readonly carryOut: PaneCarryOut;
}

/** The node being edited, in the one instance it is edited in. */
export interface ActiveNode {
  readonly nodeId: string;
  readonly instanceKey: string | undefined;
}

export interface TestBrowserHost extends BrowserHost {
  /** Make `nodes` the graph; whoever subscribed hears it. */
  readonly setNodes: (nodes: Iterable<OutlineNode>) => void;
  /** The node being edited, if any. */
  readonly active: () => ActiveNode | null;
  /** The pane reports held now, one per pane. */
  readonly reports: () => readonly HeldReport[];
}

type ActionReceipt = Awaited<ReturnType<BrowserHost["invoke"]>>;
type WireNode = ReturnType<BrowserHost["wireNodes"]>[number];

/**
 * The reads a hook takes a snapshot of answer the same value until it
 * changes, as `useSyncExternalStore` requires.
 */
const LIGHT = appearanceOf("kb", false);
const NO_WIRE: WireNode[] = [];
const PREFS: Prefs = {
  theme: "light",
  designSystem: DEFAULT_DESIGN_SYSTEM,
  width: "centered",
  headerBackdrop: "",
  backdropStrength: "subtle",
  backdropDirection: "down",
  sidebarOpen: true,
};
/** The graph state this host stands at: home, unscoped, with no replica of its own. */
const AT_HOME: PageGraphState = {
  wireNodes: NO_WIRE,
  index: null,
  rootNodeId: WORKSPACE_ROOT_ID,
  homeRootId: WORKSPACE_ROOT_ID,
  ontologyId: null,
  ontologyMembers: null,
};
const NO_IDS: ReadonlySet<string> = new Set();

/** What a call to this host answers: it makes none. */
const noCall = (id: string): Promise<ActionReceipt> =>
  Promise.resolve({
    status: "failed",
    id,
    code: "not_found",
    message: "this test host makes no calls",
  });

/** What a write to this host answers: it makes none, and a write that names what it made names nothing. */
const done = (): Promise<void> => Promise.resolve();
const refused = (): Promise<boolean> => Promise.resolve(false);
const none = (): Promise<string | null> => Promise.resolve(null);

const INERT_WRITES: PageWrites = {
  updateNodeContent: done,
  createNodeAfter: done,
  addTagField: done,
  removeTagField: done,
  setTagColor: done,
  setFieldHidden: done,
  setFieldType: done,
  addFieldTargetTag: done,
  removeFieldTargetTag: done,
  setFieldTargetQuery: done,
  splitNode: done,
  deleteNode: done,
  mergeNextIntoThis: done,
  mergeWithPrevious: done,
  indentNode: done,
  outdentNode: done,
  moveNodeUp: done,
  moveNodeDown: done,
  updateProp: done,
  removeProp: done,
  addTag: done,
  removeTag: done,
  ontologyAddInclude: done,
  ontologyRemoveInclude: done,
  ontologyAddMember: done,
  ontologyRemoveMember: done,
  ontologyExclude: done,
  ontologyUnexclude: done,
  ontologyRemoveExtends: done,
  ontologySetQuery: done,
  ontologySetClosure: done,
  makeDefaultView: done,
  setFrameView: done,
  replaceField: done,
  setViewSort: done,
  toggleViewSort: done,
  setViewDisplay: done,
  setColumnWidth: done,
  setViewPagesize: done,
  setViewGroup: done,
  addViewFilter: done,
  removeViewFilter: done,
  moveBoardCard: done,
  addRootNode: refused,
  addChildNode: refused,
  undo: refused,
  redo: refused,
  makeSupertag: refused,
  togglePin: refused,
  attachFileToNode: refused,
  ontologyAddExtends: refused,
  createEmptyNode: none,
  createEmptyNodeBefore: none,
  createRefTarget: none,
  defineField: none,
  defineTag: none,
  uploadAsset: none,
  newQueryNode: none,
  defineOntology: none,
};

/** A test host over an empty graph, with `overrides` in place of its members. */
export function testBrowserHost(overrides: Partial<BrowserHost> = {}): TestBrowserHost {
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  let nodes: NodeMap = new Map();
  // A schema is one object per graph: the node map the host holds is the whole graph.
  let schema: SchemaIndex | null = null;
  const schemaNow = () => (schema ??= schemaOfGraph(nodes));
  let active: ActiveNode | null = null;
  let caret: CaretIntent | null = null;
  const held = new Map<string, HeldReport & { readonly owner: symbol }>();

  const host: TestBrowserHost = {
    setNodes: (next) => {
      nodes = new Map([...next].map((node) => [node.id, node]));
      schema = null;
      notify();
    },
    active: () => active,
    reports: () =>
      [...held.values()].map(({ pane, report, carryOut }) => ({ pane, report, carryOut })),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    nodes: () => nodes,
    schema: schemaNow,
    index: () => null,
    node: (id) => nodes.get(id),
    isActive: (nodeId, instanceKey) =>
      active?.nodeId === nodeId && active.instanceKey === instanceKey,
    // A stand-in selects nothing and has no rows to open or close.
    isSelected: () => false,
    toggleCollapse: () => {},
    activateNode: (nodeId, cursorPos, instanceKey) => {
      active = { nodeId, instanceKey };
      caret = instanceKey === undefined ? null : { instanceKey, at: cursorPos ?? 0 };
      notify();
    },
    pendingCaret: (instanceKey) => (caret?.instanceKey === instanceKey ? caret : null),
    placeCaret: () => {},
    consumeCaret: (instanceKey) => {
      if (caret?.instanceKey !== instanceKey) return null;
      const taken = caret;
      caret = null;
      return taken;
    },
    registerTextHost: () => {},
    unregisterTextHost: () => {},
    selectNode: () => {},
    setNodePaletteOpen: () => {},
    follow: () => {},
    wireNodes: () => NO_WIRE,
    live: () => false,
    subscribeQuery: () => () => {},
    appearance: () => LIGHT,
    prefs: () => PREFS,
    prefsOpen: () => false,
    setPrefsOpen: () => {},
    sidebarOpen: () => true,
    toggleSidebar: () => {},
    refInk: () => refInkOf(schemaNow()),
    zoomTo: () => {},
    zoomHome: () => {},
    graph: {
      state: () => AT_HOME,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      reach: () => true,
      reached: () => AT_HOME,
      drop: () => {},
    },
    debugFields: { ids: () => NO_IDS, toggle: () => {} },
    filterFrame: () => null,
    setFilterFrame: () => {},
    nodePaletteOpen: () => false,
    nodeCommands: () => [],
    navigatePane: () => {},
    writes: INERT_WRITES,
    invoke: (id) => noCall(id),
    screen: {
      report: (pane, owner, report, carryOut) => held.set(pane, { pane, owner, report, carryOut }),
      release: (pane, owner) => {
        if (held.get(pane)?.owner === owner) held.delete(pane);
      },
    },
    proposeView: () => Promise.resolve({ refused: "this test host makes no views" }),
    sandbox: {
      hostFrame: () => {
        throw new Error("this test host hosts no sandbox frame");
      },
      invokeAsScript: (invocation) => noCall(invocation.id),
      isTrusted: () => Promise.resolve(false),
      setTrusted: () => noCall("sandbox.trust"),
    },
    ...overrides,
  };
  return host;
}

/** A plugin that provides `host` as the page's `BrowserHost`, as the shell's host plugin does. */
export function testHostPlugin(host: BrowserHost): Plugin {
  return definePlugin({ name: "host", apply: (ctx) => ctx.provide(BrowserHostService, host) });
}
