/**
 * Mutation action layer — optimistic local tx → POST /api/action.
 */
import { ulid } from "ulid";
import { postAction } from "@/api/action";
import { runOptimistic } from "@/actions/optimistic";
import {
  planAddRootNode,
  planAddTag,
  planCreateAfter,
  planDefineField,
  planDefineTag,
  planDelete,
  planIndent,
  planMergeWithPrevious,
  planMove,
  planNewQueryNode,
  planOutdent,
  planRemoveTag,
  planSetProp,
  planSplit,
  planUnsetProp,
  planUpdateText,
  type PlannedMutation,
} from "@/actions/plan";
import { toast } from "@/lib/toast";
import { isSysPrefixed, WORKSPACE_ROOT_ID } from "@/lib/types";
import { cloneWireNodes } from "@/lib/tx";
import type { PropValue } from "@/lib/types";
import type { WireNode } from "@kb/protocol";
import { useOutlineStore } from "@/stores/outline.store";

function wire(): WireNode[] {
  return useOutlineStore.getState().wireNodes;
}

/** Block edits on sys.* in the UI with a toast (core also enforces). */
function guardSysWrite(id: string): boolean {
  if (!isSysPrefixed(id)) return true;
  toast("System nodes (sys.*) are read-only");
  return false;
}

async function applyPlan(plan: PlannedMutation | null): Promise<boolean> {
  if (!plan) return false;
  const result = await runOptimistic(plan);
  return result.ok;
}

type PendingContent = {
  text: string;
  snapshot: WireNode[];
  timer: ReturnType<typeof setTimeout>;
};

const pendingContent = new Map<string, PendingContent>();

/**
 * Failure recovery for the debounced text path: other mutations may have
 * landed after this flush's snapshot was taken, so restoring the snapshot
 * would clobber them. Resync from the server (source of truth) instead;
 * fall back to the snapshot only if the resync itself fails.
 */
async function resyncOrRestore(snapshot: WireNode[]): Promise<void> {
  const store = useOutlineStore.getState();
  try {
    const { loadGraph } = await import("@/api/graph");
    const { snapshot: fresh, source } = await loadGraph();
    store.hydrateFromWire(fresh.nodes, fresh.rev, source);
  } catch {
    store.restoreSnapshot(snapshot, store.rev);
  }
}

async function flushContentRemote(
  id: string,
  content: string,
  snapshot: WireNode[],
): Promise<void> {
  const store = useOutlineStore.getState();
  if (store.loadSource === "fixtures" || store.loadSource === null) return;

  try {
    const receipt = await postAction("node.update", { id, text: content });
    if (receipt.status === "failed") {
      toast(receipt.message);
      await resyncOrRestore(snapshot);
    }
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err));
    await resyncOrRestore(snapshot);
  }
}

