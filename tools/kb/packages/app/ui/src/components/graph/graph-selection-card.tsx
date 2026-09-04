import type { LensNode } from "@/lib/graph-lens";

interface GraphSelectionCardProps {
  nodeId: string;
  nodes: LensNode[];
  onOpen: (id: string) => void;
  onClose: () => void;
  onFocus?: () => void;
  /** Hide Focus when the active renderer cannot focus. */
  canFocus?: boolean;
}

/** Floating selection card shared across renderers (click selects; Open navigates). */
export function GraphSelectionCard({
  nodeId,
  nodes,
  onOpen,
  onClose,
  onFocus,
  canFocus = true,
}: GraphSelectionCardProps) {
  const meta = nodes.find((n) => n.id === nodeId);
  if (!meta) return null;

  return (
    <div
      className="absolute bottom-4 left-4 z-30 flex max-w-xs flex-col gap-1.5 rounded-lg border border-foreground/10 bg-popover/95 p-3 shadow-xl backdrop-blur-sm"
      data-testid="graph-selection-card"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-semibold leading-tight text-foreground/90">
          {meta.label}
        </span>
        <button
          type="button"
          className="shrink-0 text-[11px] text-foreground/40 hover:text-foreground/70"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      {meta.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {meta.tags.slice(0, 5).map((t) => (
            <span
              key={t}
              className="rounded bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] text-foreground/60"
            >
              {t}
            </span>
          ))}
        </div>
      )}
      <span className="text-[11px] text-foreground/40">
        {meta.degree} connection{meta.degree !== 1 ? "s" : ""}
      </span>
      <div className="flex gap-2 pt-0.5">
        <button
          type="button"
          className="rounded-md bg-foreground/[0.06] px-2.5 py-1 text-[11px] font-medium text-foreground/70 transition-colors hover:bg-foreground/[0.1] hover:text-foreground/90"
          onClick={() => onOpen(nodeId)}
        >
          Open
        </button>
        {canFocus && onFocus ? (
          <button
            type="button"
            className="rounded-md px-2.5 py-1 text-[11px] font-medium text-foreground/50 transition-colors hover:bg-foreground/[0.06] hover:text-foreground/70"
            onClick={onFocus}
          >
            Focus (f)
          </button>
        ) : null}
      </div>
    </div>
  );
}
