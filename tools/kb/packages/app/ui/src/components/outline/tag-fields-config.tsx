import { useMemo, useRef, useState } from "react";
import { pickerRows } from "@/lib/picker";
import { usePickerKeys } from "@/lib/use-picker";
import { PickerList } from "@/components/ui/picker-list";
import { PlusIcon, XIcon } from "@phosphor-icons/react";
import { mutations } from "@/actions/mutations";
import { schemaOf } from "@/lib/schema";
import { useOutlineStore } from "@/stores/outline.store";
import { isSysPrefixed } from "@/lib/types";
import { cn } from "@/lib/cn";
import { FieldRow } from "./field-row";
import { resolveTagFields, type TagFieldRef } from "./tag-fields";

export interface TagFieldsConfigViewProps {
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
  template,
  suggestions,
  readOnly,
  onAdd,
  onRemove,
  onOpen,
}: TagFieldsConfigViewProps) {
  const [draft, setDraft] = useState("");
  const [picking, setPicking] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  function add(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setDraft("");
  }

  // Adding a field is the one node picker over the fields not yet here, with
  // a create row for a name none of them has.
  const candidates = useMemo(
    () => suggestions.map((f) => ({ id: f.id, label: f.name })),
    [suggestions],
  );
  const rows = useMemo(
    () => pickerRows(candidates, { query: draft, canCreate: true, limit: 12 }),
    [candidates, draft],
  );
  const keys = usePickerKeys({
    rows,
    query: draft,
    onPick: (row) => add(row === null ? draft : row.kind === "item" ? row.label : row.name),
    onCancel: () => setDraft(""),
  });

  return (
    <div className="mb-4" data-tag-fields-config="true">
      <h2 className="mb-2 px-1 text-meta uppercase tracking-wide text-foreground/30">
        Fields
        <span className="ml-1.5 font-normal normal-case tracking-normal">({template.length})</span>
      </h2>

      {template.length === 0 && (
        <p className="px-1 pb-1 text-ui text-foreground/50" role="status">
          No fields yet — anything tagged with this gets the fields you add here.
        </p>
      )}

      {template.map((field) => (
        <FieldRow key={field.id} depth={-1} label={field.name} fieldId={field.id}>
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <button
              type="button"
              className="ml-auto text-label text-foreground/40 underline-offset-2 hover:text-foreground/70 hover:underline"
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
                <XIcon size={9} weight="bold" aria-hidden />
              </button>
            )}
          </div>
        </FieldRow>
      ))}

      {!readOnly && (
        <div className="mt-1 flex items-center gap-1.5 px-1">
          <PlusIcon size={10} weight="bold" className="text-foreground/40" aria-hidden />
          <div ref={anchorRef} className="relative min-w-0 flex-1">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={() => setPicking(true)}
              onKeyDown={(e) => {
                keys.handleKeyDown(e);
              }}
              onBlur={() => {
                setPicking(false);
                add(draft);
              }}
              placeholder="Add field"
              aria-label="Add a field to this tag"
              className={cn(
                "w-full bg-transparent text-ui text-foreground",
                "placeholder:text-foreground/35 outline-none",
              )}
            />
            {picking && (
              <PickerList
                placement="popover"
                anchorRef={anchorRef}
                rows={rows}
                activeIndex={keys.activeIndex}
                onHover={keys.setActiveIndex}
                onPick={(row) => add(row.kind === "item" ? row.label : row.name)}
                createLabel={(name) => `Create field "${name}"`}
                aria-label="Fields"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function TagFieldsConfig({ tagId }: { tagId: string }) {
  const schema = useOutlineStore(schemaOf);
  const zoomTo = useOutlineStore((s) => s.zoomTo);

  const { template, suggestions, all } = useMemo(
    () => resolveTagFields(schema, tagId),
    [schema, tagId],
  );

  return (
    <TagFieldsConfigView
      template={template}
      suggestions={suggestions}
      readOnly={isSysPrefixed(tagId)}
      onOpen={zoomTo}
      onRemove={(fieldId) => void mutations.removeTagField(tagId, fieldId)}
      onAdd={(name) => {
        void (async () => {
          // Reuse an existing field with this name rather than minting a
          // duplicate; two fields called "status" would silently split every
          // query written against them.
          const existing = all.find((f) => f.name.toLowerCase() === name.toLowerCase());
          const fieldId = existing?.id ?? (await mutations.defineField(name));
          if (fieldId === null) return;
          if (!template.some((f) => f.id === fieldId)) {
            await mutations.addTagField(tagId, fieldId);
          }
        })();
      }}
    />
  );
}
