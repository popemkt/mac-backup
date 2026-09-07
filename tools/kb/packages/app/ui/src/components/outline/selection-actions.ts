/**
 * What each selection action does, one named step per action type.
 *
 * The mapper decides *which* action a chord means; this decides *what* the
 * action does. Keeping them apart is what lets the chord table be tested as
 * data and the store choreography — parent lookup plus scroll, create-after
 * placement, the delete's focus hand-off — be read and tested as steps.
 *
 * Exhaustiveness is the mapped type: a new `SelectionKeyAction` variant with
 * no row here fails the build, so adding an action adds a row rather than a
 * branch.
 */
import { mutations } from "@/actions/mutations";
import type { SelectionKeyAction } from "@/lib/selection-keymap";
import { WORKSPACE_ROOT_ID } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";

type ActionOf<T extends SelectionKeyAction["type"]> = Extract<SelectionKeyAction, { type: T }>;

type SelectionSteps = {
  [T in SelectionKeyAction["type"]]: (action: ActionOf<T>) => void;
};

function scrollRowIntoView(nodeId: string): void {
  requestAnimationFrame(() => {
    document
      .querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  });
}

function selectParent({ nodeId }: ActionOf<"selectParent">): void {
  const store = useOutlineStore.getState();
  const parent = store.nodes.get(nodeId)?.parentId ?? null;
  if (parent === null) return;
  store.selectNode(parent);
  scrollRowIntoView(parent);
}

function selectFirstChild({ nodeId }: ActionOf<"selectFirstChild">): void {
  const store = useOutlineStore.getState();
  const first = store.nodes.get(nodeId)?.children[0];
  if (first !== undefined) store.selectNode(first);
}

/** 'o': directly below = first child when expanded, else next sibling (D07). */
function createAfter({ nodeId }: ActionOf<"createAfter">): void {
  const node = useOutlineStore.getState().nodes.get(nodeId);
  const expanded = Boolean(node && !node.collapsed && node.children.length > 0);
  if (expanded) {
    void mutations.createTransientNode(nodeId, null);
    return;
  }
  void mutations.createTransientNode(node?.parentId ?? WORKSPACE_ROOT_ID, nodeId);
}

/** A printable character: activate at text end with the character appended. */
function append({ nodeId, instanceKey, char }: ActionOf<"append">): void {
  const store = useOutlineStore.getState();
  const nextText = (store.nodes.get(nodeId)?.text ?? "") + char;
  store.activateNode(nodeId, nextText.length, instanceKey);
  void mutations.updateNodeContent(nodeId, nextText);
}

/** Delete, then take the focus to the previous visible row, else the next. */
function deleteRow({ nodeId, instanceKey }: ActionOf<"delete">): void {
  const store = useOutlineStore.getState();
  const prev = store.getPreviousVisibleInstance(instanceKey);
  const next = store.getNextVisibleInstance(instanceKey);
  void mutations.deleteNode(nodeId).then(() => {
    const pick = prev ?? next;
    if (pick) {
      useOutlineStore.getState().selectNode(pick.nodeId, pick.instanceKey);
      return;
    }
    useOutlineStore.getState().selectNode(null);
  });
}

const SELECTION_STEPS: SelectionSteps = {
  select: ({ nodeId, instanceKey }) => useOutlineStore.getState().selectNode(nodeId, instanceKey),
  clear: () => useOutlineStore.getState().selectNode(null),
  edit: ({ nodeId, instanceKey }) =>
    useOutlineStore.getState().activateNode(nodeId, 0, instanceKey),
  // Three chords, one gesture: ArrowLeft and ArrowRight only reach these rows
  // when the toggle would move in their direction.
  toggleCollapse: ({ nodeId }) => useOutlineStore.getState().toggleCollapse(nodeId),
  collapse: ({ nodeId }) => useOutlineStore.getState().toggleCollapse(nodeId),
  expand: ({ nodeId }) => useOutlineStore.getState().toggleCollapse(nodeId),
  selectParent,
  selectFirstChild,
  indent: ({ nodeId }) => void mutations.indentNode(nodeId),
  outdent: ({ nodeId }) => void mutations.outdentNode(nodeId),
  moveUp: ({ nodeId }) => void mutations.moveNodeUp(nodeId),
  moveDown: ({ nodeId }) => void mutations.moveNodeDown(nodeId),
  zoom: ({ nodeId }) => useOutlineStore.getState().zoomTo(nodeId),
  createAfter,
  createBefore: ({ nodeId }) => void mutations.createNodeBefore(nodeId),
  append,
  delete: deleteRow,
};

/**
 * Run the step for `action`.
 *
 * The generic key is what makes the indexed call typecheck without a cast: with
 * `T` bound to the action's own `type`, the table entry and the action are
 * correlated by construction.
 */
export function applySelectionAction<T extends SelectionKeyAction["type"]>(
  action: ActionOf<T>,
): void {
  SELECTION_STEPS[action.type](action);
}
