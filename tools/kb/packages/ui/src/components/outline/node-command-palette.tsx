import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowBendUpLeftIcon,
  ArrowRightIcon,
  EyeIcon,
  EyeSlashIcon,
  HashIcon,
  LinkSimpleIcon,
  ListBulletsIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  PushPinIcon,
  PushPinSlashIcon,
  SquaresFourIcon,
  TableIcon,
  TextTIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { typeRefsOf } from "@kb/model";
import { mutations } from "@/actions/mutations";
import { cn } from "@/lib/cn";
import { isContextualRef } from "@/lib/contextual-ref";
import { emptyValueForType, resolveFieldTypeById } from "@/lib/field-type";
import { isPinned } from "@/lib/pinned";
import { DEFAULT_QUERY_EDN, isQueryNode } from "@/lib/query-node";
import { fuzzyNodeCandidates } from "@/lib/refs";
import { SYSTEM_IDS } from "@/lib/types";
import { asInstance } from "@/lib/dom";
import type { ViewMode } from "@/lib/view-config";
import { useDebugFieldsStore } from "@/stores/debug-fields.store";
import { useOutlineStore } from "@/stores/outline.store";
import { useUiStore } from "@/stores/ui.store";

type PaletteStep =
  | { type: "commands" }
  | { type: "add-tag" }
  | { type: "add-field" }
  | { type: "add-ref" };

/** Sentinel row id for "no match — make one with what I typed". */
const CREATE_ID = "\u0000create";

interface PickOption {
  id: string;
  name: string;
}

function matchByName(options: PickOption[], query: string): PickOption[] {
  const needle = query.toLowerCase();
  return options.filter((o) => o.name.toLowerCase().includes(needle));
}

interface Command {
  id: string;
  label: string;
  icon: React.ReactNode;
  step?: PaletteStep["type"];
  immediate?: boolean;
  action?: () => void;
}

export interface NodeCommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

