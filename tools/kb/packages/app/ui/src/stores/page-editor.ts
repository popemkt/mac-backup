/**
 * The page's editor: the half of the page that holds a caret. The shell binds
 * every text host through it (`stores/node-text-port.ts`, the shell's
 * `NodeTextPort`), anchors the node palette on its focus, and lands the caret
 * after a write. Core names no editor; the projection the page stands in
 * installs its own while it is loaded (`providePageEditor`). The port is a
 * store, read as it is (`getState`, `subscribe`), so an editor whose state is
 * a store installs that store, with no second copy of its API.
 */
import type { BrowserHost, CaretIntent, NodeTextPort } from "@kb/ui-sdk";
import { portSlot } from "@/stores/port-slot";

/**
 * What the shell reads of the editor's state, and the verbs it calls on it:
 * the row being edited and the row selected, each at the instance it is
 * drawn in; the one caret placement pending; the store half of
 * `NodeTextPort`'s caret hand-off, text-host registry and selection;
 * starting to edit a row (`activateNode`); and opening the rows above one so
 * it shows (`expandAncestors`, which a structural write asks before it lands
 * the caret on the row it moved).
 */
interface PageEditorState {
  readonly activeNodeId: string | null;
  readonly activeInstanceKey: string | null;
  readonly selectedNodeId: string | null;
  readonly selectedInstanceKey: string | null;
  readonly pendingCaret: CaretIntent | null;
  readonly placeCaret: NodeTextPort["placeCaret"];
  readonly consumeCaret: NodeTextPort["consumeCaret"];
  readonly registerTextHost: NodeTextPort["registerTextHost"];
  readonly unregisterTextHost: NodeTextPort["unregisterTextHost"];
  readonly selectNode: NodeTextPort["selectNode"];
  readonly activateNode: BrowserHost["activateNode"];
  readonly expandAncestors: (id: string) => void;
}

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
};

/** What the page edits through while no editor is installed: no focus, no caret, every verb inert. */
const EMPTY_EDITOR: PageEditor = { getState: () => IDLE, subscribe: () => () => undefined };

const installed = portSlot<PageEditor>(EMPTY_EDITOR);

/** The page's editor now: the installed one, else one with no focus whose verbs do nothing. */
export const pageEditor = installed.current;

/** Listen for a change to the editor's state, or to which editor is installed. */
export const subscribeEditor = installed.subscribe;

/** Install the page's editor, from the plugin that provides it while it is loaded. */
export const providePageEditor = installed.install;

/** Uninstall `editor`, if it is still the page's. */
export function withdrawPageEditor(editor: PageEditor): void {
  installed.withdraw(editor);
}
