import type { TraceAnswer } from "@kb/graph";
import type { LensNode } from "./graph-lens";
import type { GraphTrace } from "./graph-trace";

interface GraphTraceCardProps {
  trace: GraphTrace;
  answer: TraceAnswer | null;
  nodes: LensNode[];
  /** Save the trace as a perspective named `name`; absent where the renderer cannot hold one. */
  onSave?: (name: string) => void;
  saving?: boolean;
  onClose: () => void;
}

const labelOf = (nodes: LensNode[], id: string | null) =>
  nodes.find((n) => n.id === id)?.label ?? id ?? "";

/**
 * The trace's card, in the selection card's place: while picking, what to
 * do next; once both ends are chosen, each path with its hops explained,
 * and saving it as a perspective.
 */
export function GraphTraceCard({
  trace,
  answer,
  nodes,
  onSave,
  saving,
  onClose,
}: GraphTraceCardProps) {
  const title =
    trace.to === null
      ? `Trace from ${labelOf(nodes, trace.from)}`
      : `${labelOf(nodes, trace.from)} → ${labelOf(nodes, trace.to)}`;
  return (
    <div
      className="kb-surface-enter absolute bottom-4 right-4 z-30 flex max-h-[60%] max-w-sm flex-col gap-2 overflow-y-auto rounded-lg border border-foreground/10 bg-popover/95 p-3 shadow-overlay backdrop-blur-sm"
      data-testid="graph-trace-card"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-ui font-semibold leading-tight text-foreground/90">{title}</span>
        <button
          type="button"
          className="shrink-0 text-label text-foreground/40 hover:text-foreground/70"
          onClick={onClose}
          aria-label="Close trace"
        >
          ✕
        </button>
      </div>
      {trace.to === null ? (
        <span className="text-label text-foreground/50">
          Pick the node to trace to. Esc cancels.
        </span>
      ) : answer === null ? null : answer.paths.length === 0 ? (
        <span className="text-label text-foreground/50">{answer.reason?.message}</span>
      ) : (
        <ol className="flex flex-col gap-1.5" aria-label="Paths">
          {answer.paths.map((path, i) => (
            <li key={path.nodes.join(" ")} className="flex flex-col gap-0.5">
              <span className="text-caption font-medium text-foreground/40">
                Path {i + 1} · {path.hops.length} hop{path.hops.length === 1 ? "" : "s"}
              </span>
              {path.hops.map((hop) => (
                <span key={`${hop.from}>${hop.to}`} className="text-label text-foreground/70">
                  {hop.sentence}
                </span>
              ))}
            </li>
          ))}
        </ol>
      )}
      {answer?.warnings.map((warning) => (
        <span key={warning} className="text-caption text-warning">
          {warning}
        </span>
      ))}
      {onSave && answer !== null && answer.paths.length > 0 ? (
        <div className="flex gap-2 pt-0.5">
          <button
            type="button"
            className="rounded-md bg-foreground/[0.06] px-2.5 py-1 text-label font-medium text-foreground/70 transition-colors hover:bg-foreground/[0.1] hover:text-foreground/90 disabled:opacity-50"
            disabled={saving}
            onClick={() => onSave(title)}
          >
            {saving === true ? "Saving…" : "Save as perspective"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
