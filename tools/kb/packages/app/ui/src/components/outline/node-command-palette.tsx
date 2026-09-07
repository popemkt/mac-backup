import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HashIcon, LinkSimpleIcon, PlusIcon, TextTIcon } from "@phosphor-icons/react";
import type { WireNode } from "@kb/contracts";
import { mutations } from "@/actions/mutations";
import { cn } from "@/lib/cn";
import {
  listNodeCommands,
  type CommandContext,
  type NodeCommandStep,
  type PaletteSurface,
} from "@/lib/commands";
import { asInstance } from "@/lib/dom";
import { emptyValueForType, resolveFieldTypeById } from "@/lib/field-type";
import { fuzzyNodeCandidates } from "@/lib/refs";
import { SYSTEM_IDS, type NodeMap } from "@/lib/types";
import { useDebugFieldsStore } from "@/stores/debug-fields.store";
import { useOutlineStore } from "@/stores/outline.store";
import { usePrefsStore } from "@/stores/prefs.store";
import { useUiStore } from "@/stores/ui.store";

/** The command list, or one of the pickers a command hands the palette to. */
type PaletteStep = "commands" | NodeCommandStep;

/** Sentinel row id for "no match — make one with what I typed". */
const CREATE_ID = "\u0000create";

interface PickOption {
  id: string;
  name: string;
}

/**
 * One picker step, whole.
 *
 * Add-tag, add-field and add-ref are the same gesture over different node
 * kinds: resolve candidates from the query, and — where minting makes sense —
 * offer to create one when nothing matches. Only the candidate *source* and
 * the write vary, and a reference draws its candidates from
 * `fuzzyNodeCandidates`, the resolver the `[[` autocomplete and the typed ref
 * field editor already share. Keeping them one table is what stops them
 * drifting into three pickers.
 *
 * `createLabel` absent ⇒ this kind cannot be minted from the picker.
 */
interface Picker {
  placeholder: string;
  stepLabel: string;
  icon: React.ReactNode;
  createLabel?: (name: string) => string;
  match: (graph: PickerGraph, query: string) => PickOption[];
  commit: (target: PickerTarget) => Promise<void>;
}

interface PickerGraph {
  nodes: NodeMap;
  wireNodes: WireNode[];
  /** The row the palette is anchored to — never its own candidate. */
  anchorId: string | null;
}

interface PickerTarget {
  targetNodeId: string;
  nodes: NodeMap;
  pickedId: string;
  creating: boolean;
  name: string;
}

