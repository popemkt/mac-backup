import { Warning } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { navigate, ontologyPath, type OntologyView } from "@/lib/router";

export interface OntologyScopeBarProps {
  ontologyId: string;
  label: string;
  memberCount: number;
  warnings: string[];
  /** Which surface the scope is currently projected onto. */
  view: OntologyView;
  onExit: () => void;
}

const VIEWS: Array<{ key: OntologyView; label: string }> = [
  { key: "page", label: "Members" },
  { key: "outline", label: "Outline" },
  { key: "graph", label: "Graph" },
];

/**
 * Persistent scope chip: `⬡ Name · 412 members · Exit`.
 *
 * The chip is the identity of the filtered universe you are inside, and the
 * only always-present way out. Resolution warnings surface here rather than as
 * an error, because a broken definition must never make the scope unopenable.
 */
export function OntologyScopeBar({
  ontologyId,
  label,
  memberCount,
  warnings,
  view,
  onExit,
}: OntologyScopeBarProps) {
  return (
    <div
      className="flex h-8 shrink-0 items-center gap-2 border-b border-foreground/[0.06] bg-foreground/[0.015] px-4"
      data-ontology-scope-bar="true"
    >
      <span
        className="flex h-5 items-center gap-1 rounded-sm bg-primary/[0.10] px-1.5 text-[11px] font-medium text-primary"
        title={ontologyId}
      >
        <span aria-hidden>⬡</span>
        <span className="max-w-[16rem] truncate">{label}</span>
      </span>

      <span className="text-[11px] text-foreground/35">
        {memberCount} {memberCount === 1 ? "member" : "members"}
      </span>

      {warnings.length > 0 ? (
        <span
          className="flex items-center gap-1 text-[11px] text-warning"
          title={warnings.join("\n")}
          data-ontology-warnings={String(warnings.length)}
        >
          <Warning size={12} weight="bold" />
          {warnings.length}
        </span>
      ) : null}

      <div className="flex-1" />

      <div className="flex items-center gap-0.5">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            aria-pressed={v.key === view}
            className={cn(
              "rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors duration-100",
              v.key === view
                ? "bg-foreground/[0.08] text-foreground/75"
                : "text-foreground/35 hover:bg-foreground/[0.04] hover:text-foreground/60",
            )}
            onClick={() => navigate(ontologyPath(ontologyId, v.key))}
          >
            {v.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="ml-1 rounded-md px-2 py-0.5 text-[11px] text-foreground/40 transition-colors duration-100 hover:bg-foreground/[0.04] hover:text-foreground/70"
        onClick={onExit}
      >
        Exit
      </button>
    </div>
  );
}
