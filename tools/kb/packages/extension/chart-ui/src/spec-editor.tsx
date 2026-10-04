/**
 * A chart's settings, edited as what they are: its Vega-Lite spec as JSON,
 * checked as it is typed by the chart's own key (`paramsIssues`, strict, the
 * check `view.propose` makes), each issue shown at its path. Saving is the
 * caller's: it holds the view node, or makes one.
 */
// GAP [[01M4187E5QQYRD8ENHQM968EEJ]] No chart builder: a person edits the spec as JSON,
// with the query's columns named beside it; picking a mark and fields by hand
// waits on a form over the spec's encoding.
import { useMemo, useState } from "react";
import { Result } from "effect";
import { ChartView, type ChartSpec } from "@kb/chart";
import { issueText, paramsIssues } from "@kb/views";
import { cn } from "@kb/ui-sdk";

/** The spec as a person reads it: indented JSON. */
function specText(spec: ChartSpec): string {
  return JSON.stringify(spec, null, 2);
}

type Checked =
  | { readonly spec: ChartSpec; readonly issues?: undefined }
  | { readonly spec?: undefined; readonly issues: readonly string[] };

/** `text` read as a chart's spec: the spec, or every reason it is not one. */
function checkSpec(text: string): Checked {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (err) {
    return { issues: [`not JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  const params = paramsIssues(ChartView, { spec: parsed }, true);
  return Result.isSuccess(params)
    ? { spec: params.success.spec }
    : { issues: params.failure.map((issue) => issueText({ ...issue, path: issue.path.slice(1) })) };
}

const BUTTON = cn(
  "rounded-sm px-2 py-1 text-label font-medium outline-none transition duration-100",
  "focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-default disabled:opacity-40",
);

export function SpecEditor({
  spec,
  columns,
  saving,
  onSave,
  onClose,
}: {
  readonly spec: ChartSpec;
  /** The query's column names: what the spec's fields may name. */
  readonly columns: readonly string[];
  readonly saving: boolean;
  readonly onSave: (spec: ChartSpec) => void;
  readonly onClose: () => void;
}) {
  const initial = useMemo(() => specText(spec), [spec]);
  const [text, setText] = useState(initial);
  const checked = useMemo(() => checkSpec(text), [text]);
  const changed = text !== initial;
  return (
    <section
      aria-label="Chart spec"
      className="flex max-h-[45%] min-h-40 shrink-0 flex-col border-t border-foreground/10 bg-card"
      data-chart-editor="true"
    >
      <div className="flex items-center gap-2 px-3 pt-2 pb-1.5">
        <p className="text-label font-medium uppercase tracking-wide text-foreground/45">
          Vega-Lite spec
        </p>
        {columns.length > 0 ? (
          <p className="min-w-0 truncate text-label text-muted-foreground">
            Fields:{" "}
            {columns.map((column, i) => (
              <span key={column}>
                {i > 0 ? ", " : ""}
                <code className="font-mono text-foreground/70">{column}</code>
              </span>
            ))}
          </p>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            className={cn(BUTTON, "text-foreground/60 hover:bg-foreground/[0.06]")}
            onClick={onClose}
          >
            {changed ? "Discard" : "Close"}
          </button>
          <button
            type="button"
            className={cn(BUTTON, "bg-primary text-primary-foreground hover:bg-primary/90")}
            disabled={!changed || checked.spec === undefined || saving}
            onClick={() => {
              if (checked.spec !== undefined) onSave(checked.spec);
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      <textarea
        aria-label="Vega-Lite spec as JSON"
        aria-invalid={checked.issues !== undefined}
        spellCheck={false}
        className={cn(
          "mx-3 min-h-24 flex-1 resize-none rounded-sm border bg-background p-2 font-mono text-label leading-relaxed text-foreground outline-none",
          "focus-visible:ring-2 focus-visible:ring-primary/40",
          checked.issues === undefined ? "border-foreground/10" : "border-destructive/50",
        )}
        defaultValue={initial}
        onInput={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
          if (event.key === "s" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            if (changed && checked.spec !== undefined) onSave(checked.spec);
          }
        }}
      />
      <ul className="min-h-7 px-3 py-1.5 text-meta" aria-live="polite">
        {checked.issues === undefined ? (
          <li className="text-muted-foreground">
            {changed ? "A valid spec. ⌘S saves it." : "The spec this chart draws."}
          </li>
        ) : (
          checked.issues.map((issue) => (
            <li key={issue} className="text-destructive">
              {issue}
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