/** Nodes whose kind slot points at `kind`, by name, filtered by the query. */
function optionsOfKind(wireNodes: WireNode[], kind: string, query: string): PickOption[] {
  const needle = query.toLowerCase();
  return wireNodes
    .filter((n) => (n.props[SYSTEM_IDS.typeField] ?? []).some((v) => v.t === "ref" && v.v === kind))
    .map((n) => ({ id: n.id, name: n.text || n.id }))
    .filter((o) => o.name.toLowerCase().includes(needle))
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

const PICKERS: Record<NodeCommandStep, Picker> = {
  "add-tag": {
    placeholder: "Search or name a tag...",
    stepLabel: "Add tag",
    icon: <HashIcon size={12} weight="bold" />,
    createLabel: (name) => `Create tag "${name}"`,
    match: (graph, query) => optionsOfKind(graph.wireNodes, SYSTEM_IDS.tag, query),
    commit: async ({ targetNodeId, pickedId, creating, name }) => {
      const tagId = creating ? await mutations.defineTag(name) : pickedId;
      if (tagId !== null) await mutations.addTag(targetNodeId, tagId);
    },
  },
  "add-field": {
    placeholder: "Search or name a field...",
    stepLabel: "Add field",
    icon: <TextTIcon size={12} weight="bold" />,
    createLabel: (name) => `Create field "${name}"`,
    match: (graph, query) => optionsOfKind(graph.wireNodes, SYSTEM_IDS.field, query),
    commit: async ({ targetNodeId, nodes, pickedId, creating, name }) => {
      const fieldId = creating ? await mutations.defineField(name) : pickedId;
      if (fieldId === null) return;
      // An empty typed value is what makes the row appear and focusable; the
      // field's own declared type decides which editor that row gets.
      await mutations.updateProp(
        targetNodeId,
        fieldId,
        emptyValueForType(resolveFieldTypeById(fieldId, nodes)),
      );
    },
  },
  "add-ref": {
    placeholder: "Search for a node to reference...",
    stepLabel: "Reference a node",
    icon: <LinkSimpleIcon size={12} weight="bold" />,
    match: (graph, query) =>
      fuzzyNodeCandidates(graph.nodes, query)
        // A reference to itself is not a reference.
        .filter((c) => c.id !== graph.anchorId)
        .map((c) => ({ id: c.id, name: c.text })),
    commit: async ({ targetNodeId, pickedId }) => {
      // The whole creation gesture, and nothing but existing primitives: point
      // the target field at the picked node. The field is the kind.
      await mutations.updateProp(targetNodeId, SYSTEM_IDS.refTargetField, {
        t: "ref",
        v: pickedId,
      });
    },
  },
};

const COMMANDS_PLACEHOLDER = "Type a command...";

/** One row of the palette list, from either query. */
interface PaletteItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

/**
 * A picker step's rows: the candidates, plus the mint row when the typed name
 * matches nothing and this kind can be minted.
 */
function pickerRows(picker: Picker, graph: PickerGraph, query: string): PaletteItem[] {
  const options = picker.match(graph, query);
  const trimmed = query.trim();
  const exact = options.some((o) => o.name.toLowerCase() === trimmed.toLowerCase());
  const rows: PaletteItem[] = options.map((o) => ({
    id: o.id,
    label: o.name,
    icon: picker.icon,
  }));
  const createLabel = picker.createLabel;
  if (trimmed !== "" && !exact && createLabel !== undefined) {
    rows.push({
      id: CREATE_ID,
      label: createLabel(trimmed),
      icon: <PlusIcon size={12} weight="bold" />,
    });
  }
  return rows;
}

export interface NodeCommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

/**
 * The node menu: layout over two queries.
 *
 * Which commands a row offers is `listNodeCommands`, and what a picker step
 * shows and writes is {@link PICKERS}. This component measures the anchor,
 * keeps the highlight, and renders — it decides nothing about the command set
 * (GAP [[01M1MGCF0ECBDEPTHPKMSQ4YFD]]).
 */
export function NodeCommandPalette({ open, onClose }: NodeCommandPaletteProps) {
  const [step, setStep] = useState<PaletteStep>("commands");
  const [query, setQuery] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const selectedNodeId = useOutlineStore((s) => s.selectedNodeId);
  const activeNodeId = useOutlineStore((s) => s.activeNodeId);
  const nodes = useOutlineStore((s) => s.nodes);
  const wireNodes = useOutlineStore((s) => s.wireNodes);
  const debugIds = useDebugFieldsStore((s) => s.ids);

  const targetNodeId = activeNodeId ?? selectedNodeId;

  useEffect(() => {
    if (!open || targetNodeId === null) {
      setAnchorRect(null);
      return;
    }
    const anchorEl = document.querySelector(
      `[data-node-id="${CSS.escape(targetNodeId)}"] .node-row`,
    );
    if (anchorEl instanceof HTMLElement) {
      setAnchorRect(anchorEl.getBoundingClientRect());
    }
  }, [open, targetNodeId]);

  useEffect(() => {
    if (open) {
      setStep("commands");
      setQuery("");
      setHighlightIndex(0);
    }
  }, [open]);

  useEffect(() => {
    if (open && anchorRect) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, anchorRect]);

  const goToStep = (next: PaletteStep) => {
    setStep(next);
    setQuery("");
    setHighlightIndex(0);
  };

  const palette: PaletteSurface = { close: onClose, openStep: goToStep };

  /**
   * The state a command runs against. The registry is a leaf module, so the
   * palette hands it the stores rather than the other way round (GAP
   * [[01M1RXMQPVJKREGDS7D37J1MWN]]).
   */
  const commandCtx: CommandContext = {
    target: { nodeId: targetNodeId, frameId: targetNodeId },
    outline: useOutlineStore.getState(),
    prefs: usePrefsStore.getState(),
    ui: useUiStore.getState(),
    debugFields: { ids: debugIds, toggle: useDebugFieldsStore.getState().toggle },
    palette,
  };

  const filteredCommands = listNodeCommands(commandCtx).filter((c) =>
    c.label.toLowerCase().includes(query.toLowerCase()),
  );

  const picker = step === "commands" ? null : PICKERS[step];

  const items: PaletteItem[] =
    picker === null
      ? filteredCommands.map((c) => ({ id: c.id, label: c.label, icon: c.icon }))
      : pickerRows(picker, { nodes, wireNodes, anchorId: targetNodeId }, query);

  useEffect(() => {
    setHighlightIndex(0);
  }, [query, step]);

  useEffect(() => {
    const item = asInstance(listRef.current?.children[highlightIndex], HTMLElement);
    item?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex]);

  const handleSelect = (index: number) => {
    if (picker === null) {
      filteredCommands[index]?.run();
      return;
    }
    const item = items[index];
    if (!item || targetNodeId === null) return;
    void picker.commit({
      targetNodeId,
      nodes,
      pickedId: item.id,
      creating: item.id === CREATE_ID,
      name: query.trim(),
    });
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (picker === null) onClose();
      else goToStep("commands");
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, Math.max(items.length - 1, 0)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      setHighlightIndex(0);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      setHighlightIndex(Math.max(items.length - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      handleSelect(highlightIndex);
    }
  };

  if (!open || !anchorRect || targetNodeId === null) return null;

  const stepLabel = picker?.stepLabel ?? null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[99]" onClick={onClose} />
      <div
        className={cn(
          "kb-surface-enter fixed z-[100] w-[300px]",
          "rounded-lg border border-foreground/10",
          "bg-popover shadow-xl",
          "overflow-hidden",
        )}
        style={{
          top: anchorRect.bottom + 4,
          left: Math.max(8, anchorRect.left),
        }}
        role="dialog"
        aria-label={stepLabel ?? "Node commands"}
        onClick={(e) => e.stopPropagation()}
      >
        {stepLabel !== null && (
          <div className="flex items-center gap-1 px-3 pt-2 pb-0.5">
            <button
              type="button"
              className="text-[10px] text-foreground/30 transition-colors hover:text-foreground/50"
              onClick={() => goToStep("commands")}
            >
              Commands
            </button>
            <span className="text-[10px] text-foreground/20">›</span>
            <span className="text-[10px] font-medium text-foreground/50">{stepLabel}</span>
          </div>
        )}

        <div className="flex items-center gap-2 px-3 py-2">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={picker?.placeholder ?? COMMANDS_PLACEHOLDER}
            className="flex-1 bg-transparent text-[13px] text-foreground/85 outline-none placeholder:text-foreground/25"
          />
        </div>

        {/* Always occupy the list slot so empty ↔ matched does not resize the shell. */}
        <div
          ref={listRef}
          className="min-h-[2.5rem] max-h-[240px] overflow-y-auto border-t border-foreground/[0.06] p-1"
          data-palette-list="true"
        >
          {items.length === 0 ? (
            <div className="px-2 py-2 text-center text-[12px] text-foreground/25">
              {query ? "No matches" : "Type to filter…"}
            </div>
          ) : (
            items.map((item, i) => (
              <button
                key={item.id}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left",
                  "text-[13px] transition-colors duration-75",
                  i === highlightIndex
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground/70 hover:bg-foreground/[0.04]",
                )}
                onClick={() => handleSelect(i)}
                onMouseEnter={() => setHighlightIndex(i)}
              >
                {item.icon !== undefined && item.icon !== null && (
                  <span className="shrink-0 opacity-50">{item.icon}</span>
                )}
                <span className="truncate">{item.label}</span>
              </button>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-foreground/[0.06] px-3 py-1.5 text-[10px] text-foreground/20">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc {picker === null ? "close" : "back"}</span>
        </div>
      </div>
    </>,
    document.body,
  );
}
