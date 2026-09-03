/**
 * Mutation action layer — optimistic local tx → POST /api/action.
 */
import { ulid } from "ulid";
import type { FieldType } from "@kb/model";
import type { SortSpec, ViewMode } from "@/lib/view-config";
import { postAction } from "@/api/action";
import { fetchGraphSnapshot } from "@/api/graph";
import { runOptimistic } from "@/actions/optimistic";
import {
  inversePlanActions,
  invertPlan,
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
  planPrependChild,
  planRemoveTag,
  planSetProp,
  planSplit,
  planUnsetProp,
  planUpdateText,
  type PlannedMutation,
} from "@/actions/plan";
import { findPinnedTagId, pinnedTagIdsOn, PINNED_TAG_TEXT } from "@/lib/pinned";
import { toast } from "@/lib/toast";
import { isSysPrefixed, SYSTEM_IDS, WORKSPACE_ROOT_ID, type PropValue } from "@/lib/types";
import { forestRootIds } from "@/lib/graph-view";
import { outlineInstanceKey } from "@/lib/instance-key";
import { cloneWire, findParentWire } from "@/lib/tx";
import type { WireNode } from "@kb/contracts";
import { typeRefsOf } from "@kb/model";
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

/** Capture an undo entry against pre-state after a successful apply (D19). */
function recordHistory(preWire: WireNode[], plan: PlannedMutation): void {
  const inv = invertPlan(preWire, plan);
  useOutlineStore.getState().recordUndo({
    inv,
    actions: inversePlanActions(preWire, plan, inv),
  });
}

/** Best-effort remote sync for undo/redo compensating actions. */
async function postCompensations(actions: Array<{ id: string; input: unknown }>): Promise<void> {
  const source = useOutlineStore.getState().loadSource;
  if (source !== "api") return;
  for (const action of actions) {
    try {
      await postAction(action.id, action.input);
    } catch {
      // Server resync (WS / next refetch) heals divergence; never block UI.
      return;
    }
  }
}

async function applyPlan(plan: PlannedMutation | null): Promise<boolean> {
  if (!plan) return false;
  const preWire = useOutlineStore.getState().wireNodes;
  const result = await runOptimistic(plan);
  if (result.ok) recordHistory(preWire, plan);
  return result.ok;
}

type PendingContent = {
  text: string;
  /** Pre-edit wire node for this id only — never a whole-graph snapshot. */
  preEdit: WireNode;
  timer: ReturnType<typeof setTimeout>;
};

const pendingContent = new Map<string, PendingContent>();

/** Remote deltas retain a newer local text buffer until its FIFO flush lands. */
export function mergeRemoteUpserts(upserts: WireNode[]): WireNode[] {
  return upserts.map((remote) => {
    const pending = pendingContent.get(remote.id);
    return pending ? { ...remote, text: pending.text } : remote;
  });
}
/**
 * Remote text writes have a deliberately small owner.  The old debounce map
 * captured a string in the timer closure, which meant a structural write
 * could overtake it (or, worse, be followed by it).  Keep one promise tail
 * per node instead: a node's writes are FIFO, while unrelated nodes are free
 * to flush concurrently.
 */
const contentTails = new Map<string, Promise<void>>();

function enqueueContent(id: string, task: () => Promise<void>): Promise<void> {
  const previous = contentTails.get(id) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  contentTails.set(id, next);
  void next.finally(() => {
    if (contentTails.get(id) === next) contentTails.delete(id);
  });
  return next;
}

/**
 * Re-apply every newer pending local text edit after a resync wipe.
 * Node-local and independent: missing or unplannable ids are pruned and
 * skipped so one failure never aborts the rest of the batch.
 * Do not exclude the failed flush id — its map entry was already removed at
 * timer fire, and any same-id entry present now is a newer in-flight re-edit.
 */
