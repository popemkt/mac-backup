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
import { cloneWire } from "@/lib/tx";
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
  /** Pre-edit wire node for this id only — never a whole-graph snapshot. */
  preEdit: WireNode;
  timer: ReturnType<typeof setTimeout>;
};

const pendingContent = new Map<string, PendingContent>();

/**
 * Re-apply every newer pending local text edit after a resync wipe.
 * Node-local and independent: missing or unplannable ids are pruned and
 * skipped so one failure never aborts the rest of the batch.
 * Do not exclude the failed flush id — its map entry was already removed at
 * timer fire, and any same-id entry present now is a newer in-flight re-edit.
 */
function reapplyPendingLocalEdits(): void {
  for (const [id, pending] of [...pendingContent]) {
    try {
      const store = useOutlineStore.getState();
      if (!store.wireNodes.some((n) => n.id === id)) {
        clearTimeout(pending.timer);
        pendingContent.delete(id);
        continue;
      }
      const plan = planUpdateText(store.wireNodes, id, pending.text);
      store.applyTx(plan.upserts, plan.deletes);
    } catch {
      const still = pendingContent.get(id);
      if (still) {
        clearTimeout(still.timer);
        pendingContent.delete(id);
      }
    }
  }
}

/**
 * Failure recovery for the debounced text path.
 * Prefer a server resync, then restore only the failed node's pre-edit state
 * if resync itself fails — never replace the whole graph from a local snapshot.
 * Concurrent pending edits (including a same-node re-edit made during the
 * in-flight resync) are re-applied afterward.
 */
async function resyncOrRestoreNode(preEdit: WireNode): Promise<void> {
  const store = useOutlineStore.getState();
  try {
    const { loadGraph } = await import("@/api/graph");
    const { snapshot: fresh, source } = await loadGraph();
    store.hydrateFromWire(fresh.nodes, fresh.rev, source);
  } catch {
    useOutlineStore.getState().applyTx([cloneWire(preEdit)], []);
  }
  reapplyPendingLocalEdits();
}

async function flushContentRemote(
  id: string,
  content: string,
  preEdit: WireNode,
): Promise<void> {
  const store = useOutlineStore.getState();
  if (store.loadSource === "fixtures" || store.loadSource === null) return;

  try {
    const receipt = await postAction("node.update", { id, text: content });
    if (receipt.status === "failed") {
      toast(receipt.message);
      await resyncOrRestoreNode(preEdit);
    }
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err));
    await resyncOrRestoreNode(preEdit);
  }
}

/** @internal Clear debounce map between tests. */
export function __resetPendingContentForTests(): void {
  for (const pending of pendingContent.values()) clearTimeout(pending.timer);
  pendingContent.clear();
}

