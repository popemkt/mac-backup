import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X } from "@phosphor-icons/react";
import { mutations } from "@/actions/mutations";
import { SYSTEM_IDS } from "@/lib/types";
import {
  getViewConfig,
  serializeViewFilter,
  type ViewFilter,
} from "@/lib/view-config";
import { useOutlineStore } from "@/stores/outline.store";
import { useUiStore } from "@/stores/ui.store";
import { FieldRow } from "./field-row";

interface ViewFilterPopoverProps {
  frameId: string;
}

function listFieldOptions(
  nodes: ReturnType<typeof useOutlineStore.getState>["nodes"],
): Array<{ id: string; text: string }> {
  const out: Array<{ id: string; text: string }> = [];
  for (const n of nodes.values()) {
    const types = n.props[SYSTEM_IDS.typeField] ?? [];
    if (types.some((v) => v.t === "ref" && v.v === SYSTEM_IDS.field)) {
      if (n.id.startsWith("sys.")) continue;
      out.push({ id: n.id, text: n.text || n.id });
    }
  }
  return out.sort((a, b) => a.text.localeCompare(b.text));
}

function filterLabel(f: ViewFilter): string {
  if (f.kind === "text") return `text ∋ ${f.text}`;
  return `${f.fieldId} = ${f.value}`;
}

/** Inline filter editor anchored under the ViewToolbar ⚙ button. */
export function ViewFilterPopover({ frameId }: ViewFilterPopoverProps) {
  const openId = useUiStore((s) => s.filterPopoverFrameId);
  const setOpenId = useUiStore((s) => s.setFilterPopoverFrameId);
  const open = openId === frameId;
  const frame = useOutlineStore((s) => s.nodes.get(frameId));
  const nodes = useOutlineStore((s) => s.nodes);
  const panelRef = useRef<HTMLDivElement>(null);

  const config = getViewConfig(frame?.props);
  const fields = useMemo(() => listFieldOptions(nodes), [nodes]);

  const [kind, setKind] = useState<"eq" | "text">("eq");
  const [fieldId, setFieldId] = useState("");
  const [value, setValue] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenId(null);
    };
    const onPointerDown = (e: PointerEvent) => {
      const panel = panelRef.current;
      if (panel && e.target instanceof Node && !panel.contains(e.target)) {
        setOpenId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, setOpenId]);

  useEffect(() => {
    if (!fieldId && fields[0]) setFieldId(fields[0].id);
  }, [fields, fieldId]);

  if (!open) return null;

  const add = () => {
    if (kind === "text") {
      const text = value.trim();
      if (!text) return;
      void mutations.addViewFilter(
        frameId,
        serializeViewFilter({ kind: "text", text, raw: "" }),
      );
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

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="View filters"
      className="absolute right-0 top-full z-40 mt-1 w-[320px] rounded-lg border border-foreground/10 bg-popover p-2 shadow-xl"
      data-view-filter-popover="true"
      onClick={(e) => e.stopPropagation()}
    >
      <h2 className="px-1.5 pb-1 pt-0.5 text-[12px] uppercase tracking-wide text-foreground/30">
        Filters
      </h2>

      {config.filters.length === 0 ? (
        <p className="px-1.5 py-1 text-[12px] text-foreground/40">
          No filters
        </p>
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

      <FieldRow depth={-1} label="kind">
        <select
          className="min-w-0 flex-1 bg-transparent text-[14.5px] text-foreground/70 outline-none"
          value={kind}
          onChange={(e) => setKind(e.target.value as "eq" | "text")}
        >
          <option value="eq">field equals</option>
          <option value="text">text contains</option>
        </select>
      </FieldRow>

      {kind === "eq" && (
        <FieldRow depth={-1} label="field">
          <select
            className="min-w-0 flex-1 bg-transparent text-[14.5px] text-foreground/70 outline-none"
            value={fieldId}
            onChange={(e) => setFieldId(e.target.value)}
          >
            {fields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.text}
              </option>
            ))}
          </select>
        </FieldRow>
      )}

      <FieldRow depth={-1} label={kind === "text" ? "text" : "value"}>
        <input
          className="min-w-0 flex-1 bg-transparent text-[14.5px] text-foreground/70 outline-none"
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
      </FieldRow>

      <button
        type="button"
        className="mt-1 flex w-full items-center justify-center gap-1 rounded-md bg-foreground/[0.04] px-2 py-1 text-[11px] font-medium text-foreground/60 hover:bg-foreground/[0.08] hover:text-foreground/80"
        onClick={add}
      >
        <Plus size={12} weight="bold" />
        Add filter
      </button>
    </div>
  );
}
