/**
 * Mutation action layer — optimistic local tx → POST /api/action.
 */
import { ASSET_MAX_BYTES } from "@kb/operations";
import { ulid } from "ulid";
import { z } from "zod";
import type { FrameViewKey, SortSpec, ViewConfig } from "@kb/views";
import type { FieldType } from "@kb/model";
import { runOptimistic } from "@/actions/optimistic";
import {
  planAddChild,
  planAddRootNode,
  planAddTag,
  planDefineField,
  planDefineTag,
  planDelete,
  planIndent,
  planInsertSibling,
  planMergeInto,
  planMergeWithPrevious,
  planMove,
  planNewQueryNode,
  planOutdent,
  planPinNode,
  planPrependChild,
  planRemoveTag,
  planSetProp,
  planSplit,
  planUnsetProp,
  planUpdateText,
  type FrameViewEdit,
  type PlannedMutation,
} from "@/actions/plan";
import {
  forestRootIds,
  isSysPrefixed,
  type PageWrites,
  pinnedRefIdsFor,
  type PropValue,
  type RefCreation,
  SYSTEM_IDS,
  toast,
  WORKSPACE_ROOT_ID,
} from "@kb/ui-sdk";

/** `asset.upload` answers with the repo-relative path it stored the bytes at. */
const AssetUploadOutputSchema = z.object({ path: z.string() });

/** A size in whole megabytes, as a toast says it. */
const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

import { findParentWire } from "@/lib/tx";
import { restoreInvocations } from "@/actions/restore";
import type { WireNode } from "@kb/contracts";
import { typeRefsOf } from "@kb/model";
import { shownNodes, useGraphStore } from "@/stores/graph.store"; // GAP [[01M1RXMRB7AZB7DPFR6XBPBKQ9]]
import { pageRows } from "@/stores/page"; // GAP [[01M1RXMRB7AZB7DPFR6XBPBKQ9]]
import { pageEditor } from "@/stores/page-editor"; // GAP [[01M1RXMRB7AZB7DPFR6XBPBKQ9]]
import { invoke, invokeLocal, pushInvocation, writeLocal } from "@/session/runtime";
import type { Hold } from "@/session/replica";

/** The page's editor's state now: where a write lands the caret. */
const editor = () => pageEditor().getState();

function wire(): WireNode[] {
  return useGraphStore.getState().wireNodes;
}

/** Block edits on sys.* in the UI with a toast (core also enforces). */
function guardSysWrite(id: string): boolean {
  if (!isSysPrefixed(id)) return true;
  toast("System nodes (sys.*) are read-only");
  return false;
}

function recordHistory(preWire: WireNode[], plan: PlannedMutation): void {
  useGraphStore.getState().recordUndo({
    undo: restoreInvocations(wire(), preWire),
    redo: plan.actions,
  });
}

async function invokeAll(actions: Array<{ id: string; input: unknown }>): Promise<boolean> {
  const localOnly = useGraphStore.getState().loadSource !== "api";
  for (const action of actions) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- history is ordered for structural dependencies
    const receipt = localOnly ? await invokeLocal(action) : await invoke(action.id, action.input);
    if (receipt.status === "failed") {
      toast(receipt.message);
      return false;
    }
  }
  return true;
}

async function applyPlan(plan: PlannedMutation | null): Promise<boolean> {
  if (!plan) return false;
  const preWire = useGraphStore.getState().wireNodes;
  const result = await runOptimistic(plan);
  if (result.ok) recordHistory(preWire, plan);
  return result.ok;
}

/**
 * Write `edit` to the frame view node a frame is shown through, making one (filed in the
 * Views list) when the frame names none (`planEditFrameView`).
 */
async function editFrameView(frameId: string, edit: FrameViewEdit): Promise<void> {
  if (!guardSysWrite(frameId)) return;
  const { planEditFrameView } = await import("@/actions/plan");
  const plan = planEditFrameView(wire(), frameId, edit, ulid());
  if (plan === null) {
    toast("There is no Views list to keep this frame's view in");
    return;
  }
  await applyPlan(plan);
}

/** The frame settings a frame's view node holds now. */
async function frameConfig(frameId: string): Promise<ViewConfig> {
  const { frameConfigOf, schemaOf } = await import("@kb/ui-sdk");
  return frameConfigOf(shownNodes().get(frameId), schemaOf(useGraphStore.getState()));
}

