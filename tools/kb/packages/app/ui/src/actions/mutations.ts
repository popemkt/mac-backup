/**
 * Mutation action layer — optimistic local tx → POST /api/action.
 */
import { ulid } from "ulid";
import { z } from "zod";
import type { LensPerspective, FrameViewKey, SortSpec, ViewConfig } from "@kb/views";
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
import { pinnedRefIdsFor } from "@/lib/pinned";
import type { RefCreation } from "@/lib/refs";
import { toast } from "@/lib/toast";

/** `asset.upload` answers with the repo-relative path it stored the bytes at. */
const AssetUploadOutputSchema = z.object({ path: z.string() });

import { isSysPrefixed, SYSTEM_IDS, WORKSPACE_ROOT_ID, type PropValue } from "@/lib/types";
import { forestRootIds } from "@/lib/graph-view";
import { findParentWire } from "@/lib/tx";
import { restoreInvocations } from "@/actions/restore";
import type { WireNode } from "@kb/contracts";
import { typeRefsOf } from "@kb/model";
import { useOutlineStore } from "@/stores/outline.store"; // GAP [[01M1RXMRB7AZB7DPFR6XBPBKQ9]]
import { invoke, invokeLocal, pushInvocation, writeLocal } from "@/session/runtime";
import type { Hold } from "@/session/replica";

function wire(): WireNode[] {
  return useOutlineStore.getState().wireNodes;
}

/** Block edits on sys.* in the UI with a toast (core also enforces). */
function guardSysWrite(id: string): boolean {
  if (!isSysPrefixed(id)) return true;
  toast("System nodes (sys.*) are read-only");
  return false;
}

function recordHistory(preWire: WireNode[], plan: PlannedMutation): void {
  useOutlineStore.getState().recordUndo({
    undo: restoreInvocations(wire(), preWire),
    redo: plan.actions,
  });
}