function reapplyPendingLocalEdits(): void {
  for (const [id, pending] of Array.from(pendingContent)) {
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
 * Prefer a strict server resync (never demo fixtures), then restore only the
 * failed node's pre-edit state if resync itself fails — never hydrateFromWire
 * mid-session and never flip loadSource to fixtures.
 * Concurrent pending edits (including a same-node re-edit made during the
 * in-flight resync) are re-applied afterward.
 */
async function resyncOrRestoreNode(preEdit: WireNode): Promise<void> {
  const store = useOutlineStore.getState();
  try {
    const fresh = await fetchGraphSnapshot();
    store.refreshFromWire(fresh.nodes, fresh.rev);
  } catch {
    useOutlineStore.getState().applyTx([cloneWire(preEdit)], []);
  }
  reapplyPendingLocalEdits();
}

async function flushContentRemote(id: string, content: string, preEdit: WireNode): Promise<void> {
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

/** Flush the current coalesced value, not the value from when its timer armed. */
function flushPendingContent(id: string, pending: PendingContent): Promise<void> {
  clearTimeout(pending.timer);
  // A newer keystroke may already have replaced this entry.  Only the entry
  // being flushed is removed; the newer one remains queued behind it.
  if (pendingContent.get(id) === pending) pendingContent.delete(id);
  return enqueueContent(id, () => flushContentRemote(id, pending.text, pending.preEdit));
}

/**
 * Structural plans must be made only after the server has seen the text that
 * their offsets/merges operate on.  Delete is the exception: unsent text is
 * discarded, and an already-sent write is awaited so the subsequent delete is
 * its compensating operation on that node's FIFO.
 */
async function prepareStructuralMutation(deleteIds: readonly string[] = []): Promise<void> {
  const deleting = new Set(deleteIds);
  const flushes: Promise<void>[] = [];
  for (const [id, pending] of Array.from(pendingContent)) {
    if (deleting.has(id)) {
      clearTimeout(pending.timer);
      if (pendingContent.get(id) === pending) pendingContent.delete(id);
      continue;
    }
    flushes.push(flushPendingContent(id, pending));
  }
  await Promise.all(flushes);
  // If a text POST was already in flight for a deleting node, wait for it
  // before the delete action is planned/sent.  This is conservative (global
  // structural flushing) but gives every touched node a strict FIFO.
  await Promise.all([...deleting].map((id) => contentTails.get(id) ?? Promise.resolve()));
}

/** @internal Clear debounce map between tests. */
export function __resetPendingContentForTests(): void {
  for (const pending of pendingContent.values()) clearTimeout(pending.timer);
  pendingContent.clear();
  contentTails.clear();
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

  /**
   * Tana transient create (r1 §3.3): mint a REAL empty node immediately
   * (root, first child, or after sibling), mark it auto-prune candidate,
   * and activate it at offset 0. Replaces the detached ghost row entirely.
   */
  async createTransientNode(
    parentId: string,
    afterSiblingId: string | null,
  ): Promise<string | null> {
    const newId = ulid();
    let ok = false;
    if (parentId === WORKSPACE_ROOT_ID) {
      ok = await applyPlan(planAddRootNode("", newId));
    } else if (afterSiblingId) {
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
    useOutlineStore.getState().markTransient(newId);
    // F4: single activation via runOptimistic — no post-await re-activation.
    return newId;
  },

  /** Create a sibling directly ABOVE the anchor and activate it ('O' key). */
  async createNodeBefore(beforeId: string): Promise<string | null> {
    if (!guardSysWrite(beforeId)) return null;
    const parent = findParentWire(wire(), beforeId);
    if (!parent) {
      return mutations.createTransientNode(WORKSPACE_ROOT_ID, beforeId);
    }
    if (!guardSysWrite(parent.id)) return null;
    const siblings = parent.children;
    const idx = siblings.indexOf(beforeId);
    const prevSibling = idx > 0 ? siblings[idx - 1]! : null;
    const newId = ulid();
    let plan: PlannedMutation | null;
    if (prevSibling) {
      plan = planInsertSibling(wire(), prevSibling, "after", newId);
    } else {
      plan = planPrependChild(wire(), parent.id, newId);
    }
    const ok = await applyPlan(plan);
    if (!ok) return null;
    useOutlineStore.getState().markTransient(newId);
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

  async splitNode(id: string, cursor: number): Promise<void> {
    if (!guardSysWrite(id)) return;
    await prepareStructuralMutation();
    const store = useOutlineStore.getState();
    // Expanded set from the UI outline map drives Tana first-child splits.
    const expandedIds = new Set<string>();
    for (const n of store.nodes.values()) {
      if (!n.collapsed && !isSysPrefixed(n.id)) expandedIds.add(n.id);
    }
    await applyPlan(planSplit(wire(), id, cursor, ulid(), { expandedIds }));
  },

  async deleteNode(id: string): Promise<void> {
    if (!guardSysWrite(id)) return;
    await prepareStructuralMutation([id]);
    await applyPlan(planDelete(wire(), id));
  },

  /**
   * Backspace-merge. When the caller has render context it passes
   * instanceKey so the target resolves through the VISIBLE tree (r1 D09):
   * a preceding sibling with expanded children merges into its deepest
   * last descendant — what the user sees directly above the caret.
   */
  async mergeNextIntoThis(thisId: string, nextId: string): Promise<void> {
    if (!guardSysWrite(thisId) || !guardSysWrite(nextId)) return;
    await prepareStructuralMutation([nextId]);
    const plan = planMergeInto(wire(), nextId, thisId);
    if (!plan) return;
    await applyPlan(plan);
  },

  async mergeWithPrevious(id: string, instanceKey?: string): Promise<void> {
    if (!guardSysWrite(id)) return;
    await prepareStructuralMutation([id]);
    let plan: PlannedMutation | null = null;
    if (instanceKey) {
      const prevInst = useOutlineStore.getState().getPreviousVisibleInstance(instanceKey);
      if (prevInst && prevInst.nodeId !== id) {
        plan = planMergeInto(wire(), id, prevInst.nodeId);
      }
    }
    if (!plan) plan = planMergeWithPrevious(wire(), id);
    await applyPlan(plan);
  },

  /**
   * Tab-indent. The target parent is auto-expanded BEFORE focus restore so
   * the reparented row never vanishes into a collapsed container (r1 D05),
   * and the caret returns to its exact character offset (spec §3.1).
   */
  async indentNode(id: string, cursor?: number): Promise<void> {
    if (!guardSysWrite(id)) return;
    const store = useOutlineStore.getState();
    const parent = findParentWire(store.wireNodes, id);
    const siblings = parent ? parent.children : forestRootIds(store.wireNodes);
    const idx = siblings.indexOf(id);
    if (idx <= 0) return;
    const prevId = siblings[idx - 1]!;
    if (!guardSysWrite(prevId)) return;

    const preWire = store.wireNodes;
    const plan = planIndent(preWire, id);
    if (!plan) return;
    const result = await runOptimistic(plan);
    if (!result.ok) return;
    recordHistory(preWire, plan);

    // D05: reveal the new parent chain before caret restore so the row is
    // guaranteed visible; focusSeq bump re-places the caret post-remount.
    const next = useOutlineStore.getState();
    next.expandAncestors(id);
    const key = outlineInstanceKey(id, useOutlineStore.getState().nodes);
    useOutlineStore.getState().activateNode(id, cursor ?? 0, key);
  },

  /** Shift+Tab outdent; caret stays at its exact offset (spec §3.1). */
  async outdentNode(id: string, cursor?: number): Promise<void> {
    if (!guardSysWrite(id)) return;
    const store = useOutlineStore.getState();
    const plan = planOutdent(store.wireNodes, id);
    if (!plan) return;
    const preWire = store.wireNodes;
    const result = await runOptimistic(plan);
    if (!result.ok) return;
    recordHistory(preWire, plan);
    const key = outlineInstanceKey(id, useOutlineStore.getState().nodes);
    useOutlineStore.getState().activateNode(id, cursor ?? 0, key);
  },

  async moveNodeUp(id: string): Promise<void> {
    if (!guardSysWrite(id)) return;
    await applyPlan(planMove(wire(), id, "up"));
  },

  async moveNodeDown(id: string): Promise<void> {
    if (!guardSysWrite(id)) return;
    await applyPlan(planMove(wire(), id, "down"));
  },

  /** D19: undo the last structural mutation (local inverse + remote sync). */
  async undo(): Promise<boolean> {
    const entry = useOutlineStore.getState().applyUndo();
    if (!entry) return false;
    await postCompensations(entry.actions);
    return true;
  },

  /** D19: redo the last undone mutation. */
  async redo(): Promise<boolean> {
    const entry = useOutlineStore.getState().applyRedo();
    if (!entry) return false;
    await postCompensations(entry.actions);
    return true;
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

  /**
   * Promote an existing node to a supertag.
   *
   * `sys.f.type` is the kind slot and it is multi-valued, so this appends the
   * `sys.tag` kind and leaves any tags the node already carries alone. Note
   * the consequence, which is the model's and not this function's: a tag node
   * is schema, so `forestRootIds` stops listing it in the outline forest. The
   * caller is responsible for taking the user to it.
   */
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

  /**
   * Pin / unpin a node for the sidebar's Pinned section.
   *
   * Pinning is tagging (see lib/pinned): the toggle is `addTag`/`removeTag`
   * over the `pinned` tag, and nothing here is bespoke. The tag is minted on
   * first use through the same `defineTag` the ⌘K picker's "Create tag" path
   * uses, which is why no `sys.tag.pinned` needs seeding.
   */
  async togglePin(nodeId: string): Promise<boolean> {
    if (!guardSysWrite(nodeId)) return false;
    const nodes = useOutlineStore.getState().nodes;
    const carried = pinnedTagIdsOn(nodes.get(nodeId), nodes);
    if (carried.length > 0) {
      for (const tagId of carried) await mutations.removeTag(nodeId, tagId);
      return true;
    }
    const existing = findPinnedTagId(nodes);
    const tagId = existing ?? (await mutations.defineTag(PINNED_TAG_TEXT));
    if (!tagId) return false;
    await mutations.addTag(nodeId, tagId);
    return true;
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

  // ── ontology mutations (r5 core) ────────────────────────────────────────

  /** Mint an ontology node (#ontology) and return its id. */
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

  /** Veto a node; drops a matching pin in the same plan. */
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

  /** Refuses (and says so) when the edge would close an extends cycle. */
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

  async setViewMode(frameId: string, mode: ViewMode): Promise<void> {
    if (!guardSysWrite(frameId)) return;
    const { planSetViewMode } = await import("@/actions/plan");
    await applyPlan(planSetViewMode(wire(), frameId, mode));
  },

  async setLensRenderer(perspectiveId: string, renderer: string): Promise<void> {
    if (!guardSysWrite(perspectiveId)) return;
    const { planSetLensRenderer } = await import("@/actions/plan");
    await applyPlan(planSetLensRenderer(wire(), perspectiveId, renderer));
  },

  /**
   * Persist a `sys.f.lens.*` prop. Unsets the field before set so multi-valued
   * append cannot accumulate (r10 §1.6).
   */
  async setLensProp(perspectiveId: string, fieldId: string, value: PropValue): Promise<void> {
    if (!guardSysWrite(perspectiveId)) return;
    const { planSetLensProp } = await import("@/actions/plan");
    await applyPlan(planSetLensProp(wire(), perspectiveId, fieldId, value));
  },

  async setViewSort(frameId: string, sortSpecs: SortSpec[]): Promise<void> {
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

    let nextSort: SortSpec[];
    if (existingIndex === -1) {
      nextSort = [{ fieldId, dir: "asc" }, ...current];
    } else if (current[existingIndex]?.dir === "asc") {
      nextSort = current.map((s, i) => (i === existingIndex ? { ...s, dir: "desc" as const } : s));
    } else {
      nextSort = current.filter((s) => s.fieldId !== fieldId);
    }

    const { planSetViewSort } = await import("@/actions/plan");
    await applyPlan(planSetViewSort(wire(), frameId, nextSort));
  },

  async setViewDisplay(frameId: string, displayFieldIds: string[]): Promise<void> {
    if (!guardSysWrite(frameId)) return;
    const { planSetViewDisplay } = await import("@/actions/plan");
    await applyPlan(planSetViewDisplay(wire(), frameId, displayFieldIds));
  },

  async setColumnWidth(frameId: string, fieldId: string, widthPx: number): Promise<void> {
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

  async setViewGroup(frameId: string, fieldId: string | null): Promise<void> {
    if (!guardSysWrite(frameId)) return;
    const { planSetViewGroup } = await import("@/actions/plan");
    await applyPlan(planSetViewGroup(wire(), frameId, fieldId));
  },

  async setViewFilters(frameId: string, filterEdnList: string[]): Promise<void> {
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
    const { getViewConfig, serializeViewFilter } = await import("@/lib/view-config");
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
    oldValue: PropValue | null,
    newValue: PropValue | null,
  ): Promise<void> {
    if (!guardSysWrite(nodeId)) return;
    const { planMoveBoardCard } = await import("@/actions/plan");
    await applyPlan(planMoveBoardCard(wire(), nodeId, fieldId, oldValue, newValue));
  },
};

export type Mutations = typeof mutations;
