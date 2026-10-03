/**
 * The workspace: the layout open as the whole screen (DESIGN-UI.md → Panes
 * and layouts). Its arrangement is a kb layout tree (`@kb/views`), and which
 * pane has the focus is the workspace's too. Both are per device, kept in
 * localStorage["kb-workspace"]; "Save workspace" writes the arrangement as a
 * layout node, and opening one replaces it.
 *
 * The URL names the focused pane: the address bar shows that pane's location,
 * a navigation moves that pane, and moving the focus shows the newly focused
 * pane's location without a history entry (`startWorkspace` keeps the two in
 * step).
 */
import { Predicate, Result } from "effect";
import { create } from "zustand";
import {
  closePane,
  decodeLayout,
  findPane,
  freshPaneId,
  layoutPanes,
  neighbourOf,
  openBeside,
  sameLayout,
  singlePane,
  withPanePath,
  LayoutView,
  type LayoutTree,
} from "@kb/views";
import { MAIN_PANE } from "@/lib/pane";
import { getPath, navigate, nodePath, replacePath, subscribePath } from "@/lib/router";
import { toast } from "@/lib/toast";
import { WORKSPACE_ROOT_ID } from "@/lib/types";
import { invoke } from "@/session/runtime";
import { useOutlineStore } from "@/stores/outline.store";
import { useUiStore } from "@/stores/ui.store";

export const WORKSPACE_STORAGE_KEY = "kb-workspace";

interface Workspace {
  readonly layout: LayoutTree;
  /** The pane the URL names, where a navigation lands and keys type. */
  readonly focused: string;
}

interface WorkspaceStore extends Workspace {
  /** Open `path` in a new pane to the right of `beside`, and focus it; returns its id. */
  openBeside: (beside: string, path: string) => string;
  /** Show `path` in pane `id`. */
  navigatePane: (id: string, path: string) => void;
  /** Close pane `id`; the last pane stays. */
  close: (id: string) => void;
  focus: (id: string) => void;
  /** Take an arrangement the grid reports (a drag, a resize, a tab switch). */
  arrange: (layout: LayoutTree) => void;
  /** Replace the workspace with a saved layout, focusing its first pane. */
  replace: (layout: LayoutTree) => void;
  /** Keep the arrangement as a layout node named `text` (`saveWorkspace`); its id, or null. */
  save: (text: string) => Promise<string | null>;
}

function currentPath(): string {
  return typeof window === "undefined" ? "/" : getPath();
}

function fresh(): Workspace {
  return { layout: singlePane({ id: MAIN_PANE, path: currentPath() }), focused: MAIN_PANE };
}

/** What this device last had open, or one pane at the URL. */
function load(): Workspace {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (raw === null) return fresh();
    const stored: unknown = JSON.parse(raw);
    if (typeof stored !== "object" || stored === null || !("layout" in stored)) return fresh();
    const layout = decodeLayout(stored.layout);
    if (Result.isFailure(layout)) return fresh();
    const focused =
      "focused" in stored &&
      typeof stored.focused === "string" &&
      findPane(layout.success, stored.focused) !== undefined
        ? stored.focused
        : (layoutPanes(layout.success)[0]?.id ?? MAIN_PANE);
    // The URL names the focused pane, so it wins over what was stored.
    return { layout: withPanePath(layout.success, focused, currentPath()), focused };
  } catch {
    return fresh();
  }
}

function save({ layout, focused }: Workspace): void {
  try {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({ layout, focused }));
  } catch {
    // A device that cannot store keeps the arrangement for this page load.
  }
}

/** The location pane `id` shows. */
function pathOf(workspace: Workspace, id: string): string | undefined {
  return findPane(workspace.layout, id)?.path;
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => {
  const commit = (next: Workspace): void => {
    const now = get();
    if (next.focused === now.focused && sameLayout(next.layout, now.layout)) return;
    set(next);
    save(next);
    // The address bar follows the focus, without a history entry.
    const path = pathOf(next, next.focused);
    if (path !== undefined && next.focused !== now.focused) replacePath(path);
  };
  return {
    ...(typeof window === "undefined" ? fresh() : load()),

    openBeside: (beside, path) => {
      const { layout } = get();
      const id = freshPaneId(layout);
      commit({ layout: openBeside(layout, beside, { id, path }), focused: id });
      return id;
    },

    navigatePane: (id, path) => {
      const now = get();
      // A pane the workspace does not hold (one inside a dashboard) moves the
      // focused pane, which holds it. The focused pane moves by the URL, so
      // its step is in the history.
      if (id === now.focused || findPane(now.layout, id) === undefined) navigate(path);
      else commit({ ...now, layout: withPanePath(now.layout, id, path) });
    },

    close: (id) => {
      const now = get();
      const layout = closePane(now.layout, id);
      if (sameLayout(layout, now.layout)) return;
      const focused =
        now.focused === id ? (neighbourOf(now.layout, id) ?? now.focused) : now.focused;
      commit({ layout, focused });
    },

    focus: (id) => {
      const now = get();
      if (findPane(now.layout, id) !== undefined) commit({ ...now, focused: id });
    },

    arrange: (layout) => {
      const now = get();
      const focused =
        findPane(layout, now.focused) === undefined
          ? (layoutPanes(layout)[0]?.id ?? MAIN_PANE)
          : now.focused;
      commit({ layout, focused });
    },

    replace: (layout) => {
      const focused = layoutPanes(layout)[0]?.id ?? MAIN_PANE;
      commit({ layout, focused });
    },

    save: (text) => saveWorkspace(get().layout, text),
  };
});

/** The workspace now, for a reader outside React (a command's context). */
export function currentWorkspace(): WorkspaceStore {
  return useWorkspaceStore.getState();
}

/**
 * The live arrangement as a layout to keep: a pane showing the outline's zoom
 * keeps the node it is zoomed to (`/node/<id>`), since the zoom moves on.
 */
function keptLayout(layout: LayoutTree): LayoutTree {
  const zoom = useOutlineStore.getState().rootNodeId;
  if (zoom === WORKSPACE_ROOT_ID) return layout;
  return layoutPanes(layout).reduce(
    (kept, pane) => (pane.path === "/" ? withPanePath(kept, pane.id, nodePath(zoom)) : kept),
    layout,
  );
}

/**
 * "Save workspace": write the live arrangement as a layout node named
 * `text`, through `view.propose` — the one check of a proposed view, so the
 * UI saves exactly what an agent could propose. Filed in the Views list,
 * where it can be pinned. Returns the node's id, or null when it was refused.
 */
async function saveWorkspace(layout: LayoutTree, text: string): Promise<string | null> {
  const root = keptLayout(layout);
  const receipt = await invoke("view.propose", { view: LayoutView.id, params: { root }, text });
  if (receipt.status === "failed") {
    toast(`Could not save the workspace: ${receipt.message}`);
    return null;
  }
  const { output } = receipt;
  const id = Predicate.isObject(output) && typeof output.id === "string" ? output.id : null;
  useUiStore.getState().pushToast("info", `Saved the workspace as “${text}”, in Views`);
  return id;
}

/**
 * Keep the focused pane and the URL in step: a navigation (a link, a
 * command, back and forward) moves the focused pane. Returns the unsubscribe.
 */
export function startWorkspace(): () => void {
  const follow = (): void => {
    const { layout, focused } = useWorkspaceStore.getState();
    const path = getPath();
    if (pathOf({ layout, focused }, focused) === path) return;
    useWorkspaceStore.getState().arrange(withPanePath(layout, focused, path));
  };
  follow();
  return subscribePath(follow);
}
