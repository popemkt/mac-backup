import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { nodeCandidates } from "@/lib/refs";
import { CREATE_ROW_ID, pickerRows, type PickerCandidate, type PickerRow } from "@/lib/picker";
import { usePickerKeys } from "@/lib/use-picker";
import { PickerList } from "@/components/ui/picker-list";
import { SYSTEM_IDS, type NodeMap } from "@/lib/types";
import { useDebugFieldsStore } from "@/stores/debug-fields.store";
import { schemaOf, type SchemaIndex } from "@/lib/schema";
import { useOutlineStore } from "@/stores/outline.store";
import { usePrefsStore } from "@/stores/prefs.store";
import { useUiStore } from "@/stores/ui.store";

/** The command list, or one of the pickers a command hands the palette to. */
type PaletteStep = "commands" | NodeCommandStep;

/**
 * One picker step, whole.
 *
 * Add-tag, add-field and add-ref are the same gesture over different node
 * kinds, and the same gesture as every other node picker (lib/picker): only
 * the candidate *source*, whether a new one may be minted, and the write
 * vary. A reference draws its candidates from `nodeCandidates`, the source
 * the `[[` autocomplete and the field picker share. Keeping them one table
 * over one engine is what stops them drifting into three pickers.
 *
 * `createLabel` absent ⇒ this kind cannot be minted from the picker.
 */
interface Picker {
  placeholder: string;
  stepLabel: string;
  icon: React.ReactNode;
  createLabel?: (name: string) => string;
  candidates: (graph: PickerGraph) => PickerCandidate[];
  /** At most this many rows; absent, every match. */
  limit?: number;
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
  /** Where field definitions are read from: the whole graph (`lib/schema.ts`). */
  schema: SchemaIndex;
  pickedId: string;
  creating: boolean;
  name: string;
}

/** Nodes whose kind slot points at `kind`, by name. */
function nodesOfKind(wireNodes: WireNode[], kind: string): PickerCandidate[] {
  return wireNodes
    .filter((n) => (n.props[SYSTEM_IDS.typeField] ?? []).some((v) => v.t === "ref" && v.v === kind))
    .map((n) => ({ id: n.id, label: n.text || n.id }))
    .toSorted((a, b) => a.label.localeCompare(b.label));
}

