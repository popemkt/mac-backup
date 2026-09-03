import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Funnel, Plus, TextT, X } from "@phosphor-icons/react";
import { mutations } from "@/actions/mutations";
import { toast } from "@/lib/toast";
import {
  getViewConfig,
  resolveTableColumns,
  serializeViewFilter,
  type ViewFilter,
} from "@/lib/view-config";
import type { NodeMap, OutlineNode } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { useUiStore } from "@/stores/ui.store";
import { PrefFieldRow } from "./fields-section";
import { POPOVER_VALUE_CLASS, PopoverShell } from "@/components/ui/popover-shell";

function filterLabel(f: ViewFilter): string {
  if (f.kind === "text") return `text ∋ ${f.text}`;
  return `${f.fieldId} = ${f.value}`;
}

/** Field candidates from projected rows' tags — same source as resolveTableColumns. */
export function listFilterFieldOptions(
  frameId: string,
  nodes: NodeMap,
): Array<{ id: string; text: string }> {
  const frame = nodes.get(frameId);
  if (!frame) return [];
  const children = frame.children
    .map((id) => nodes.get(id))
    .filter((n): n is OutlineNode => n !== undefined);
  const config = getViewConfig(frame.props);
  return resolveTableColumns(config, children, nodes, true).map((c) => ({
    id: c.fieldId,
    text: c.label,
  }));
}

function elRect(el: Element | null): DOMRect | null {
  if (!el || typeof el.getBoundingClientRect !== "function") return null;
  return el.getBoundingClientRect();
}

function resolveAnchorRect(frameId: string): DOMRect | null {
  const id = CSS.escape(frameId);
  return (
    elRect(
      document.querySelector(
        `[data-view-toolbar][data-frame-id="${id}"] [data-filter-button="true"]`,
      ),
    ) ??
    elRect(document.querySelector(`[data-view-toolbar][data-frame-id="${id}"]`)) ??
    elRect(document.querySelector(`[data-view-toolbar-gear][data-frame-id="${id}"]`)) ??
    elRect(document.querySelector(`[data-zoomed-root-header][data-frame-id="${id}"]`)) ??
    elRect(document.querySelector(`[data-node-block][data-node-id="${id}"]`))
  );
}

/**
 * Global filter popover host — portals to document.body so palette-opened
 * Filter… is visible regardless of nested-frame hover opacity.
 */
export function ViewFilterPopoverHost() {
  const frameId = useUiStore((s) => s.filterPopoverFrameId);
  const setOpenId = useUiStore((s) => s.setFilterPopoverFrameId);
  const rev = useOutlineStore((s) => s.rev);
  const frame = useOutlineStore((s) => (frameId ? s.nodes.get(frameId) : undefined));
  const panelRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  const fields = useMemo(() => {
    if (!frameId) return [];
    return listFilterFieldOptions(frameId, useOutlineStore.getState().nodes);
  }, [frameId, rev]); // oxlint-disable-line react-hooks/exhaustive-deps -- rev is the reactive invalidation key: the body reads the store imperatively via getState(), so rev drives recomputation

  const config = getViewConfig(frame?.props);

  const [kind, setKind] = useState<"eq" | "text">("eq");
  const [fieldId, setFieldId] = useState("");
  const [value, setValue] = useState("");

  useLayoutEffect(() => {
    if (!frameId) {
      setAnchor(null);
      return;
    }
    const rect = resolveAnchorRect(frameId);
    if (!rect) {
      toast("select a frame first");
      setOpenId(null);
      setAnchor(null);
      return;
    }
    setAnchor(rect);
  }, [frameId, setOpenId, rev]);

  useEffect(() => {
    if (!frameId || !anchor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenId(null);
    };
    const onPointerDown = (e: PointerEvent) => {
      const panel = panelRef.current;
      if (panel && e.target instanceof Node && !panel.contains(e.target)) {
        const t = e.target;
        if (t instanceof Element && t.closest(`[data-filter-button="true"]`)) {
          return;
        }
        setOpenId(null);
      }
    };
    const onScroll = () => {
      const rect = resolveAnchorRect(frameId);
      if (rect) setAnchor(rect);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [frameId, anchor, setOpenId]);

  useEffect(() => {
    if (!fieldId && fields[0]) setFieldId(fields[0].id);
  }, [fields, fieldId]);

  if (!frameId || !anchor) return null;

  const add = () => {
    if (kind === "text") {
      const text = value.trim();
      if (!text) return;
      void mutations.addViewFilter(frameId, serializeViewFilter({ kind: "text", text, raw: "" }));
    } else {
      if (!fieldId || !value.trim()) return;
      void mutations.addViewFilter(
        frameId,
        serializeViewFilter({
          kind: "eq",
          fieldId,
          value: value.trim(),
          raw: "",
        }),
      );
    }
    setValue("");
  };

  const top = Math.min(anchor.bottom + 4, window.innerHeight - 12);
  const left = Math.max(8, Math.min(anchor.right - 320, window.innerWidth - 328));

  return createPortal(
    <PopoverShell
      panelRef={panelRef}
      title="Filters"
      aria-label="View filters"
      data-testid="view-filter-popover"
      className="fixed"
      style={{ top, left }}
      onClick={(e) => e.stopPropagation()}
    >
      <div data-view-filter-popover="true" data-frame-id={frameId}>
        {config.filters.length === 0 ? (
          <p className="px-1.5 py-1 text-[12px] text-foreground/40">No filters</p>
        ) : (
          <ul className="mb-1 flex flex-col gap-0.5">
            {config.filters.map((f) => {
              const raw = f.raw || serializeViewFilter(f);
              return (
                <li
                  key={raw}
                  className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[12px] text-foreground/70 hover:bg-foreground/[0.04]"
                >
                  <span className="min-w-0 flex-1 truncate">{filterLabel(f)}</span>
                  <button
                    type="button"
                    className="flex h-5 w-5 items-center justify-center rounded-sm text-foreground/30 hover:text-foreground/60"
                    onClick={() => void mutations.removeViewFilter(frameId, raw)}
                    aria-label="Remove filter"
                  >
                    <X size={11} weight="bold" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <PrefFieldRow icon={Funnel} label="kind">
          <select
            className={POPOVER_VALUE_CLASS}
            value={kind}
            onChange={(e) => setKind(e.target.value as "eq" | "text")}
          >
            <option value="eq">field equals</option>
            <option value="text">text contains</option>
          </select>
        </PrefFieldRow>

        {kind === "eq" && (
          <PrefFieldRow icon={Funnel} label="field">
            <select
              className={POPOVER_VALUE_CLASS}
              value={fieldId}
              onChange={(e) => setFieldId(e.target.value)}
            >
              {fields.length === 0 ? (
                <option value="">No fields on rows</option>
              ) : (
                fields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.text}
                  </option>
                ))
              )}
            </select>
          </PrefFieldRow>
        )}

        <PrefFieldRow icon={TextT} label={kind === "text" ? "text" : "value"}>
          <input
            className={POPOVER_VALUE_CLASS}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder={kind === "text" ? "substring" : "value"}
          />
        </PrefFieldRow>

        <button
          type="button"
          className="mt-1 flex w-full items-center justify-center gap-1 rounded-md bg-foreground/[0.04] px-2 py-1 text-[11px] font-medium text-foreground/60 hover:bg-foreground/[0.08] hover:text-foreground/80"
          onClick={add}
        >
          <Plus size={12} weight="bold" />
          Add filter
        </button>
      </div>
    </PopoverShell>,
    document.body,
  );
}
