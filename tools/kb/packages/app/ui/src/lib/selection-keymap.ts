/**
 * Selection-mode keymap (nxus / DESIGN-REFINE §2 W1; r1 §3.2 Mode B).
 * Active only when a node is selected and not being edited.
 */
import { isPrintableKey, lookupChord, type Chord, type KeyChordEvent } from "@/lib/keychord";
import type { VisibleInstance } from "@/lib/visible-instances";

/** Selection mode reads the same event shape every keymap reads. */
export type SelectionKeyEvent = KeyChordEvent;

export type SelectionKeyAction =
  | { type: "select"; nodeId: string; instanceKey: string }
  | { type: "clear" }
  | { type: "edit"; nodeId: string; instanceKey: string }
  | { type: "toggleCollapse"; nodeId: string }
  | { type: "collapse"; nodeId: string }
  | { type: "expand"; nodeId: string }
  | { type: "selectParent"; nodeId: string }
  | { type: "selectFirstChild"; nodeId: string }
  | { type: "indent"; nodeId: string }
  | { type: "outdent"; nodeId: string }
  | { type: "moveUp"; nodeId: string }
  | { type: "moveDown"; nodeId: string }
  | { type: "zoom"; nodeId: string }
  | { type: "createAfter"; nodeId: string }
  | { type: "createBefore"; nodeId: string }
  | { type: "delete"; nodeId: string; instanceKey: string }
  | { type: "append"; nodeId: string; instanceKey: string; char: string };

export interface SelectionNodeInfo {
  collapsed: boolean;
  childIds: string[];
  parentId: string | null;
}

export interface SelectionKeyContext {
  selectedNodeId: string | null;
  selectedInstanceKey: string | null;
  activeNodeId: string | null;
  getPreviousVisibleInstance: (instanceKey: string) => VisibleInstance | null;
  getNextVisibleInstance: (instanceKey: string) => VisibleInstance | null;
  getNode?: (id: string) => SelectionNodeInfo | undefined;
}

/** True when the event target is a text field / contentEditable (skip map). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("[contenteditable='true']"));
}

/** What a binding is handed: the selection, the pressed key, and the context. */
interface SelectionTarget {
  readonly ctx: SelectionKeyContext;
  readonly key: string;
  readonly nodeId: string;
  readonly instanceKey: string;
  readonly info: SelectionNodeInfo | undefined;
}

interface SelectionBinding {
  readonly chord: Chord;
  /** The action for this chord, or null when the chord resolves to nothing. */
  readonly toAction: (target: SelectionTarget) => SelectionKeyAction | null;
}

/** The three names a space bar arrives under. */
const SPACE_KEYS = [" ", "Space", "Spacebar"] as const;

function selectInstance(instance: VisibleInstance | null): SelectionKeyAction | null {
  return instance === null
    ? null
    : { type: "select", nodeId: instance.nodeId, instanceKey: instance.instanceKey };
}

/** ArrowLeft: close what is open, else climb to the parent. */
function closeOrClimb({ nodeId, info }: SelectionTarget): SelectionKeyAction | null {
  if (!info) return null;
  if (!info.collapsed && info.childIds.length > 0) return { type: "collapse", nodeId };
  return info.parentId !== null ? { type: "selectParent", nodeId } : null;
}

/** ArrowRight: open what is closed, else descend into the first child. */
function openOrDescend({ nodeId, info }: SelectionTarget): SelectionKeyAction | null {
  if (!info) return null;
  if (info.collapsed && info.childIds.length > 0) return { type: "expand", nodeId };
  return info.childIds.length > 0 ? { type: "selectFirstChild", nodeId } : null;
}

/**
 * The binding set, first match wins (DESIGN-REFINE §2 W1; r1 §3.2 Mode B).
 *
 * Order carries meaning twice over. The modifier combos come first, and the
 * bare `{ mod: true }` row after them is the cutoff: every other modified
 * chord belongs to the browser or the app shell, so it resolves to nothing
 * rather than falling through to the unmodified binding of the same key.
 * Below the cutoff, the more specific chord of a shared key precedes the
 * general one (⇧⇥ before ⇥), and the printable row is last because it claims
 * every remaining single character.
 */
const SELECTION_KEYMAP: readonly SelectionBinding[] = [
  {
    chord: { key: "ArrowUp", mod: true, shift: true },
    toAction: ({ nodeId }) => ({ type: "moveUp", nodeId }),
  },
  {
    chord: { key: "ArrowDown", mod: true, shift: true },
    toAction: ({ nodeId }) => ({ type: "moveDown", nodeId }),
  },
  { chord: { key: ".", mod: true }, toAction: ({ nodeId }) => ({ type: "zoom", nodeId }) },
  { chord: { mod: true }, toAction: () => null },
  {
    chord: { key: "ArrowUp" },
    toAction: ({ ctx, instanceKey }) => selectInstance(ctx.getPreviousVisibleInstance(instanceKey)),
  },
  {
    chord: { key: "ArrowDown" },
    toAction: ({ ctx, instanceKey }) => selectInstance(ctx.getNextVisibleInstance(instanceKey)),
  },
  { chord: { key: "ArrowLeft" }, toAction: closeOrClimb },
  { chord: { key: "ArrowRight" }, toAction: openOrDescend },
  {
    chord: { key: "Enter" },
    toAction: ({ nodeId, instanceKey }) => ({ type: "edit", nodeId, instanceKey }),
  },
  { chord: { key: SPACE_KEYS }, toAction: ({ nodeId }) => ({ type: "toggleCollapse", nodeId }) },
  { chord: { key: "Tab", shift: true }, toAction: ({ nodeId }) => ({ type: "outdent", nodeId }) },
  { chord: { key: "Tab" }, toAction: ({ nodeId }) => ({ type: "indent", nodeId }) },
  { chord: { key: "o" }, toAction: ({ nodeId }) => ({ type: "createAfter", nodeId }) },
  // Shift+o: a new empty row directly above. Case is the binding, so this is
  // its own row rather than a `shift` constraint on the one above.
  { chord: { key: "O" }, toAction: ({ nodeId }) => ({ type: "createBefore", nodeId }) },
  {
    chord: { key: ["Backspace", "Delete"] },
    toAction: ({ nodeId, instanceKey }) => ({ type: "delete", nodeId, instanceKey }),
  },
  { chord: { key: "Escape" }, toAction: () => ({ type: "clear" }) },
  {
    // Typing over a selected row edits it with the character appended. Alt is
    // excluded so Alt-composed glyphs stay native.
    chord: { key: isPrintableKey, alt: false },
    toAction: ({ nodeId, instanceKey, key }) => ({
      type: "append",
      nodeId,
      instanceKey,
      char: key,
    }),
  },
];

/**
 * Map a keydown to a selection action, or null if not handled.
 * Caller should preventDefault when a non-null action is returned.
 */
export function mapSelectionKey(
  ev: SelectionKeyEvent,
  ctx: SelectionKeyContext,
): SelectionKeyAction | null {
  const { selectedNodeId, selectedInstanceKey, activeNodeId } = ctx;
  if (selectedNodeId === null || selectedInstanceKey === null || activeNodeId !== null) return null;

  const binding = lookupChord(ev, SELECTION_KEYMAP);
  if (binding === undefined) return null;
  return binding.toAction({
    ctx,
    key: ev.key,
    nodeId: selectedNodeId,
    instanceKey: selectedInstanceKey,
    info: ctx.getNode?.(selectedNodeId),
  });
}