export const mutations = {
  /** Immediate local text apply; debounced remote POST with pre-edit revert. */
  updateNodeContent(id: string, content: string): void {
    if (!guardSysWrite(id)) return;

    const store = useOutlineStore.getState();
    const prev = pendingContent.get(id);
    const snapshot = prev?.snapshot ?? cloneWireNodes(store.wireNodes);

    const plan = planUpdateText(store.wireNodes, id, content);
    store.applyTx(plan.upserts, plan.deletes);

    if (prev) clearTimeout(prev.timer);
    pendingContent.set(id, {
      text: content,
      snapshot,
      timer: setTimeout(() => {
        pendingContent.delete(id);
        void flushContentRemote(id, content, snapshot);
      }, 280),
    });
  },

  async createNodeAfter(afterId: string): Promise<void> {
    if (!guardSysWrite(afterId)) return;
    await applyPlan(planCreateAfter(wire(), afterId, ulid()));
  },

  async addRootNode(text: string, newId?: string): Promise<boolean> {
    const id = newId ?? ulid();
    return applyPlan(planAddRootNode(text, id));
  },

  async addChildNode(
    parentId: string,
    text: string,
    newId?: string,
  ): Promise<boolean> {
    if (!guardSysWrite(parentId)) return false;
    const id = newId ?? ulid();
    const { planAddChild } = await import("@/actions/plan");
    return applyPlan(planAddChild(wire(), parentId, id, text));
  },

  /** Ghost-row create: root, first child, or after sibling. */
  async createGhostNode(
    parentId: string,
    afterSiblingId: string | null,
    text: string,
  ): Promise<void> {
    const newId = ulid();
    if (parentId === WORKSPACE_ROOT_ID) {
      await applyPlan(planAddRootNode(text, newId));
      return;
    }
    if (afterSiblingId) {
      await applyPlan(planCreateAfter(wire(), afterSiblingId, newId));
      if (text) mutations.updateNodeContent(newId, text);
      return;
    }
    await applyPlan(
      (await import("@/actions/plan")).planAddChild(
        wire(),
        parentId,
        newId,
        text,
      ),
    );
  },

  async addTagField(tagId: string, fieldId: string): Promise<void> {
    if (!guardSysWrite(tagId)) return;
    const { planAddTagField } = await import("@/actions/plan");
    await applyPlan(planAddTagField(wire(), tagId, fieldId));
  },

  async removeTagField(tagId: string, fieldId: string): Promise<void> {
    if (!guardSysWrite(tagId)) return;
    const { planRemoveTagField } = await import("@/actions/plan");
    await applyPlan(planRemoveTagField(wire(), tagId, fieldId));
  },

  async setTagColor(tagId: string, color: string | null): Promise<void> {
    if (!guardSysWrite(tagId)) return;
    const { planSetTagColor } = await import("@/actions/plan");
    await applyPlan(planSetTagColor(wire(), tagId, color));
  },

  async splitNode(id: string, cursor: number): Promise<void> {
    if (!guardSysWrite(id)) return;
    await applyPlan(planSplit(wire(), id, cursor, ulid()));
  },

  async deleteNode(id: string): Promise<void> {
    if (!guardSysWrite(id)) return;
    await applyPlan(planDelete(wire(), id));
  },

  async mergeWithPrevious(id: string): Promise<void> {
    if (!guardSysWrite(id)) return;
    await applyPlan(planMergeWithPrevious(wire(), id));
  },

  async indentNode(id: string): Promise<void> {
    if (!guardSysWrite(id)) return;
    await applyPlan(planIndent(wire(), id));
  },

  async outdentNode(id: string): Promise<void> {
    if (!guardSysWrite(id)) return;
    await applyPlan(planOutdent(wire(), id));
  },

  async moveNodeUp(id: string): Promise<void> {
    if (!guardSysWrite(id)) return;
    await applyPlan(planMove(wire(), id, "up"));
  },

  async moveNodeDown(id: string): Promise<void> {
    if (!guardSysWrite(id)) return;
    await applyPlan(planMove(wire(), id, "down"));
  },

  async updateProp(
    nodeId: string,
    fieldId: string,
    value: PropValue,
    oldValue?: PropValue,
  ): Promise<void> {
    if (!guardSysWrite(nodeId)) return;
    await applyPlan(planSetProp(wire(), nodeId, fieldId, value, oldValue));
  },

  async removeProp(
    nodeId: string,
    fieldId: string,
    value?: PropValue,
  ): Promise<void> {
    if (!guardSysWrite(nodeId)) return;
    await applyPlan(planUnsetProp(wire(), nodeId, fieldId, value));
  },

  async addTag(nodeId: string, tagId: string): Promise<void> {
    if (!guardSysWrite(nodeId)) return;
    await applyPlan(planAddTag(wire(), nodeId, tagId));
  },

  async removeTag(nodeId: string, tagId: string): Promise<void> {
    if (!guardSysWrite(nodeId)) return;
    await applyPlan(planRemoveTag(wire(), nodeId, tagId));
  },

  async defineField(name: string): Promise<string | null> {
    const newId = ulid();
    const ok = await applyPlan(planDefineField(name, newId));
    return ok ? newId : null;
  },

  async defineTag(name: string): Promise<string | null> {
    const newId = ulid();
    const ok = await applyPlan(planDefineTag(name, newId));
    return ok ? newId : null;
  },

  /**
   * W6a: upload a file via `asset.upload`, then append `![alt](assets/…)`
   * markdown to the node text.
   */
  async attachFileToNode(nodeId: string, file: File): Promise<boolean> {
    if (!guardSysWrite(nodeId)) return false;
    const store = useOutlineStore.getState();
    if (store.loadSource === "fixtures" || store.loadSource === null) {
      toast("Cannot upload assets without a live kb server");
      return false;
    }

    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < buf.length; i++) {
        binary += String.fromCharCode(buf[i]!);
      }
      const bytes = btoa(binary);
      const receipt = await postAction("asset.upload", {
        bytes,
        filename: file.name,
      });
      if (receipt.status === "failed") {
        toast(receipt.message);
        return false;
      }
      const out = receipt.output as { path: string };
      const node = store.nodes.get(nodeId);
      const alt = file.name.replace(/\.[^.]+$/, "") || "file";
      const md = `![${alt}](${out.path})`;
      const next =
        !node?.text || node.text.trim() === ""
          ? md
          : `${node.text}${node.text.endsWith("\n") ? "" : "\n"}${md}`;
      mutations.updateNodeContent(nodeId, next);
      return true;
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
      return false;
    }
  },

  /** W4: root node tagged #query with a starter sys.f.query definition. */
  async newQueryNode(text = "New query"): Promise<string | null> {
    const newId = ulid();
    const ok = await applyPlan(planNewQueryNode(text, newId));
    return ok ? newId : null;
  },
};

export type Mutations = typeof mutations;
