/**
 * Run a palette command node (typed sys.command).
 */
import { ulid } from "ulid";
import { mutations } from "@/actions/mutations";
import { toast } from "@/lib/toast";
import { SYSTEM_IDS } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { usePrefsStore, resolveDark } from "@/stores/prefs.store";
import { useUiStore } from "@/stores/ui.store";

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
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
      const dark = resolveDark(prefs.theme, systemPrefersDark());
      prefs.setTheme(dark ? "light" : "dark");
      return;
    }
    case SYSTEM_IDS.cmdToggleWidth: {
      const prefs = usePrefsStore.getState();
      prefs.setWidth(prefs.width === "centered" ? "full" : "centered");
      return;
    }
    default:
      toast(`Unknown command: ${commandId}`);
  }
}