/**
 * Typed text not yet pushed. Its local write is already committed and held
 * (DESIGN-UI.md → Replica sync → Holds); the coalesced flush is the push that
 * settles `hold`. In fixture mode nothing is pushed, so nothing is held.
 */
type PendingContent = {
  text: string;
  timer: ReturnType<typeof setTimeout>;
  hold: Hold | undefined;
};

const pendingContent = new Map<string, PendingContent>();

async function flushContentRemote(id: string, pending: PendingContent): Promise<void> {
  const store = useGraphStore.getState();
  if (store.loadSource === "fixtures" || store.loadSource === null) return;

  try {
    const receipt = await pushInvocation(
      { id: "node.update", input: { id, text: pending.text } },
      pending.hold,
    );
    if (receipt.status === "failed") toast(receipt.message);
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err));
  }
}

/** Flush the current coalesced value, not the value from when its timer armed. */
function flushPendingContent(id: string, pending: PendingContent): Promise<void> {
  clearTimeout(pending.timer);
  // A newer keystroke may already have replaced this entry.  Only the entry
  // being flushed is removed; the newer one remains queued behind it.
  if (pendingContent.get(id) === pending) pendingContent.delete(id);
  return flushContentRemote(id, pending);
}

/**
 * Structural plans must be made only after the server has seen the text that
 * their offsets/merges operate on. Every pending text is flushed, including
 * that of a node about to be deleted: the one push lane orders the flush
 * before the structural write, and the flush is what settles its hold.
 */
async function prepareStructuralMutation(): Promise<void> {
  await Promise.all(
    Array.from(pendingContent, ([id, pending]) => flushPendingContent(id, pending)),
  );
}

/** @internal Clear debounce map between tests. */
export function __resetPendingContentForTests(): void {
  for (const pending of pendingContent.values()) clearTimeout(pending.timer);
  pendingContent.clear();
}

