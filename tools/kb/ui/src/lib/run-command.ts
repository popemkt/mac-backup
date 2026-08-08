/**
 * Run a palette command node (typed sys.command).
 */
import { ulid } from "ulid";
import { mutations } from "@/actions/mutations";
import { toast } from "@/lib/toast";
import { SYSTEM_IDS } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { useUiStore } from "@/stores/ui.store";

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
        useUiStore.getState().setView("outline");
        useOutlineStore.getState().zoomTo(id);
      }
      return;
    }
    case SYSTEM_IDS.cmdDefineField: {
      const id = await mutations.defineField("untitled-field");
      if (id) {
        useUiStore.getState().setView("outline");
        useOutlineStore.getState().zoomTo(id);
      }
      return;
    }
    case SYSTEM_IDS.cmdGoQuery: {
      useUiStore.getState().setView("query");
      return;
    }
    case SYSTEM_IDS.cmdNewQuery: {
      // W4: #query tag + sys.f.query starter EDN, zoomed for editing.
      const newId = await mutations.newQueryNode();
      if (newId) {
        useUiStore.getState().setView("outline");
        useOutlineStore.getState().zoomTo(newId);
      }
      return;
    }
    default:
      toast(`Unknown command: ${commandId}`);
  }
}
