import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PlusIcon } from "@phosphor-icons/react";
import {
  asInstance,
  browserHost,
  cn,
  CREATE_ROW_ID,
  type PaletteStep,
  PaletteStepPoint,
  type PaletteSurface,
  type PickerCandidate,
  PickerList,
  type PickerRow,
  pickerRows,
  schemaOf,
  useContributions,
  useDebugFieldIds,
  usePageGraph,
  usePickerKeys,
} from "@kb/ui-sdk";
import type { Contribution } from "@kb/plugin";
import { useOutlineStore, useOutlineNodes } from "./outline.store";

/**
 * The step `id` names, or null for the command list: a step no family
 * contributes now (its family switched off) shows the commands.
 */
function stepOf(
  steps: readonly Contribution<PaletteStep>[],
  id: string | null,
): PaletteStep | null {
  return id === null ? null : (steps.find((step) => step.id === id)?.value ?? null);
}

const COMMANDS_PLACEHOLDER = "Type a command...";

export interface NodeCommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

/**
 * The node menu: layout over two queries.
 *
 * Which commands a row offers is the host's `nodeCommands`, and what a picker step
 * shows and writes is its `PaletteStepPoint` contribution (the outline's own
 * are `OUTLINE_STEPS`). This component measures the anchor,
 * keeps the highlight, and renders — it decides nothing about the command set
 * (closed gap [[01M1MGCF0ECBDEPTHPKMSQ4YFD]]).
 */
export function NodeCommandPalette({ open, onClose }: NodeCommandPaletteProps) {
  // The id of the picker step a command handed the palette to; null, the commands.
  const [step, setStep] = useState<string | null>(null);
  const steps = useContributions(PaletteStepPoint);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const selectedNodeId = useOutlineStore((s) => s.selectedNodeId);
  const activeNodeId = useOutlineStore((s) => s.activeNodeId);
  const nodes = useOutlineNodes();
  const schema = usePageGraph(schemaOf);
  const wireNodes = usePageGraph((s) => s.wireNodes);

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
      setStep(null);
      setQuery("");
    }
  }, [open]);

  useLayoutEffect(() => {
    if (open && anchorRect) inputRef.current?.focus();
  }, [open, anchorRect]);

  const goToStep = (next: string | null) => {
    setStep(next);
    setQuery("");
  };

  const palette: PaletteSurface = { close: onClose, openStep: goToStep };

  // The menu is read against the page as it is now; a row whose label says
  // which way it switches (debug fields) re-reads when the switch moves.
  useDebugFieldIds();
  const commands = browserHost().nodeCommands(
    { nodeId: targetNodeId, frameId: targetNodeId },
    palette,
  );
  const picker = stepOf(steps, step);

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
    scope: step ?? "commands",
    onPick: handleSelect,
    onCancel: () => (picker === null ? onClose() : goToStep(null)),
  });

  useEffect(() => {
    const item = asInstance(
      listRef.current?.querySelectorAll('[role="option"]')[keys.activeIndex],
      HTMLElement,
    );
    item?.scrollIntoView({ block: "nearest" });
  }, [keys.activeIndex]);

  /** A row's glyph, dimmed so it leads its label rather than competing with it. */
  const leadOf = (row: PickerRow): React.ReactNode => {
    const glyph =
      row.kind === "create" ? (
        <PlusIcon size={12} weight="bold" />
      ) : picker === null ? (
        commands.find((c) => c.id === row.id)?.icon
      ) : (
        picker.icon
      );
    return glyph === undefined || glyph === null ? null : (
      <span className="opacity-50">{glyph}</span>
    );
  };

  if (!open || !anchorRect || targetNodeId === null) return null;

  const stepLabel = picker?.label ?? null;

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
              onClick={() => goToStep(null)}
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
            leadOf={leadOf}
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