export const mutations: PageWrites = {
  async updateNodeContent(id: string, content: string): Promise<void> {
    if (!guardSysWrite(id)) return;

    const store = useGraphStore.getState();
    const prev = pendingContent.get(id);
    if (!store.wireNodes.some((node) => node.id === id)) return;

    const plan = planUpdateText(store.wireNodes, id, content);
    const action = plan.actions[0];
    if (action === undefined) return;
    const { receipt, hold } =
      store.loadSource === "api"
        ? await writeLocal(action, prev?.hold)
        : { receipt: await invokeLocal(action), hold: undefined };
    if (receipt.status === "failed") {
      toast(receipt.message);
      return;
    }

    if (prev) clearTimeout(prev.timer);
    pendingContent.set(id, {
      text: content,
      hold,
      timer: setTimeout(() => {
        const latest = pendingContent.get(id);
        if (latest) void flushPendingContent(id, latest);
      }, 280),
    });
  },

  async createNodeAfter(afterId: string): Promise<void> {
    if (!guardSysWrite(afterId)) return;
    // Splitting after a node inserts the new row under the sibling's parent —
    // guard that parent, not just the sibling id (sys.* write-guard).
    const siblingParent = findParentWire(wire(), afterId);
    if (siblingParent && !guardSysWrite(siblingParent.id)) return;
    await applyPlan(planInsertSibling(wire(), afterId, "after", ulid()));
  },

  async addRootNode(text: string, newId?: string): Promise<boolean> {
    const id = newId ?? ulid();
    return applyPlan(planAddRootNode(text, id));
  },

  async addChildNode(parentId: string, text: string, newId?: string): Promise<boolean> {
    if (!guardSysWrite(parentId)) return false;
    const id = newId ?? ulid();
    return applyPlan(planAddChild(wire(), parentId, id, text));
  },

  async createEmptyNode(parentId: string, afterSiblingId: string | null): Promise<string | null> {
    const newId = ulid();
    let ok = false;
    if (parentId === WORKSPACE_ROOT_ID) {
      ok = await applyPlan(planAddRootNode("", newId));
    } else if (afterSiblingId !== null) {
      // Inserting after a sibling lands under the sibling's parent — guard
      // that parent, not just the sibling id (sys.* write-guard).
      const siblingParent = findParentWire(wire(), afterSiblingId);
      if (siblingParent && !guardSysWrite(siblingParent.id)) return null;
      ok = await applyPlan(planInsertSibling(wire(), afterSiblingId, "after", newId));
    } else {
      if (!guardSysWrite(parentId)) return null;
      ok = await applyPlan(planAddChild(wire(), parentId, newId, ""));
    }
    if (!ok) return null;
    // F4: single activation via runOptimistic — no post-await re-activation.
    return newId;
  },

  async createEmptyNodeBefore(beforeId: string): Promise<string | null> {
    if (!guardSysWrite(beforeId)) return null;
    const parent = findParentWire(wire(), beforeId);
    if (!parent) {
      return mutations.createEmptyNode(WORKSPACE_ROOT_ID, beforeId);
    }
    if (!guardSysWrite(parent.id)) return null;
    const siblings = parent.children;
    const idx = siblings.indexOf(beforeId);
    const prevSibling = idx > 0 ? (siblings[idx - 1] ?? null) : null;
    const newId = ulid();
    let plan: PlannedMutation | null;
    if (prevSibling !== null) {
      plan = planInsertSibling(wire(), prevSibling, "after", newId);
    } else {
      plan = planPrependChild(wire(), parent.id, newId);
    }
    const ok = await applyPlan(plan);
    if (!ok) return null;
    return newId;
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

  async setFieldType(fieldId: string, fieldType: FieldType): Promise<void> {
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

  async setFieldTargetQuery(fieldId: string, edn: string | null): Promise<void> {
    if (!guardSysWrite(fieldId)) return;
    const { planSetFieldTargetQuery } = await import("@/actions/plan");
    await applyPlan(planSetFieldTargetQuery(wire(), fieldId, edn));
  },

  async splitNode(id: string, cursor: number | "end"): Promise<void> {
    if (!guardSysWrite(id)) return;
    await prepareStructuralMutation();
    // Expanded set from the page's rows drives Tana first-child splits.
    const expandedIds = new Set<string>();
    for (const n of pageRows().values()) {
      if (!n.collapsed && !isSysPrefixed(n.id)) expandedIds.add(n.id);
    }
    await applyPlan(planSplit(wire(), id, cursor, ulid(), { expandedIds }));
  },

  async deleteNode(id: string): Promise<void> {
    if (!guardSysWrite(id)) return;
    await prepareStructuralMutation();
    await applyPlan(planDelete(wire(), id));
  },

  async mergeNextIntoThis(thisId: string, nextId: string): Promise<void> {
    if (!guardSysWrite(thisId) || !guardSysWrite(nextId)) return;
    await prepareStructuralMutation();
    const plan = planMergeInto(wire(), nextId, thisId);
    if (!plan) return;
    await applyPlan(plan);
  },

  async mergeWithPrevious(id: string, previousId: string | null = null): Promise<void> {
    if (!guardSysWrite(id)) return;
    await prepareStructuralMutation();
    let plan: PlannedMutation | null = null;
    if (previousId !== null && previousId !== id) plan = planMergeInto(wire(), id, previousId);
    if (!plan) plan = planMergeWithPrevious(wire(), id);
    await applyPlan(plan);
  },

  async indentNode(id: string, cursor?: number): Promise<void> {
    if (!guardSysWrite(id)) return;
    const store = useGraphStore.getState();
    const parent = findParentWire(store.wireNodes, id);
    const siblings = parent ? parent.children : forestRootIds(store.wireNodes);
    const idx = siblings.indexOf(id);
    if (idx <= 0) return;
    const prevId = siblings[idx - 1];
    if (prevId === undefined || !guardSysWrite(prevId)) return;

    const preWire = store.wireNodes;
    const plan = planIndent(preWire, id);
    if (!plan) return;
    const result = await runOptimistic(plan);
    if (!result.ok) return;
    recordHistory(preWire, plan);

    // D05: reveal the new parent chain before caret restore so the row is
    // guaranteed visible; focusSeq bump re-places the caret post-remount.
    editor().expandAncestors(id);
    // Its row where the page is being edited, under its new parent.
    editor().activateNode(id, cursor ?? 0);
  },

  async outdentNode(id: string, cursor?: number): Promise<void> {
    if (!guardSysWrite(id)) return;
    const store = useGraphStore.getState();
    const plan = planOutdent(store.wireNodes, id);
    if (!plan) return;
    const preWire = store.wireNodes;
    const result = await runOptimistic(plan);
    if (!result.ok) return;
    recordHistory(preWire, plan);
    editor().activateNode(id, cursor ?? 0);
  },

  async moveNodeUp(id: string): Promise<void> {
    if (!guardSysWrite(id)) return;
    await applyPlan(planMove(wire(), id, "up"));
  },

  async moveNodeDown(id: string): Promise<void> {
    if (!guardSysWrite(id)) return;
    await applyPlan(planMove(wire(), id, "down"));
  },

  async undo(): Promise<boolean> {
    const entry = useGraphStore.getState().applyUndo();
    if (!entry) return false;
    return invokeAll(entry.undo);
  },

  async redo(): Promise<boolean> {
    const entry = useGraphStore.getState().applyRedo();
    if (!entry) return false;
    return invokeAll(entry.redo);
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

  async removeProp(nodeId: string, fieldId: string, value?: PropValue): Promise<void> {
    if (!guardSysWrite(nodeId)) return;
    await applyPlan(planUnsetProp(wire(), nodeId, fieldId, value));
  },

  async createRefTarget(creation: RefCreation, name: string): Promise<string | null> {
    const id = ulid();
    if (creation.kind === "child") {
      return (await mutations.addChildNode(creation.parentId, name, id)) ? id : null;
    }
    if (!(await mutations.addRootNode(name, id))) return null;
    if (creation.kind === "tagged") await mutations.addTag(id, creation.tagId);
    return id;
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

  async makeSupertag(nodeId: string): Promise<boolean> {
    if (!guardSysWrite(nodeId)) return false;
    const node = wire().find((n) => n.id === nodeId);
    if (typeRefsOf(node).includes(SYSTEM_IDS.tag)) return true;
    return applyPlan(planAddTag(wire(), nodeId, SYSTEM_IDS.tag));
  },

  async defineTag(name: string): Promise<string | null> {
    const newId = ulid();
    const ok = await applyPlan(planDefineTag(name, newId));
    return ok ? newId : null;
  },

  async togglePin(nodeId: string): Promise<boolean> {
    const pins = pinnedRefIdsFor(shownNodes(), nodeId);
    if (pins.length > 0) {
      for (const refId of pins) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- Sequential by contract: each delete reads the store the last wrote
        await mutations.deleteNode(refId);
      }
      return true;
    }
    const plan = planPinNode(wire(), nodeId, ulid());
    if (plan === null) {
      toast("Pinned list is missing from this graph");
      return false;
    }
    return applyPlan(plan);
  },

  async uploadAsset(file: File): Promise<string | null> {
    const store = useGraphStore.getState();
    if (store.loadSource === "fixtures" || store.loadSource === null) {
      toast("Cannot upload assets without a live kb server");
      return null;
    }
    // Refused before it is read: reading and encoding a huge file would freeze the tab.
    if (file.size > ASSET_MAX_BYTES) {
      toast(
        `${file.name} is too large to store (${mb(file.size)}; at most ${mb(ASSET_MAX_BYTES)})`,
      );
      return null;
    }
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const byte of buf) binary += String.fromCharCode(byte);
      const bytes = btoa(binary);
      const receipt = await invoke("asset.upload", {
        bytes,
        filename: file.name,
      });
      if (receipt.status === "failed") {
        toast(receipt.message);
        return null;
      }
      const out = AssetUploadOutputSchema.safeParse(receipt.output);
      if (!out.success) {
        toast("asset.upload returned no path");
        return null;
      }
      return out.data.path;
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
      return null;
    }
  },

  async attachFileToNode(nodeId: string, file: File): Promise<boolean> {
    if (!guardSysWrite(nodeId)) return false;
    const path = await mutations.uploadAsset(file);
    if (path === null) return false;
    try {
      // The whole graph, not the projection: the row may be a reference whose
      // target sits outside the current scope, and its text must not be read
      // as empty and overwritten.
      const node = useGraphStore.getState().wireNodes.find((n) => n.id === nodeId);
      const alt = file.name.replace(/\.[^.]+$/, "") || "file";
      const md = `![${alt}](${path})`;
      const next =
        node === undefined || node.text.trim() === ""
          ? md
          : `${node.text}${node.text.endsWith("\n") ? "" : "\n"}${md}`;
      await mutations.updateNodeContent(nodeId, next);
      return true;
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
      return false;
    }
  },

  async newQueryNode(text = "New query"): Promise<string | null> {
    const newId = ulid();
    const ok = await applyPlan(planNewQueryNode(text, newId));
    return ok ? newId : null;
  },

  // ── ontology mutations (r5 core) ────────────────────────────────────────

  async defineOntology(name = "New ontology"): Promise<string | null> {
    const newId = ulid();
    const { planDefineOntology } = await import("@/actions/plan");
    const ok = await applyPlan(planDefineOntology(name, newId));
    return ok ? newId : null;
  },

  async ontologyAddInclude(ontoId: string, tagId: string): Promise<void> {
    if (!guardSysWrite(ontoId)) return;
    const { planOntologyAddInclude } = await import("@/actions/plan");
    await applyPlan(planOntologyAddInclude(wire(), ontoId, tagId));
  },

  async ontologyRemoveInclude(ontoId: string, tagId: string): Promise<void> {
    if (!guardSysWrite(ontoId)) return;
    const { planOntologyRemoveInclude } = await import("@/actions/plan");
    await applyPlan(planOntologyRemoveInclude(wire(), ontoId, tagId));
  },

  async ontologyAddMember(ontoId: string, nodeId: string): Promise<void> {
    if (!guardSysWrite(ontoId)) return;
    const { planOntologyAddMember } = await import("@/actions/plan");
    await applyPlan(planOntologyAddMember(wire(), ontoId, nodeId));
  },

  async ontologyRemoveMember(ontoId: string, nodeId: string): Promise<void> {
    if (!guardSysWrite(ontoId)) return;
    const { planOntologyRemoveMember } = await import("@/actions/plan");
    await applyPlan(planOntologyRemoveMember(wire(), ontoId, nodeId));
  },

  async ontologyExclude(ontoId: string, nodeId: string): Promise<void> {
    if (!guardSysWrite(ontoId)) return;
    const { planOntologyExclude } = await import("@/actions/plan");
    await applyPlan(planOntologyExclude(wire(), ontoId, nodeId));
  },

  async ontologyUnexclude(ontoId: string, nodeId: string): Promise<void> {
    if (!guardSysWrite(ontoId)) return;
    const { planOntologyUnexclude } = await import("@/actions/plan");
    await applyPlan(planOntologyUnexclude(wire(), ontoId, nodeId));
  },

  async ontologyAddExtends(ontoId: string, parentId: string): Promise<boolean> {
    if (!guardSysWrite(ontoId)) return false;
    const { planOntologyAddExtends } = await import("@/actions/plan");
    const plan = planOntologyAddExtends(wire(), ontoId, parentId);
    if (!plan) {
      toast("That would make an ontology extend itself");
      return false;
    }
    return applyPlan(plan);
  },

  async ontologyRemoveExtends(ontoId: string, parentId: string): Promise<void> {
    if (!guardSysWrite(ontoId)) return;
    const { planOntologyRemoveExtends } = await import("@/actions/plan");
    await applyPlan(planOntologyRemoveExtends(wire(), ontoId, parentId));
  },

  async ontologySetQuery(ontoId: string, edn: string): Promise<void> {
    if (!guardSysWrite(ontoId)) return;
    const { planOntologySetQuery } = await import("@/actions/plan");
    await applyPlan(planOntologySetQuery(wire(), ontoId, edn));
  },

  async ontologySetClosure(ontoId: string, mode: "none" | "descendants"): Promise<void> {
    if (!guardSysWrite(ontoId)) return;
    const { planOntologySetClosure } = await import("@/actions/plan");
    await applyPlan(planOntologySetClosure(wire(), ontoId, mode));
  },

  async makeDefaultView(hostId: string, viewId: string): Promise<void> {
    if (!guardSysWrite(hostId)) return;
    const { planMakeDefaultView } = await import("@/actions/plan");
    await applyPlan(planMakeDefaultView(wire(), hostId, viewId));
  },

  async setFrameView(frameId: string, view: FrameViewKey): Promise<void> {
    const { frameViewIs } = await import("@/actions/plan");
    await editFrameView(frameId, frameViewIs(view.option));
  },

  async addViewNode(text: string, props: Record<string, PropValue[]>): Promise<string | null> {
    const { planAddViewNode } = await import("@/actions/plan");
    const id = ulid();
    const plan = planAddViewNode(wire(), id, text, props);
    return plan !== null && (await applyPlan(plan)) ? id : null;
  },

  async replaceField(nodeId: string, fieldId: string, values: PropValue[]): Promise<void> {
    if (!guardSysWrite(nodeId)) return;
    const { planReplaceField } = await import("@/actions/plan");
    await applyPlan(planReplaceField(wire(), nodeId, fieldId, values));
  },

  // A frame's view settings are its frame view node's params: each edit
  // below writes that node (`editFrameView`), never the frame's own props.

  async setViewSort(frameId: string, sortSpecs: SortSpec[]): Promise<void> {
    const { frameViewSort } = await import("@/actions/plan");
    await editFrameView(frameId, frameViewSort(sortSpecs));
  },

  async toggleViewSort(frameId: string, fieldId: string): Promise<void> {
    const current = (await frameConfig(frameId)).sort;
    const existingIndex = current.findIndex((s) => s.fieldId === fieldId);

    let nextSort: SortSpec[];
    if (existingIndex === -1) {
      nextSort = [{ fieldId, dir: "asc" }, ...current];
    } else if (current[existingIndex]?.dir === "asc") {
      nextSort = current.map((s, i) => (i === existingIndex ? { ...s, dir: "desc" as const } : s));
    } else {
      nextSort = current.filter((s) => s.fieldId !== fieldId);
    }

    const { frameViewSort } = await import("@/actions/plan");
    await editFrameView(frameId, frameViewSort(nextSort));
  },

  async setViewDisplay(frameId: string, displayFieldIds: string[]): Promise<void> {
    const { frameViewDisplay } = await import("@/actions/plan");
    await editFrameView(frameId, frameViewDisplay(displayFieldIds));
  },

  async setColumnWidth(frameId: string, fieldId: string, widthPx: number): Promise<void> {
    const nextColwidth = { ...(await frameConfig(frameId)).colwidth, [fieldId]: widthPx };
    const { frameViewColwidth } = await import("@/actions/plan");
    await editFrameView(frameId, frameViewColwidth(nextColwidth));
  },

  async setViewPagesize(frameId: string, pagesize: number): Promise<void> {
    const { frameViewPagesize } = await import("@/actions/plan");
    await editFrameView(frameId, frameViewPagesize(pagesize));
  },

  async setViewGroup(frameId: string, fieldId: string | null): Promise<void> {
    const { frameViewGroup } = await import("@/actions/plan");
    await editFrameView(frameId, frameViewGroup(fieldId));
  },

  async addViewFilter(frameId: string, edn: string): Promise<void> {
    const { serializeViewFilter, parseViewFilterEdn } = await import("@kb/views");
    const parsed = parseViewFilterEdn(edn);
    if (!parsed) {
      toast(`Bad filter EDN: ${edn}`);
      return;
    }
    // A new filter is stored in its canonical form, not as it was typed.
    const next = [
      ...(await frameConfig(frameId)).filters,
      { ...parsed, raw: serializeViewFilter(parsed) },
    ];
    const { frameViewFilters } = await import("@/actions/plan");
    await editFrameView(frameId, frameViewFilters(next));
  },

  async removeViewFilter(frameId: string, edn: string): Promise<void> {
    const { serializeViewFilter } = await import("@kb/views");
    const next = (await frameConfig(frameId)).filters.filter(
      (f) => (f.raw || serializeViewFilter(f)) !== edn,
    );
    const { frameViewFilters } = await import("@/actions/plan");
    await editFrameView(frameId, frameViewFilters(next));
  },

  async moveBoardCard(
    nodeId: string,
    fieldId: string,
    oldValue: PropValue | null,
    newValue: PropValue | null,
  ): Promise<void> {
    if (!guardSysWrite(nodeId)) return;
    const { planMoveBoardCard } = await import("@/actions/plan");
    await applyPlan(planMoveBoardCard(wire(), nodeId, fieldId, oldValue, newValue));
  },
};
