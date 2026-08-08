/**
 * Run a palette command node (typed sys.command).
 */
import { ulid } from "ulid";
import { mutations } from "@/actions/mutations";
import { toast } from "@/lib/toast";
import { SYSTEM_IDS } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { usePrefsStore, type ThemePref } from "@/stores/prefs.store";
import { useUiStore } from "@/stores/ui.store";

const THEME_CYCLE: ThemePref[] = ["light", "dark", "system"];

function nextTheme(current: ThemePref): ThemePref {
  const i = THEME_CYCLE.indexOf(current);
  return THEME_CYCLE[(i + 1) % THEME_CYCLE.length]!;
}

export async function runPaletteCommand(commandId: string): Promise<void> {
  switch (commandId) {
    case SYSTEM_IDS.cmdAddNode: {
      const selected = useOutlineStore.getState().selectedNodeId;
      if (selected && !selected.startsWith("sys.")) {
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
      if (id) {
        useOutlineStore.getState().zoomTo(id);
      }
      return;
    }
    case SYSTEM_IDS.cmdDefineField: {
      const id = await mutations.defineField("untitled-field");
      if (id) {
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
      if (newId) {
        useOutlineStore.getState().zoomTo(newId);
      }
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
      usePrefsStore.getState().toggleShowAllFields();
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
    default:
      toast(`Unknown command: ${commandId}`);
  }
}