// oxlint-disable-next-line complexity -- GAP [[01M1MGCF0ECBDEPTHPKMSQ4YFD]]
export function NodeCommandPalette({ open, onClose }: NodeCommandPaletteProps) {
  const [step, setStep] = useState<PaletteStep>({ type: "commands" });
  const [query, setQuery] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const selectedNodeId = useOutlineStore((s) => s.selectedNodeId);
  const activeNodeId = useOutlineStore((s) => s.activeNodeId);
  const nodes = useOutlineStore((s) => s.nodes);
  const wireNodes = useOutlineStore((s) => s.wireNodes);
  const setGlobalPaletteOpen = useUiStore((s) => s.setGlobalPaletteOpen);

  const targetNodeId = activeNodeId ?? selectedNodeId;
  const targetNode = targetNodeId !== null ? nodes.get(targetNodeId) : undefined;
  const debugOn = useDebugFieldsStore((s) =>
    targetNodeId !== null ? s.ids.has(targetNodeId) : false,
  );
  const pinned = targetNode ? isPinned(targetNode, nodes) : false;

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
      setStep({ type: "commands" });
      setQuery("");
      setHighlightIndex(0);
    }
  }, [open]);

  useEffect(() => {
    if (open && anchorRect) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, anchorRect]);

  const tagOptions = useMemo(() => {
    return wireNodes
      .filter((n) =>
        (n.props[SYSTEM_IDS.typeField] ?? []).some((v) => v.t === "ref" && v.v === SYSTEM_IDS.tag),
      )
      .map((n) => ({ id: n.id, name: n.text || n.id }))
      .toSorted((a, b) => a.name.localeCompare(b.name));
  }, [wireNodes]);

  const fieldOptions = useMemo(() => {
    return wireNodes
      .filter((n) =>
        (n.props[SYSTEM_IDS.typeField] ?? []).some(
          (v) => v.t === "ref" && v.v === SYSTEM_IDS.field,
        ),
      )
      .map((n) => ({ id: n.id, name: n.text || n.id }))
      .toSorted((a, b) => a.name.localeCompare(b.name));
  }, [wireNodes]);

  const commands: Command[] = useMemo(() => {
    const base: Command[] = [
      {
        id: "add-tag",
        label: "Add tag",
        icon: <HashIcon size={14} weight="bold" />,
        step: "add-tag",
      },
      {
        id: "add-field",
        label: "Add field",
        icon: <TextTIcon size={14} weight="bold" />,
        step: "add-field",
      },
      {
        id: "search-all",
        label: "Search everything… ⌘S",
        icon: <MagnifyingGlassIcon size={14} />,
        immediate: true,
        action: () => {
          onClose();
          setGlobalPaletteOpen(true);
        },
      },
      {
        id: "indent",
        label: "Indent",
        icon: <ArrowRightIcon size={14} />,
        immediate: true,
        action: () => {
          if (targetNodeId !== null) void mutations.indentNode(targetNodeId);
          onClose();
        },
      },
      {
        id: "outdent",
        label: "Outdent",
        icon: <ArrowBendUpLeftIcon size={14} />,
        immediate: true,
        action: () => {
          if (targetNodeId !== null) void mutations.outdentNode(targetNodeId);
          onClose();
        },
      },
      {
        // Pinning is tagging (lib/pinned); the label is the current state so
        // the row reads as a toggle rather than as a fire-and-hope command.
        id: "toggle-pin",
        label: pinned ? "Unpin" : "Pin",
        icon: pinned ? (
          <PushPinSlashIcon size={14} weight="bold" />
        ) : (
          <PushPinIcon size={14} weight="bold" />
        ),
        immediate: true,
        action: () => {
          if (targetNodeId !== null) void mutations.togglePin(targetNodeId);
          onClose();
        },
      },
      {
        // Per node, never global: the answer is about the node you are looking
        // at (stores/debug-fields.store).
        id: "toggle-debug-fields",
        label: debugOn ? "Hide debug fields" : "Show debug fields",
        icon: debugOn ? <EyeSlashIcon size={14} /> : <EyeIcon size={14} />,
        immediate: true,
        action: () => {
          if (targetNodeId !== null) useDebugFieldsStore.getState().toggle(targetNodeId);
          onClose();
        },
      },
      {
        id: "delete",
        label: "Delete node",
        icon: <TrashIcon size={14} />,
        immediate: true,
        action: () => {
          if (targetNodeId !== null) void mutations.deleteNode(targetNodeId);
          onClose();
        },
      },
    ];

    const setMode = (mode: ViewMode) => {
      if (targetNodeId === null) return;
      void mutations.setViewMode(targetNodeId, mode);
      onClose();
    };
    base.push(
      {
        id: "view-as-list",
        label: "View as: List",
        icon: <ListBulletsIcon size={14} />,
        immediate: true,
        action: () => setMode("list"),
      },
      {
        id: "view-as-table",
        label: "View as: Table",
        icon: <TableIcon size={14} />,
        immediate: true,
        action: () => setMode("table"),
      },
      {
        id: "view-as-board",
        label: "View as: Board",
        icon: <SquaresFourIcon size={14} />,
        immediate: true,
        action: () => setMode("board"),
      },
      {
        id: "view-as-cards",
        label: "View as: Cards",
        icon: <SquaresFourIcon size={14} weight="duotone" />,
        immediate: true,
        action: () => setMode("cards"),
      },
      {
        id: "view-filter",
        label: "Filter…",
        icon: <MagnifyingGlassIcon size={14} />,
        immediate: true,
        action: () => {
          if (targetNodeId === null) return;
          useUiStore.getState().setFilterPopoverFrameId(targetNodeId);
          onClose();
        },
      },
    );

    // Kind slot, not badges: `resolveTags` never emits `sys.tag`, so reading
    // the display list made every node look like a non-tag and the menu offered
    // "Make supertag" on nodes that already were one.
    const isTag = typeRefsOf(targetNode).includes(SYSTEM_IDS.tag);
    if (targetNode && !isTag) {
      base.splice(2, 0, {
        id: "make-supertag",
        label: "Make supertag",
        icon: <HashIcon size={14} weight="fill" />,
        immediate: true,
        action: () => {
          if (targetNodeId === null) return;
          void (async () => {
            if (!(await mutations.makeSupertag(targetNodeId))) return;
            // A supertag is schema, so it leaves the outline forest the moment
            // it becomes one. Zoom to it rather than letting the row vanish —
            // and its field template is the next thing anyone wants anyway.
            useOutlineStore.getState().zoomTo(targetNodeId);
          })();
          onClose();
        },
      });
    }

    if (targetNode && !isContextualRef(targetNode)) {
      base.splice(1, 0, {
        id: "turn-ref",
        label: "Turn into reference…",
        icon: <LinkSimpleIcon size={14} weight="bold" />,
        step: "add-ref",
      });
    }

    if (targetNode && !isQueryNode(targetNode)) {
      base.splice(1, 0, {
        id: "turn-query",
        label: "Turn into query",
        icon: <MagnifyingGlassIcon size={14} weight="bold" />,
        immediate: true,
        action: () => {
          if (targetNodeId === null) return;
          void (async () => {
            await mutations.addTag(targetNodeId, SYSTEM_IDS.queryTag);
            await mutations.updateProp(targetNodeId, SYSTEM_IDS.queryField, {
              t: "str",
              v: DEFAULT_QUERY_EDN,
            });
          })();
          onClose();
        },
      });
    }

    return base;
  }, [debugOn, onClose, pinned, setGlobalPaletteOpen, targetNode, targetNodeId]);

  const filteredCommands = commands.filter((c) =>
    c.label.toLowerCase().includes(query.toLowerCase()),
  );

  const trimmed = query.trim();

  /**
   * Add-tag, add-field and add-ref are the same gesture over different node
   * kinds: resolve candidates from the query, and — where minting makes sense —
   * offer to create one when nothing matches. Only the candidate *source*
   * varies, and a reference draws its candidates from `fuzzyNodeCandidates`,
   * the resolver the `[[` autocomplete and the typed ref field editor already
   * share. Keeping them one code path is what stops them drifting into three
   * pickers.
   */
  const picking: {
    match: (q: string) => PickOption[];
    icon: React.ReactNode;
    /** Absent ⇒ this kind cannot be minted from the picker. */
    createLabel?: (name: string) => string;
  } =
    step.type === "add-field"
      ? {
          match: (q) => matchByName(fieldOptions, q),
          icon: <TextTIcon size={12} weight="bold" />,
          createLabel: (name: string) => `Create field "${name}"`,
        }
      : step.type === "add-ref"
        ? {
            match: (q) =>
              fuzzyNodeCandidates(nodes, q)
                // A reference to itself is not a reference.
                .filter((c) => c.id !== targetNodeId)
                .map((c) => ({ id: c.id, name: c.text })),
            icon: <LinkSimpleIcon size={12} weight="bold" />,
          }
        : {
            match: (q) => matchByName(tagOptions, q),
            icon: <HashIcon size={12} weight="bold" />,
            createLabel: (name: string) => `Create tag "${name}"`,
          };

  const filteredOptions = picking.match(query);
  const exactMatch = filteredOptions.some((o) => o.name.toLowerCase() === trimmed.toLowerCase());
  const createLabel = picking.createLabel;

  const pickerItems = [
    ...filteredOptions.map((o) => ({
      id: o.id,
      label: o.name,
      icon: picking.icon,
    })),
    ...(trimmed && !exactMatch && createLabel
      ? [
          {
            id: CREATE_ID,
            label: createLabel(trimmed),
            icon: <PlusIcon size={12} weight="bold" />,
          },
        ]
      : []),
  ];

  const items =
    step.type === "commands"
      ? filteredCommands.map((c) => ({ id: c.id, label: c.label, icon: c.icon }))
      : pickerItems;

  useEffect(() => {
    setHighlightIndex(0);
  }, [query, step.type]);

  useEffect(() => {
    const item = asInstance(listRef.current?.children[highlightIndex], HTMLElement);
    item?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex]);

  const handleSelect = useCallback(
    (index: number) => {
      if (step.type === "commands") {
        const cmd = filteredCommands[index];
        if (!cmd) return;
        if (cmd.immediate === true && cmd.action) {
          cmd.action();
          return;
        }
        setStep({ type: cmd.step ?? "commands" });
        setQuery("");
        setHighlightIndex(0);
        return;
      }

      const item = pickerItems[index];
      if (!item || targetNodeId === null) return;
      const creating = item.id === CREATE_ID;

      void (async () => {
        if (step.type === "add-ref") {
          // The whole creation gesture, and nothing but existing primitives:
          // apply the tag, point the target field at the picked node.
          await mutations.addTag(targetNodeId, SYSTEM_IDS.refTag);
          await mutations.updateProp(targetNodeId, SYSTEM_IDS.refTargetField, {
            t: "ref",
            v: item.id,
          });
          return;
        }
        if (step.type === "add-field") {
          const fieldId = creating ? await mutations.defineField(trimmed) : item.id;
          if (fieldId === null) return;
          // An empty typed value is what makes the row appear and focusable;
          // the field's own declared type decides which editor that row gets.
          await mutations.updateProp(
            targetNodeId,
            fieldId,
            emptyValueForType(resolveFieldTypeById(fieldId, nodes)),
          );
          return;
        }
        const tagId = creating ? await mutations.defineTag(trimmed) : item.id;
        if (tagId !== null) await mutations.addTag(targetNodeId, tagId);
      })();
      onClose();
    },
    [filteredCommands, nodes, onClose, pickerItems, step.type, targetNodeId, trimmed], // oxlint-disable-line react-hooks/exhaustive-deps -- pickerItems changes every render by construction; memoizing it would not help the callback's closure, so it is kept as a coarse invalidation key
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (step.type !== "commands") {
          setStep({ type: "commands" });
          setQuery("");
          setHighlightIndex(0);
        } else {
          onClose();
        }
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
    },
    [handleSelect, highlightIndex, items.length, onClose, step.type],
  );

  if (!open || !anchorRect || targetNodeId === null) return null;

  const placeholder =
    step.type === "commands"
      ? "Type a command..."
      : step.type === "add-field"
        ? "Search or name a field..."
        : step.type === "add-ref"
          ? "Search for a node to reference..."
          : "Search or name a tag...";
  const stepLabel =
    step.type === "add-tag"
      ? "Add tag"
      : step.type === "add-field"
        ? "Add field"
        : step.type === "add-ref"
          ? "Reference a node"
          : null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[99]" onClick={onClose} />
      <div
        className={cn(
          "fixed z-[100] w-[300px]",
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
        {stepLabel && (
          <div className="flex items-center gap-1 px-3 pt-2 pb-0.5">
            <button
              type="button"
              className="text-[10px] text-foreground/30 transition-colors hover:text-foreground/50"
              onClick={() => {
                setStep({ type: "commands" });
                setQuery("");
                setHighlightIndex(0);
              }}
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
            placeholder={placeholder}
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
          <span>esc {step.type !== "commands" ? "back" : "close"}</span>
        </div>
      </div>
    </>,
    document.body,
  );
}
