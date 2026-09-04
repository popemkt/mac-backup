/**
 * Run a palette command node (typed sys.command).
 */
import { ulid } from "ulid";
import { present } from "@kb/model";
import { mutations } from "@/actions/mutations";
import { listOntologyItems } from "@/lib/ontology-scope";
import { navigate, ontologyPath } from "@/lib/router";
import { toast } from "@/lib/toast";
import { SYSTEM_IDS, WORKSPACE_ROOT_ID, isSysPrefixed } from "@/lib/types";
import { useDebugFieldsStore } from "@/stores/debug-fields.store";
import { useOutlineStore } from "@/stores/outline.store";
import { usePrefsStore, type ThemePref } from "@/stores/prefs.store";
import { useUiStore } from "@/stores/ui.store";

const THEME_CYCLE: ThemePref[] = ["light", "dark", "system"];

function nextTheme(current: ThemePref): ThemePref {
  const i = THEME_CYCLE.indexOf(current);
  return present(THEME_CYCLE[(i + 1) % THEME_CYCLE.length], "theme cycle index is a modulo");
}

// oxlint-disable-next-line complexity -- GAP [[01M1MGCRNVNBE5HW27Z83PK67B]]
export async function runPaletteCommand(commandId: string): Promise<void> {
  switch (commandId) {
    case SYSTEM_IDS.cmdAddNode: {
      const selected = useOutlineStore.getState().selectedNodeId;
      if (selected !== null && !isSysPrefixed(selected)) {
        await mutations.createNodeAfter(selected);
      } else {
        const newId = ulid();
        const ok = await mutations.addRootNode("Untitled", newId);
        if (ok) {
          useOutlineStore.getState().jumpToNode(newId);
        }
      }
      return;
    }
    case SYSTEM_IDS.cmdAddTag: {
      const id = await mutations.defineTag("untitled-tag");
      if (id !== null) {
        useOutlineStore.getState().zoomTo(id);
      }
      return;
    }
    case SYSTEM_IDS.cmdDefineField: {
      const id = await mutations.defineField("untitled-field");
      if (id !== null) {
        useOutlineStore.getState().zoomTo(id);
      }
      return;
    }
    case SYSTEM_IDS.cmdGoQuery: {
      // The Query tab is gone (W8a); saved queries live under sys.queries.
      useOutlineStore.getState().zoomTo(SYSTEM_IDS.queriesRoot);
      return;
    }
    case SYSTEM_IDS.cmdNewQuery: {
      // W4: #query tag + sys.f.query starter EDN, zoomed for editing.
      const newId = await mutations.newQueryNode();
      if (newId !== null) {
        useOutlineStore.getState().zoomTo(newId);
      }
      return;
    }
    case SYSTEM_IDS.cmdNewOntology: {
      const id = await mutations.defineOntology();
      if (id !== null) navigate(ontologyPath(id));
      return;
    }
    case SYSTEM_IDS.cmdEnterOntology: {
      // The selected / zoomed node when it is an ontology, else the first one.
      const store = useOutlineStore.getState();
      const candidates = listOntologyItems(store.wireNodes);
      if (candidates.length === 0) {
        toast("No ontologies yet — try “New ontology”");
        return;
      }
      const preferred =
        [store.selectedNodeId, store.rootNodeId].find((id) =>
          candidates.some((c) => c.id === id),
        ) ?? candidates[0]?.id;
      if (preferred === undefined) return;
      navigate(ontologyPath(preferred));
      return;
    }
    case SYSTEM_IDS.cmdExitOntology: {
      if (useOutlineStore.getState().ontologyId === null) {
        toast("Not inside an ontology");
        return;
      }
      navigate("/");
      return;
    }
    case SYSTEM_IDS.cmdPreferences: {
      useUiStore.getState().setPrefsOpen(true);
      return;
    }
    case SYSTEM_IDS.cmdToggleTheme: {
      const prefs = usePrefsStore.getState();
      prefs.setTheme(nextTheme(prefs.theme));
      return;
    }
    case SYSTEM_IDS.cmdToggleWidth: {
      const prefs = usePrefsStore.getState();
      prefs.setWidth(prefs.width === "centered" ? "full" : "centered");
      return;
    }
    case SYSTEM_IDS.cmdDebugShowFields: {
      const nodeId = commandTargetNodeId();
      if (nodeId === null) {
        toast("select a node first");
        return;
      }
      useDebugFieldsStore.getState().toggle(nodeId);
      return;
    }
    case SYSTEM_IDS.cmdExpandAll: {
      useOutlineStore.getState().expandAllInScope();
      return;
    }
    case SYSTEM_IDS.cmdCollapseAll: {
      useOutlineStore.getState().collapseAllInScope();
      return;
    }
    case SYSTEM_IDS.cmdViewAsList:
    case SYSTEM_IDS.cmdViewAsTable:
    case SYSTEM_IDS.cmdViewAsBoard:
    case SYSTEM_IDS.cmdViewAsCards: {
      const mode =
        commandId === SYSTEM_IDS.cmdViewAsList
          ? "list"
          : commandId === SYSTEM_IDS.cmdViewAsTable
            ? "table"
            : commandId === SYSTEM_IDS.cmdViewAsBoard
              ? "board"
              : "cards";
      const frameId = viewTargetFrameId();
      if (frameId === null) {
        toast("select a frame first");
        return;
      }
      await mutations.setViewMode(frameId, mode);
      return;
    }
    case SYSTEM_IDS.cmdViewFilter: {
      const frameId = viewTargetFrameId();
      if (frameId === null) {
        toast("select a frame first");
        return;
      }
      // Portal host (ViewFilterPopoverHost) anchors to toolbar/frame row;
      // if no DOM host exists it toasts and clears — never a silent no-op.
      useUiStore.getState().setFilterPopoverFrameId(frameId);
      return;
    }
    default:
      toast(`Unknown command: ${commandId}`);
  }
}

/**
 * The node a node-scoped command acts on: the selected row, else the zoomed
 * root.
 *
 * Deliberately not `viewTargetFrameId`, which answers a different question —
 * "which frame owns the view config" (frame first, `sys.*` excluded). This
 * answers "which node is this command about", and `sys.*` schema nodes are
 * exactly the ones whose hidden props are worth revealing.
 */
function commandTargetNodeId(): string | null {
  const store = useOutlineStore.getState();
  if (store.selectedNodeId !== null) return store.selectedNodeId;
  if (store.rootNodeId && store.rootNodeId !== WORKSPACE_ROOT_ID) {
    return store.rootNodeId;
  }
  return null;
}

/** Zoomed root, else selected non-sys node, else null. */
function viewTargetFrameId(): string | null {
  const store = useOutlineStore.getState();
  if (store.rootNodeId && store.rootNodeId !== WORKSPACE_ROOT_ID) {
    return store.rootNodeId;
  }
  const sel = store.selectedNodeId;
  if (sel !== null && !isSysPrefixed(sel)) return sel;
  return null;
}
