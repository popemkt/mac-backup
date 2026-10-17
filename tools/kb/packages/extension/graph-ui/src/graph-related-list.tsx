import { useState } from "react";
import type { SuggestedNode } from "@kb/graph";
import type { Related } from "./graph-related";

/** What a suggestion's evidence comes to, in a few words. */
function evidence({ reasons }: SuggestedNode): string {
  return [
    reasons.shared.length > 0 ? `${reasons.shared.length} shared` : "",
    reasons.tags.length > 0
      ? `${reasons.tags.length} tag${reasons.tags.length === 1 ? "" : "s"}`
      : "",
    reasons.citedBy.length > 0 ? `cited together ×${reasons.citedBy.length}` : "",
  ]
    .filter((part) => part !== "")
    .join(" · ");
}

/** The card's related list: each row named, its evidence, and "Link as…". */
export function RelatedList({ related }: { related: Related }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (related.suggestions.length === 0) return null;
  return (
    <div
      className="flex flex-col gap-1 border-t border-foreground/[0.06] pt-1.5"
      data-testid="graph-related"
    >
      <span className="text-caption font-medium uppercase tracking-wide text-foreground/40">
        Related, not connected
      </span>
      {related.suggestions.map((s) => {
        const fields = related.typing.fieldsFor(s.id);
        return (
          <div key={s.id} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-label text-foreground/75">{s.text}</span>
              <span className="text-caption text-foreground/40">{evidence(s)}</span>
            </span>
            <select
              className="max-w-28 shrink-0 rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-caption text-foreground/70 disabled:opacity-50"
              aria-label={`Link ${s.text} as`}
              disabled={fields.length === 0}
              title={fields.length === 0 ? "No ref field allows this node" : undefined}
              value=""
              onChange={(e) => {
                const field = e.target.value;
                if (field === "") return;
                void related.typing.link(s.id, field).then((ok) => setFailed(ok ? null : s.id));
              }}
            >
              <option value="">Link as…</option>
              {fields.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.text}
                </option>
              ))}
            </select>
          </div>
        );
      })}
      {failed !== null ? (
        <span className="text-caption text-warning">Could not link; nothing was written.</span>
      ) : null}
    </div>
  );
}
