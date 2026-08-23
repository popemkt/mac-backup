/**
 * Field-type + ref-constraint editors shared by tag config Fields tab
 * and zoomed field schema section. Uses FieldRow (§0) for type/target/query.
 */
import { useMemo, useState } from "react";
import { X } from "@phosphor-icons/react";
import { mutations } from "@/actions/mutations";
import { cn } from "@/lib/cn";
import {
  FIELD_TYPES,
  resolveFieldType,
  resolveTargetQuery,
  resolveTargetTags,
  type FieldType,
} from "@/lib/field-type";
import { resolveTagColor } from "@/lib/tag-color";
import { isSysPrefixed, SYSTEM_IDS, type NodeMap } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { FieldRow } from "./field-row";
import { TagChip } from "./tag-chip";

function listTagCandidates(
  nodes: NodeMap,
  exclude: Set<string>,
): Array<{ id: string; text: string; color: string }> {
  const out: Array<{ id: string; text: string; color: string }> = [];
  for (const n of nodes.values()) {
    if (exclude.has(n.id)) continue;
    const types = n.props[SYSTEM_IDS.typeField] ?? [];
    const isTag = types.some(
      (v) => v.t === "ref" && v.v === SYSTEM_IDS.tag,
    );
    if (!isTag) continue;
    const colorProp = n.props[SYSTEM_IDS.colorField]?.[0];
    const explicit =
      colorProp?.t === "str" ? String(colorProp.v) : undefined;
    out.push({
      id: n.id,
      text: n.text || n.id,
      color: resolveTagColor(n.id, explicit),
    });
  }
  return out.sort(
    (a, b) => a.text.localeCompare(b.text) || a.id.localeCompare(b.id),
  );
}

export function FieldTypeConfig({
  fieldId,
  compact = false,
}: {
  fieldId: string;
  compact?: boolean;
}) {
  const nodes = useOutlineStore((s) => s.nodes);
  const zoomTo = useOutlineStore((s) => s.zoomTo);
  const fieldNode = nodes.get(fieldId);
  const readOnly = isSysPrefixed(fieldId);
  const fieldType = resolveFieldType(fieldNode);
  const targetTags = resolveTargetTags(fieldNode);
  const targetQuery = resolveTargetQuery(fieldNode) ?? "";
  const [showQuery, setShowQuery] = useState(Boolean(targetQuery));
  const [queryDraft, setQueryDraft] = useState(targetQuery);
  const [addingTag, setAddingTag] = useState(false);

  const tagCandidates = useMemo(
    () => listTagCandidates(nodes, new Set(targetTags)),
    [nodes, targetTags],
  );

  if (!fieldNode) return null;

  return (
    <div
      className={cn("flex min-w-0 flex-col", compact && "gap-0")}
      data-field-type-config={fieldId}
    >
      <FieldRow
        depth={compact ? -1 : 0}
        fieldType={fieldType}
        fieldId={fieldId}
        label="type"
      >
        <select
          className={cn(
            "h-6 w-full appearance-none border-none bg-transparent",
            "text-[11px] text-foreground/60 outline-none",
            readOnly && "opacity-50",
          )}
          value={fieldType}
          disabled={readOnly}
          onChange={(e) =>
            void mutations.setFieldType(fieldId, e.target.value as FieldType)
          }
          aria-label="Field type"
        >
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </FieldRow>

      {fieldType === "ref" && (
        <>
          <FieldRow
            depth={compact ? -1 : 0}
            fieldType="ref"
            fieldId={fieldId}
            label="target"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              {targetTags.map((tagId) => {
                const tag = nodes.get(tagId);
                const colorProp = tag?.props[SYSTEM_IDS.colorField]?.[0];
                const explicit =
                  colorProp?.t === "str" ? String(colorProp.v) : undefined;
                return (
                  <span
                    key={tagId}
                    className="inline-flex items-center gap-0.5"
                  >
                    <TagChip
                      tag={{
                        id: tagId,
                        name: tag?.text || tagId,
                        color: resolveTagColor(tagId, explicit),
                      }}
                      onClick={() => zoomTo(tagId)}
                    />
                    {!readOnly && (
                      <button
                        type="button"
                        className="rounded-sm p-0.5 text-foreground/25 hover:bg-foreground/8 hover:text-foreground/50"
                        title="Remove target tag"
                        onClick={() =>
                          void mutations.removeFieldTargetTag(fieldId, tagId)
                        }
                      >
                        <X size={10} weight="bold" />
                      </button>
                    )}
                  </span>
                );
              })}
              {!readOnly &&
                (addingTag ? (
                  <select
                    className="h-5 border-none bg-transparent text-[11px] text-foreground/50 outline-none"
                    autoFocus
                    defaultValue=""
                    onChange={(e) => {
                      const id = e.target.value;
                      if (id) void mutations.addFieldTargetTag(fieldId, id);
                      setAddingTag(false);
                    }}
                    onBlur={() => setAddingTag(false)}
                  >
                    <option value="">tag…</option>
                    {tagCandidates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.text}
                      </option>
                    ))}
                  </select>
                ) : (
                  <button
                    type="button"
                    className="text-[11px] text-foreground/30 hover:text-foreground/50"
                    onClick={() => setAddingTag(true)}
                  >
                    + tag
                  </button>
                ))}
            </div>
          </FieldRow>

          {!readOnly && (
            <FieldRow
              depth={compact ? -1 : 0}
              fieldType="text"
              fieldId={fieldId}
              label="query"
            >
              {showQuery || targetQuery ? (
                <input
                  type="text"
                  value={queryDraft}
                  onChange={(e) => setQueryDraft(e.target.value)}
                  onBlur={() => {
                    if (queryDraft.trim() !== targetQuery) {
                      void mutations.setFieldTargetQuery(
                        fieldId,
                        queryDraft.trim() || null,
                      );
                    }
                    if (!queryDraft.trim()) setShowQuery(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter")
                      (e.target as HTMLInputElement).blur();
                    e.stopPropagation();
                  }}
                  placeholder="[:find ?id :where …]"
                  className={cn(
                    "w-full rounded-sm border-none bg-foreground/[0.03] px-1.5 py-1",
                    "font-mono text-[11px] text-foreground/60 outline-none",
                    "placeholder:text-foreground/25",
                  )}
                  spellCheck={false}
                />
              ) : (
                <button
                  type="button"
                  className="self-start text-[11px] text-foreground/30 hover:text-foreground/50"
                  onClick={() => setShowQuery(true)}
                >
                  query…
                </button>
              )}
            </FieldRow>
          )}
        </>
      )}
    </div>
  );
}
