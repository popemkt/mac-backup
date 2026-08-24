import { useMemo, useState } from "react";
import { Plus, X } from "@phosphor-icons/react";
import { mutations } from "@/actions/mutations";
import { useOutlineStore } from "@/stores/outline.store";
import { SYSTEM_IDS } from "@/lib/types";
import { cn } from "@/lib/cn";
import { FieldRow } from "./field-row";

export interface TagFieldRef {
  id: string;
  name: string;
}

export interface TagFieldsConfigViewProps {
  tagId: string;
  /** Fields this tag templates onto its members, in `sys.f.fields` order. */
  template: TagFieldRef[];
  /** Existing fields not yet on this tag, offered so names get reused. */
  suggestions: TagFieldRef[];
  readOnly: boolean;
  onAdd: (name: string) => void;
  onRemove: (fieldId: string) => void;
  onOpen: (fieldId: string) => void;
}

/**
 * A tag's field template — the `sys.f.fields` refs every member inherits.
 *
 * `mutations.addTagField` / `removeTagField` / `defineField` all existed and
 * were tested, but no component called them: i7 removed the bespoke tag config
 * panel and nothing replaced the gesture, so there was no way to add a field
 * from the UI at all — only the CLI. Tags are ordinary nodes, so this lives on
 * the tag's own page beside its other fields rather than in a special panel.
 *
 * Kept as a pure view with a connected wrapper below: store reads do not
 * survive `renderToStaticMarkup`, so the logic has to be testable without one.
 */
export function TagFieldsConfigView({
  tagId,
  template,
  suggestions,
  readOnly,
  onAdd,
  onRemove,
  onOpen,
}: TagFieldsConfigViewProps) {
  const [draft, setDraft] = useState("");

  function commit() {
    const name = draft.trim();
    if (!name) return;
    onAdd(name);
    setDraft("");
  }

  return (
    <div className="mb-4" data-tag-fields-config="true">
      <h2 className="mb-2 px-1 text-[12px] uppercase tracking-wide text-foreground/30">
        Fields
        <span className="ml-1.5 font-normal normal-case tracking-normal">
          ({template.length})
        </span>
      </h2>

      {template.length === 0 && (
        <p className="px-1 pb-1 text-[13px] text-foreground/50" role="status">
          No fields yet — anything tagged with this gets the fields you add here.
        </p>
      )}

      {template.map((field) => (
        <FieldRow key={field.id} depth={-1} label={field.name} fieldId={field.id}>
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <button
              type="button"
              className="ml-auto text-[11px] text-foreground/40 underline-offset-2 hover:text-foreground/70 hover:underline"
              onClick={() => onOpen(field.id)}
            >
              open
            </button>
            {!readOnly && (
              <button
                type="button"
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm",
                  "opacity-0 transition-opacity group-hover/node:opacity-60",
                  "hover:!opacity-100 focus-visible:opacity-100",
                  "focus-visible:ring-2 focus-visible:ring-primary/60 outline-none",
                )}
                title={`Remove ${field.name} from this tag`}
                aria-label={`Remove field ${field.name} from this tag`}
                onClick={() => onRemove(field.id)}
              >
                <X size={9} weight="bold" aria-hidden />
              </button>
            )}
          </div>
        </FieldRow>
      ))}

      {!readOnly && (
        <div className="mt-1 flex items-center gap-1.5 px-1">
          <Plus
            size={10}
            weight="bold"
            className="text-foreground/40"
            aria-hidden
          />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                setDraft("");
              }
            }}
            onBlur={commit}
            list={`tag-field-suggestions-${tagId}`}
            placeholder="Add field"
            aria-label="Add a field to this tag"
            className={cn(
              "min-w-0 flex-1 bg-transparent text-[13px] text-foreground",
              "placeholder:text-foreground/35 outline-none",
            )}
          />
          <datalist id={`tag-field-suggestions-${tagId}`}>
            {suggestions.map((f) => (
              <option key={f.id} value={f.name} />
            ))}
          </datalist>
        </div>
      )}
    </div>
  );
}

/** Split out so it can be exercised without a store or a live component. */
export function resolveTagFields(
  nodes: Map<string, { text: string; props: Record<string, { t: string; v: unknown }[]> }>,
  tagId: string,
): { template: TagFieldRef[]; suggestions: TagFieldRef[]; all: TagFieldRef[] } {
  const tag = nodes.get(tagId);
  const templateIds = (tag?.props[SYSTEM_IDS.fieldsField] ?? [])
    .filter((v) => v.t === "ref")
    .map((v) => String(v.v));

  const all: TagFieldRef[] = [];
  for (const [id, node] of nodes) {
    const types = node.props[SYSTEM_IDS.typeField] ?? [];
    if (types.some((v) => v.t === "ref" && v.v === SYSTEM_IDS.field)) {
      all.push({ id, name: node.text });
    }
  }
  all.sort((a, b) => a.name.localeCompare(b.name));

  const byId = new Map(all.map((f) => [f.id, f]));
  return {
    // Keep the tag's own order, and still show a ref whose field node is gone.
    template: templateIds.map((id) => byId.get(id) ?? { id, name: id }),
    suggestions: all.filter((f) => !templateIds.includes(f.id)),
    all,
  };
}

export function TagFieldsConfig({ tagId }: { tagId: string }) {
  const nodes = useOutlineStore((s) => s.nodes);
  const zoomTo = useOutlineStore((s) => s.zoomTo);

  const { template, suggestions, all } = useMemo(
    () => resolveTagFields(nodes, tagId),
    [nodes, tagId],
  );

  return (
    <TagFieldsConfigView
      tagId={tagId}
      template={template}
      suggestions={suggestions}
      readOnly={tagId.startsWith("sys.")}
      onOpen={zoomTo}
      onRemove={(fieldId) => void mutations.removeTagField(tagId, fieldId)}
      onAdd={(name) => {
        void (async () => {
          // Reuse an existing field with this name rather than minting a
          // duplicate; two fields called "status" would silently split every
          // query written against them.
          const existing = all.find(
            (f) => f.name.toLowerCase() === name.toLowerCase(),
          );
          const fieldId = existing?.id ?? (await mutations.defineField(name));
          if (!fieldId) return;
          if (!template.some((f) => f.id === fieldId)) {
            await mutations.addTagField(tagId, fieldId);
          }
        })();
      }}
    />
  );
}
