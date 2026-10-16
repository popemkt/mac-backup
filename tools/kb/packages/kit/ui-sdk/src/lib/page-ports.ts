/**
 * The two halves of the page a projection stands in for: the projection the
 * page is shown and edited through, and its editor, the half that holds a
 * caret. Core names neither. A plugin provides each as a UI kernel service
 * while it is loaded, and the shell installs whatever is provided: the graph
 * store tells the projection of every move, and the shell binds its text
 * hosts, anchors the node palette and lands the caret through the editor. A
 * service has one provider, so a second plugin offering either is refused.
 */
import { Service } from "@kb/plugin";
import type { CaretIntent } from "../components/node-text-host";
import type { NodeTextPort } from "../components/node-text-port";
import type { GraphChange, PageGraphState, ScopeSource } from "./page-graph";
import { shownNodesOf } from "./page-graph";
import type { NodeMap } from "./types";

/**
 * The projection the page stands in: what any projection the page is shown
 * and edited through offers the shell. Its rows are read from the graph
 * store, so it holds only its own state, such as which rows are open. Its
 * editor (the caret, the text hosts, the selection) is a port of its own
 * ({@link PageEditor}).
 *
 * Told of a move, for every member of that kind:
 *
 * - It is told before the graph store moves, and is handed every graph state
 *   it reasons about. It reads none from the store, which may still hold the
 *   state being left.
 * - It moves its own state to one valid against both the state it is handed
 *   and the one the store holds, so a reader told in between sees nothing out
 *   of step. Then the store moves, in one write.
 *
 * The members:
 *
 * - `follow(change, prev, next)` — the replica or scope moves from `prev` to
 *   `next`;
 * - `leave(from)` — the page is about to leave `from`: let go of the focus,
 *   and answer the empty row it minted that `from` still shows, if any. The
 *   store prunes that row as a write of its own before it moves, so a
 *   projection makes no write while the page moves;
 * - `arrive(at, to)` — the page is about to stand at `to`, zoomed to
 *   `to.rootNodeId`: land the focus there;
 * - `subscribe(listener)` — a change to what it holds of its own;
 * - `rows(graph)` — the rows it shows of `graph`: what the page shows
 *   (`shownNodesOf`), each open or closed as it holds them;
 * - `reveal(id)` — show `id` where the page is edited, moving the page if it
 *   must, and edit it: a follow's "reveal", a palette hit, an ontology
 *   member.
 */
export interface PageProjection {
  readonly follow: (change: GraphChange, prev: PageGraphState, next: PageGraphState) => void;
  readonly leave: (from: PageGraphState) => string | null;
  readonly arrive: (at: "zoom" | "home", to: PageGraphState) => void;
  readonly subscribe: (listener: () => void) => () => void;
  readonly rows: (graph: ScopeSource) => NodeMap;
  readonly reveal: (id: string) => void;
}

/**
 * What the page stands in while no projection is installed: one that holds
 * nothing of its own, so it shows the rows at their default collapse and
 * reveals nothing. A stand-in projection spreads it for the members it does
 * not watch.
 */
export const EMPTY_PROJECTION: PageProjection = {
  follow: () => undefined,
  leave: () => null,
  arrive: () => undefined,
  subscribe: () => () => undefined,
  rows: (graph) => shownNodesOf(graph),
  reveal: () => undefined,
};

/** Where a plugin provides the page's projection while it is loaded. */
export const PageProjectionService = Service<PageProjection>()("ui.page.projection");

/**
 * The editor's half of `NodeTextPort`: the caret hand-off, the text-host
 * registry and the selection, which the editor answers and the shell's text
 * port forwards to whichever editor is installed (`editorTextPort`).
 */
type EditorTextVerbs = Pick<
  NodeTextPort,
  "placeCaret" | "consumeCaret" | "registerTextHost" | "unregisterTextHost" | "selectNode"
>;

/**
 * What the shell reads of the editor's state, and the verbs it calls on it:
 * the row being edited and the row selected, each at the instance it is
 * drawn in; the one caret placement pending; the editor's half of
 * `NodeTextPort` (`EditorTextVerbs`); starting to edit a row
 * (`activateNode`); opening the rows above one so it shows
 * (`expandAncestors`, which a structural write asks before it lands the caret
 * on the row it moved); and opening or closing one row (`toggleCollapse`).
 */
export interface PageEditorState extends EditorTextVerbs {
  readonly activeNodeId: string | null;
  readonly activeInstanceKey: string | null;
  readonly selectedNodeId: string | null;
  readonly selectedInstanceKey: string | null;
  readonly pendingCaret: CaretIntent | null;
  /** Start editing a node's text in one instance, with the caret at `cursorPos`. */
  readonly activateNode: (nodeId: string, cursorPos?: number, instanceKey?: string) => void;
  readonly expandAncestors: (id: string) => void;
  readonly toggleCollapse: (id: string) => void;
}

/**
 * The page's editor. The port is a store, read as it is (`getState`,
 * `subscribe`), so an editor whose state is a store provides that store, with
 * no second copy of its API.
 */
export interface PageEditor {
  readonly getState: () => PageEditorState;
  readonly subscribe: (listener: () => void) => () => void;
}

const IDLE: PageEditorState = {
  activeNodeId: null,
  activeInstanceKey: null,
  selectedNodeId: null,
  selectedInstanceKey: null,
  pendingCaret: null,
  placeCaret: () => undefined,
  consumeCaret: () => null,
  registerTextHost: () => undefined,
  unregisterTextHost: () => undefined,
  selectNode: () => undefined,
  activateNode: () => undefined,
  expandAncestors: () => undefined,
  toggleCollapse: () => undefined,
};

/** What the page edits through while no editor is installed: no focus, no caret, every verb inert. */
export const EMPTY_EDITOR: PageEditor = { getState: () => IDLE, subscribe: () => () => undefined };

/** Where a plugin provides the page's editor while it is loaded. */
export const PageEditorService = Service<PageEditor>()("ui.page.editor");

/**
 * The editor's half of a node text port, through whichever editor `editor`
 * answers when each member is called: the caret placement addressed to an
 * instance, and the editor's own text verbs.
 */
export function editorTextPort(
  editor: () => PageEditor,
): Pick<NodeTextPort, "pendingCaret" | keyof EditorTextVerbs> {
  const now = () => editor().getState();
  return {
    pendingCaret: (instanceKey) => {
      const caret = now().pendingCaret;
      return caret?.instanceKey === instanceKey ? caret : null;
    },
    placeCaret: (instanceKey, at) => now().placeCaret(instanceKey, at),
    consumeCaret: (instanceKey) => now().consumeCaret(instanceKey),
    registerTextHost: (instanceKey) => now().registerTextHost(instanceKey),
    unregisterTextHost: (instanceKey) => now().unregisterTextHost(instanceKey),
    selectNode: (nodeId, instanceKey) => now().selectNode(nodeId, instanceKey),
  };
}
