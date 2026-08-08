import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Hash, Eye, EyeSlash, Plus, X } from "@phosphor-icons/react";
import { mutations } from "@/actions/mutations";
import { cn } from "@/lib/cn";
import { isFieldNodeHidden } from "@/lib/field-visibility";
import { TAG_PALETTE } from "@/lib/tag-color";
import { isSysPrefixed, SYSTEM_IDS, type NodeMap } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { FieldRow } from "./field-row";
import { TagChip } from "./tag-chip";

interface TagConfigPanelProps {
  tagId: string;
  anchorRect: DOMRect;
  onClose: () => void;
}

function listTagFields(tagId: string, nodes: NodeMap): string[] {
  const tag = nodes.get(tagId);
  if (!tag) return [];
  return (tag.props[SYSTEM_IDS.fieldsField] ?? [])
    .filter((v) => v.t === "ref")
    .map((v) => v.v);
}

function listFieldCandidates(nodes: NodeMap, exclude: Set<string>): Array<{
  id: string;
  text: string;
}> {
  const out: Array<{ id: string; text: string }> = [];
  for (const n of nodes.values()) {
    const types = n.props[SYSTEM_IDS.typeField] ?? [];
    const isField = types.some(
      (v) => v.t === "ref" && v.v === SYSTEM_IDS.field,
    );
    if (!isField || exclude.has(n.id)) continue;
    out.push({ id: n.id, text: n.text || n.id });
  }
  return out.sort((a, b) => a.text.localeCompare(b.text) || a.id.localeCompare(b.id));
}

export function TagConfigPanel({
  tagId,
  anchorRect,
  onClose,
}: TagConfigPanelProps) {
  const nodes = useOutlineStore((s) => s.nodes);
  const tag = nodes.get(tagId);
  const [tab, setTab] = useState<"fields" | "appearance">("fields");
  const [addingField, setAddingField] = useState(false);
  const [newFieldName, setNewFieldName] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  const fieldIds = useMemo(() => listTagFields(tagId, nodes), [tagId, nodes]);
  const colorProp = tag?.props[SYSTEM_IDS.colorField]?.[0];
  const explicitColor =
    colorProp?.t === "str" ? String(colorProp.v) : undefined;

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const style = useMemo(() => {
    const top = anchorRect.top + anchorRect.height + 4;
    const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - 340));
    return {
      position: "fixed" as const,
      top: Math.min(top, window.innerHeight - 420),
      left,
      zIndex: 100,
    };
  }, [anchorRect]);

  const handleDefineField = useCallback(async () => {
    const name = newFieldName.trim();
    if (!name) return;
    const id = await mutations.defineField(name);
    if (id) {
      await mutations.addTagField(tagId, id);
      setNewFieldName("");
      setAddingField(false);
    }
  }, [newFieldName, tagId]);

  if (!tag) return null;

  return createPortal(
    <div
      ref={panelRef}
      className={cn(
        "w-[320px] max-h-[400px] overflow-y-auto rounded-lg",
        "border border-foreground/10 bg-popover shadow-xl",
        "text-[13px] text-foreground/80",
      )}
      style={style}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 border-b border-foreground/[0.06] px-3 py-2">
        <Hash size={14} weight="bold" style={{ color: explicitColor }} />
        <span className="flex-1 truncate font-medium text-foreground/70">
          {tag.text || tagId}
        </span>
        <button
          type="button"
          className="rounded-sm p-0.5 text-foreground/30 hover:bg-foreground/8 hover:text-foreground/60"
          onClick={onClose}
        >
          <X size={14} weight="bold" />
        </button>
      </div>

      <div className="flex border-b border-foreground/[0.06]">
        {(["fields", "appearance"] as const).map((key) => (
          <button
            key={key}
            type="button"
            className={cn(
              "flex-1 px-3 py-1.5 text-[11px] font-medium transition-colors",
              tab === key
                ? "border-b-2 border-foreground/30 text-foreground/70"
                : "text-foreground/30 hover:text-foreground/50",
            )}
            onClick={() => setTab(key)}
          >
            {key === "fields" ? "Fields" : "Appearance"}
          </button>
        ))}
      </div>

      {tab === "fields" ? (
        <div className="px-1 py-1">
          {fieldIds.map((fieldId) => {
            const fieldNode = nodes.get(fieldId);
            const hidden = isFieldNodeHidden(fieldId, nodes);
            const readOnly = isSysPrefixed(fieldId);
            return (
              <FieldRow
                key={fieldId}
                depth={-1}
                fieldId={fieldId}
                label={fieldNode?.text ?? fieldId}
                onRemove={() => void mutations.removeTagField(tagId, fieldId)}
              >
                <div className="flex min-h-6 items-center justify-between gap-2">
                  <span className="kb-text truncate text-foreground/50">
                    {fieldId}
                  </span>
                  <button
                    type="button"
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-sm",
                      "text-foreground/30 transition-colors hover:bg-foreground/8 hover:text-foreground/60",
                      readOnly && "cursor-default opacity-40",
                    )}
                    title={
                      readOnly
                        ? "System field visibility is read-only"
                        : hidden
                          ? "Show field on nodes"
                          : "Hide field on nodes"
                    }
                    disabled={readOnly}
                    onClick={() =>
                      void mutations.setFieldHidden(fieldId, !hidden)
                    }
                  >
                    {hidden ? (
                      <EyeSlash size={13} weight="bold" />
                    ) : (
                      <Eye size={13} weight="bold" />
                    )}
                  </button>
                </div>
              </FieldRow>
            );
          })}

          {addingField ? (
            <FieldRow depth={-1} label="New field">
              <input
                type="text"
                value={newFieldName}
                onChange={(e) => setNewFieldName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleDefineField();
                  if (e.key === "Escape") {
                    setAddingField(false);
                    setNewFieldName("");
                  }
                }}
                className="kb-text w-full border-none bg-transparent text-foreground/70 outline-none"
                placeholder="Field name…"
                autoFocus
              />
            </FieldRow>
          ) : (
            <button
              type="button"
              className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-[11px] text-foreground/30 hover:bg-foreground/[0.03] hover:text-foreground/50"
              onClick={() => setAddingField(true)}
            >
              <Plus size={12} weight="bold" />
              Define new field
            </button>
          )}

          {listFieldCandidates(nodes, new Set(fieldIds)).length > 0 && (
            <div className="mt-1 border-t border-foreground/[0.06] pt-1">
              <div className="px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-foreground/25">
                Add existing
              </div>
              {listFieldCandidates(nodes, new Set(fieldIds)).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-[12px] text-foreground/50 hover:bg-foreground/[0.03]"
                  onClick={() => void mutations.addTagField(tagId, f.id)}
                >
                  {f.text}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3 px-3 py-3">
          <div className="text-[10px] font-medium uppercase tracking-wider text-foreground/30">
            Color
          </div>
          <div className="flex flex-wrap gap-1.5">
            {TAG_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                className={cn(
                  "h-4 w-4 rounded-full border-2 transition-all",
                  explicitColor === c
                    ? "scale-110 border-foreground/40"
                    : "border-transparent hover:border-foreground/20",
                )}
                style={{ backgroundColor: c }}
                onClick={() =>
                  void mutations.setTagColor(
                    tagId,
                    explicitColor === c ? null : c,
                  )
                }
              />
            ))}
          </div>
          <div className="pt-1">
            <TagChip
              tag={{
                id: tagId,
                name: tag.text || tagId,
                color: explicitColor ?? "#6366f1",
              }}
            />
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