const PICKERS: Record<NodeCommandStep, Picker> = {
  "add-tag": {
    placeholder: "Search or name a tag...",
    stepLabel: "Add tag",
    icon: <HashIcon size={12} weight="bold" />,
    createLabel: (name) => `Create tag "${name}"`,
    candidates: (graph) => nodesOfKind(graph.wireNodes, SYSTEM_IDS.tag),
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
    candidates: (graph) => nodesOfKind(graph.wireNodes, SYSTEM_IDS.field),
    commit: async ({ targetNodeId, schema, pickedId, creating, name }) => {
      const fieldId = creating ? await mutations.defineField(name) : pickedId;
      if (fieldId === null) return;
      // An empty typed value is what makes the row appear and focusable; the
      // field's own declared type decides which editor that row gets.
      await mutations.updateProp(
        targetNodeId,
        fieldId,
        emptyValueForType(resolveFieldTypeById(fieldId, schema)),
      );
    },
  },
  "add-ref": {
    placeholder: "Search for a node to reference...",
    stepLabel: "Reference a node",
    icon: <LinkSimpleIcon size={12} weight="bold" />,
    // A reference to itself is not a reference.
    candidates: (graph) => nodeCandidates(graph.nodes, { exclude: (id) => id === graph.anchorId }),
    limit: 12,
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
 * (closed gap [[01M1MGCF0ECBDEPTHPKMSQ4YFD]]).
 */
export function NodeCommandPalette({ open, onClose }: NodeCommandPaletteProps) {
  const [step, setStep] = useState<PaletteStep>("commands");
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const selectedNodeId = useOutlineStore((s) => s.selectedNodeId);
  const activeNodeId = useOutlineStore((s) => s.activeNodeId);
  const nodes = useOutlineStore((s) => s.nodes);
  const schema = useOutlineStore(schemaOf);
  const wireNodes = useOutlineStore((s) => s.wireNodes);
  const debugIds = useDebugFieldsStore((s) => s.ids);

  const targetNodeId = activeNodeId ?? selectedNodeId;

  /*
   * Anchor, reset and focus all run as layout effects, in the commit that
   * opens the palette. When focus waited a frame, or waited for a passive
   * effect's re-render, whatever was typed right after ⌘K was lost.
   */
  useLayoutEffect(() => {
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

  useLayoutEffect(() => {
    if (open) {
      setStep("commands");
      setQuery("");
    }
  }, [open]);

  useLayoutEffect(() => {
    if (open && anchorRect) inputRef.current?.focus();
  }, [open, anchorRect]);

  const goToStep = (next: PaletteStep) => {
    setStep(next);
    setQuery("");
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

  const commands = listNodeCommands(commandCtx);
  const picker = step === "commands" ? null : PICKERS[step];

  // Commands and a picker step's candidates are both rows of the one picker
  // engine: the same matching, the same keys, the same list.
  const candidates: PickerCandidate[] =
    picker === null
      ? commands.map((c) => ({ id: c.id, label: c.label }))
      : picker.candidates({ nodes, wireNodes, anchorId: targetNodeId });
  const rows = pickerRows(candidates, {
    query,
    canCreate: picker?.createLabel !== undefined,
    limit: picker?.limit,
  });

  const handleSelect = (row: PickerRow | null) => {
    if (row === null) return;
    if (picker === null) {
      commands.find((c) => c.id === row.id)?.run();
      return;
    }
    if (targetNodeId === null) return;
    void picker.commit({
      targetNodeId,
      schema,
      pickedId: row.id,
      creating: row.id === CREATE_ROW_ID,
      name: query.trim(),
    });
    onClose();
  };

  const keys = usePickerKeys({
    rows,
    query,
    scope: step,
    onPick: handleSelect,
    onCancel: () => (picker === null ? onClose() : goToStep("commands")),
  });

  useEffect(() => {
    const item = asInstance(
      listRef.current?.querySelectorAll('[role="option"]')[keys.activeIndex],
      HTMLElement,
    );
    item?.scrollIntoView({ block: "nearest" });
  }, [keys.activeIndex]);

  const iconOf = (row: PickerRow): React.ReactNode => {
    if (row.kind === "create") return <PlusIcon size={12} weight="bold" />;
    return picker === null ? commands.find((c) => c.id === row.id)?.icon : picker.icon;
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
          "bg-popover shadow-overlay",
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
              className="text-caption text-foreground/30 transition-colors hover:text-foreground/50"
              onClick={() => goToStep("commands")}
            >
              Commands
            </button>
            <span className="text-caption text-foreground/20">›</span>
            <span className="text-caption font-medium text-foreground/50">{stepLabel}</span>
          </div>
        )}

        <div className="flex items-center gap-2 px-3 py-2">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (!keys.handleKeyDown(e)) return;
              // The palette's keys are its own; the outline must not see them.
              if (e.key === "Escape") e.stopPropagation();
            }}
            placeholder={picker?.placeholder ?? COMMANDS_PLACEHOLDER}
            className="flex-1 bg-transparent text-ui text-foreground/85 outline-none placeholder:text-foreground/25"
          />
        </div>

        {/* Always occupy the list slot so empty ↔ matched does not resize the shell. */}
        <div
          ref={listRef}
          className="min-h-[2.5rem] border-t border-foreground/[0.06]"
          data-palette-list="true"
        >
          <PickerList
            placement="inline"
            rows={rows}
            activeIndex={keys.activeIndex}
            onHover={keys.setActiveIndex}
            onPick={handleSelect}
            createLabel={picker?.createLabel}
            iconOf={iconOf}
            emptyText={query ? "No matches" : "Type to filter…"}
            aria-label={stepLabel ?? "Node commands"}
          />
        </div>

        <div className="flex items-center gap-3 border-t border-foreground/[0.06] px-3 py-1.5 text-caption text-foreground/20">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc {picker === null ? "close" : "back"}</span>
        </div>
      </div>
    </>,
    document.body,
  );
}