async function invokeAll(actions: Array<{ id: string; input: unknown }>): Promise<boolean> {
  const localOnly = useOutlineStore.getState().loadSource !== "api";
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
  const preWire = useOutlineStore.getState().wireNodes;
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
  const state = useOutlineStore.getState();
  const { frameConfigOf } = await import("@/lib/view-config");
  const { schemaOf } = await import("@/lib/schema");
  return frameConfigOf(state.nodes.get(frameId), schemaOf(state));
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
  const store = useOutlineStore.getState();
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

export const mutations = {
  /** Local text action first; coalesce its ordered remote confirmation. */
  async updateNodeContent(id: string, content: string): Promise<void> {
    if (!guardSysWrite(id)) return;

    const store = useOutlineStore.getState();
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

  async splitNode(id: string, cursor: number | "end"): Promise<void> {
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
    await prepareStructuralMutation();
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
    await prepareStructuralMutation();
    const plan = planMergeInto(wire(), nextId, thisId);
    if (!plan) return;
    await applyPlan(plan);
  },

  async mergeWithPrevious(id: string, instanceKey?: string): Promise<void> {
    if (!guardSysWrite(id)) return;
    await prepareStructuralMutation();
    let plan: PlannedMutation | null = null;
    if (instanceKey !== undefined) {
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
    const next = useOutlineStore.getState();
    next.expandAncestors(id);
    // Its row in the outline being worked in, under its new parent.
    useOutlineStore.getState().activateNode(id, cursor ?? 0);
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
    useOutlineStore.getState().activateNode(id, cursor ?? 0);
  },

  async moveNodeUp(id: string): Promise<void> {
    if (!guardSysWrite(id)) return;
    await applyPlan(planMove(wire(), id, "up"));
  },

  async moveNodeDown(id: string): Promise<void> {
    if (!guardSysWrite(id)) return;
    await applyPlan(planMove(wire(), id, "down"));
  },

  /** D19: undo through inverse invocations of the same shared actions. */
  async undo(): Promise<boolean> {
    const entry = useOutlineStore.getState().applyUndo();
    if (!entry) return false;
    return invokeAll(entry.undo);
  },

  /** D19: redo the last undone mutation. */
  async redo(): Promise<boolean> {
    const entry = useOutlineStore.getState().applyRedo();
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

  /**
   * Mint a node a ref field may point at, named `name`, where the field's
   * declaration says a new target goes (`refCreationOf`): a child of the
   * field for an option, a node carrying the field's target tag, or a
   * top-level node for an open field. Returns its id, or null when refused.
   */
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
   * Pinning is *listing* (see lib/pinned): the toggle adds or removes a
   * contextual reference under the seeded `pinned` node, and nothing here is
   * bespoke — `node.add` with one ref prop, `deleteNode` for the row.
   *
   * No `guardSysWrite` on the target: nothing is written to it. The guard was
   * there because a tag edits the node's kind slot, so pinning `sys.queries`
   * was a write to a system node; pointing a reference at one is not, and
   * `sys.*` browse has always been open.
   */
  async togglePin(nodeId: string): Promise<boolean> {
    const nodes = useOutlineStore.getState().nodes;
    const pins = pinnedRefIdsFor(nodes, nodeId);
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
      for (const byte of buf) binary += String.fromCharCode(byte);
      const bytes = btoa(binary);
      const receipt = await invoke("asset.upload", {
        bytes,
        filename: file.name,
      });
      if (receipt.status === "failed") {
        toast(receipt.message);
        return false;
      }
      const out = AssetUploadOutputSchema.safeParse(receipt.output);
      if (!out.success) {
        toast("asset.upload returned no path");
        return false;
      }
      // The whole graph, not the projection: the row may be a reference whose
      // target sits outside the current scope, and its text must not be read
      // as empty and overwritten.
      const node = useOutlineStore.getState().wireNodes.find((n) => n.id === nodeId);
      const alt = file.name.replace(/\.[^.]+$/, "") || "file";
      const md = `![${alt}](${out.data.path})`;
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

  /** Make `viewId` `hostId`'s default view: move it first in the host's `sys.f.views`. */
  async makeDefaultView(hostId: string, viewId: string): Promise<void> {
    if (!guardSysWrite(hostId)) return;
    const { planMakeDefaultView } = await import("@/actions/plan");
    await applyPlan(planMakeDefaultView(wire(), hostId, viewId));
  },

  /** Show a frame's children in `view`: its frame view node names the view's option. */
  async setFrameView(frameId: string, view: FrameViewKey): Promise<void> {
    const { frameViewIs } = await import("@/actions/plan");
    await editFrameView(frameId, frameViewIs(view.option));
  },

  /** Save `perspective` as a new graph view node, filed in the Views list. */
  async saveGraphPerspective(perspective: LensPerspective, name: string): Promise<string | null> {
    const { perspectiveProps } = await import("@kb/views");
    const { planAddViewNode } = await import("@/actions/plan");
    const id = ulid();
    const plan = planAddViewNode(
      wire(),
      id,
      name.trim() || "Graph perspective",
      perspectiveProps(perspective),
    );
    return plan !== null && (await applyPlan(plan)) ? id : null;
  },

  async replaceField(nodeId: string, fieldId: string, values: PropValue[]): Promise<void> {
    if (!guardSysWrite(nodeId)) return;
    const { planReplaceField } = await import("@/actions/plan");
    await applyPlan(planReplaceField(wire(), nodeId, fieldId, values));
  },

  /** Draw a graph view node with another renderer: `renderer` is the view's option. */
  async setGraphRenderer(perspectiveId: string, renderer: string): Promise<void> {
    if (!guardSysWrite(perspectiveId)) return;
    const { planSetGraphRenderer } = await import("@/actions/plan");
    await applyPlan(planSetGraphRenderer(wire(), perspectiveId, renderer));
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

export type Mutations = typeof mutations;