export const mutations = {
  /** Immediate local text apply; debounced remote POST with per-node revert. */
  updateNodeContent(id: string, content: string): void {
    if (!guardSysWrite(id)) return;

    const store = useOutlineStore.getState();
    const prev = pendingContent.get(id);
    const existing = store.wireNodes.find((n) => n.id === id);
    if (!existing && !prev) return;
    const preEdit = prev?.preEdit ?? cloneWire(existing!);

    const plan = planUpdateText(store.wireNodes, id, content);
    store.applyTx(plan.upserts, plan.deletes);

    if (prev) clearTimeout(prev.timer);
    pendingContent.set(id, {
      text: content,
      preEdit,
      timer: setTimeout(() => {
        pendingContent.delete(id);
        void flushContentRemote(id, content, preEdit);
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

  /** Ghost-row create: root, first child, or after sibling. Returns new node id. */
  async createGhostNode(
    parentId: string,
    afterSiblingId: string | null,
    text: string,
  ): Promise<string | null> {
    const newId = ulid();
    if (parentId === WORKSPACE_ROOT_ID) {
      const ok = await applyPlan(planAddRootNode(text, newId));
      return ok ? newId : null;
    }
    if (afterSiblingId) {
      const ok = await applyPlan(planCreateAfter(wire(), afterSiblingId, newId));
      if (!ok) return null;
      if (text) mutations.updateNodeContent(newId, text);
      return newId;
    }
    const ok = await applyPlan(
      (await import("@/actions/plan")).planAddChild(
        wire(),
        parentId,
        newId,
        text,
      ),
    );
    return ok ? newId : null;
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

  async setFieldHidden(fieldId: string, hidden: boolean): Promise<void> {
    if (!guardSysWrite(fieldId)) return;
    const { planSetFieldHidden } = await import("@/actions/plan");
    await applyPlan(planSetFieldHidden(wire(), fieldId, hidden));
  },

  async setFieldType(fieldId: string, fieldType: string): Promise<void> {
    if (!guardSysWrite(fieldId)) return;
    const { planSetFieldType } = await import("@/actions/plan");
    await applyPlan(planSetFieldType(wire(), fieldId, fieldType));
  },

  async addFieldTargetTag(fieldId: string, tagId: string): Promise<void> {
    if (!guardSysWrite(fieldId)) return;
    const { planAddFieldTargetTag } = await import("@/actions/plan");
    await applyPlan(planAddFieldTargetTag(wire(), fieldId, tagId));
  },

  async removeFieldTargetTag(fieldId: string, tagId: string): Promise<void> {
    if (!guardSysWrite(fieldId)) return;
    const { planRemoveFieldTargetTag } = await import("@/actions/plan");
    await applyPlan(planRemoveFieldTargetTag(wire(), fieldId, tagId));
  },

  async setFieldTargetQuery(
    fieldId: string,
    edn: string | null,
  ): Promise<void> {
    if (!guardSysWrite(fieldId)) return;
    const { planSetFieldTargetQuery } = await import("@/actions/plan");
    await applyPlan(planSetFieldTargetQuery(wire(), fieldId, edn));
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

  async setViewMode(
    frameId: string,
    mode: import("@/lib/view-config").ViewMode,
  ): Promise<void> {
    if (!guardSysWrite(frameId)) return;
    const { planSetViewMode } = await import("@/actions/plan");
    await applyPlan(planSetViewMode(wire(), frameId, mode));
  },

  async setLensRenderer(
    perspectiveId: string,
    renderer: string,
  ): Promise<void> {
    if (!guardSysWrite(perspectiveId)) return;
    const { planSetLensRenderer } = await import("@/actions/plan");
    await applyPlan(planSetLensRenderer(wire(), perspectiveId, renderer));
  },

  async setViewSort(
    frameId: string,
    sortSpecs: import("@/lib/view-config").SortSpec[],
  ): Promise<void> {
    if (!guardSysWrite(frameId)) return;
    const { planSetViewSort } = await import("@/actions/plan");
    await applyPlan(planSetViewSort(wire(), frameId, sortSpecs));
  },

  async toggleViewSort(frameId: string, fieldId: string): Promise<void> {
    if (!guardSysWrite(frameId)) return;
    const store = useOutlineStore.getState();
    const frameNode = store.nodes.get(frameId);
    const { getViewConfig } = await import("@/lib/view-config");
    const config = getViewConfig(frameNode?.props);
    const current = config.sort;
    const existingIndex = current.findIndex((s) => s.fieldId === fieldId);

    let nextSort: import("@/lib/view-config").SortSpec[];
    if (existingIndex === -1) {
      nextSort = [{ fieldId, dir: "asc" }, ...current];
    } else if (current[existingIndex]?.dir === "asc") {
      nextSort = current.map((s, i) =>
        i === existingIndex ? { ...s, dir: "desc" as const } : s,
      );
    } else {
      nextSort = current.filter((s) => s.fieldId !== fieldId);
    }

    const { planSetViewSort } = await import("@/actions/plan");
    await applyPlan(planSetViewSort(wire(), frameId, nextSort));
  },

  async setViewDisplay(
    frameId: string,
    displayFieldIds: string[],
  ): Promise<void> {
    if (!guardSysWrite(frameId)) return;
    const { planSetViewDisplay } = await import("@/actions/plan");
    await applyPlan(planSetViewDisplay(wire(), frameId, displayFieldIds));
  },

  async setColumnWidth(
    frameId: string,
    fieldId: string,
    widthPx: number,
  ): Promise<void> {
    if (!guardSysWrite(frameId)) return;
    const store = useOutlineStore.getState();
    const frameNode = store.nodes.get(frameId);
    const { getViewConfig } = await import("@/lib/view-config");
    const config = getViewConfig(frameNode?.props);
    const nextColwidth = { ...config.colwidth, [fieldId]: widthPx };
    const { planSetViewColwidth } = await import("@/actions/plan");
    await applyPlan(planSetViewColwidth(wire(), frameId, nextColwidth));
  },

  async setViewPagesize(frameId: string, pagesize: number): Promise<void> {
    if (!guardSysWrite(frameId)) return;
    const { planSetViewPagesize } = await import("@/actions/plan");
    await applyPlan(planSetViewPagesize(wire(), frameId, pagesize));
  },

  async setViewGroup(
    frameId: string,
    fieldId: string | null,
  ): Promise<void> {
    if (!guardSysWrite(frameId)) return;
    const { planSetViewGroup } = await import("@/actions/plan");
    await applyPlan(planSetViewGroup(wire(), frameId, fieldId));
  },

  async setViewFilters(
    frameId: string,
    filterEdnList: string[],
  ): Promise<void> {
    if (!guardSysWrite(frameId)) return;
    const { planSetViewFilters } = await import("@/actions/plan");
    await applyPlan(planSetViewFilters(wire(), frameId, filterEdnList));
  },

  async addViewFilter(frameId: string, edn: string): Promise<void> {
    if (!guardSysWrite(frameId)) return;
    const store = useOutlineStore.getState();
    const frame = store.nodes.get(frameId);
    const { getViewConfig, serializeViewFilter, parseViewFilterEdn } =
      await import("@/lib/view-config");
    const parsed = parseViewFilterEdn(edn);
    if (!parsed) {
      toast(`Bad filter EDN: ${edn}`);
      return;
    }
    const config = getViewConfig(frame?.props);
    const next = [
      ...config.filters.map((f) => f.raw || serializeViewFilter(f)),
      serializeViewFilter(parsed),
    ];
    const { planSetViewFilters } = await import("@/actions/plan");
    await applyPlan(planSetViewFilters(wire(), frameId, next));
  },

  async removeViewFilter(frameId: string, edn: string): Promise<void> {
    if (!guardSysWrite(frameId)) return;
    const store = useOutlineStore.getState();
    const frame = store.nodes.get(frameId);
    const { getViewConfig, serializeViewFilter } =
      await import("@/lib/view-config");
    const config = getViewConfig(frame?.props);
    const next = config.filters
      .map((f) => f.raw || serializeViewFilter(f))
      .filter((raw) => raw !== edn);
    const { planSetViewFilters } = await import("@/actions/plan");
    await applyPlan(planSetViewFilters(wire(), frameId, next));
  },

  async moveBoardCard(
    nodeId: string,
    fieldId: string,
    oldValue: import("@/lib/types").PropValue | null,
    newValue: import("@/lib/types").PropValue | null,
  ): Promise<void> {
    if (!guardSysWrite(nodeId)) return;
    const { planMoveBoardCard } = await import("@/actions/plan");
    await applyPlan(
      planMoveBoardCard(wire(), nodeId, fieldId, oldValue, newValue),
    );
  },
};

export type Mutations = typeof mutations;
