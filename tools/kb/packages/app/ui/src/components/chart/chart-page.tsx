/**
 * The chart view: its source query node's rows drawn by its Vega-Lite spec,
 * filling the box its host gives it, live as the rows change. Above it, the
 * chart's name and source and the spec editor's toggle; a save writes the
 * spec to the view node the chart is drawn from (`ViewHost.viewNode`), or,
 * drawn from the view type alone, proposes a view node for its source.
 */
import { Suspense, lazy, useMemo, useState } from "react";
import { Result } from "effect";
import { BracketsCurlyIcon, ChartBarIcon } from "@phosphor-icons/react";
import { SYSTEM_IDS } from "@kb/model";
import { ChartView, viewNodeFor, type ChartParams, type ChartSpec } from "@kb/views";
import {
  IconButton,
  WorkspaceState,
  browserHost,
  nodePath,
  toast,
  useAppearance,
  useNode,
  usePane,
  type ViewProps,
} from "@/sdk";
import { useChartData, type ChartData } from "./chart-data";
import { SpecEditor } from "./spec-editor";

const ChartCanvas = lazy(() => import("./chart-canvas"));

/** The chart's box while Vega loads: quiet, the box's own size. */
function ChartPending() {
  return (
    <div
      aria-busy="true"
      className="min-h-0 flex-1 rounded-sm bg-foreground/[0.03] motion-safe:animate-pulse"
    />
  );
}

/** What stands in for the chart when there is nothing to draw. */
function Missing({ data, label }: { readonly data: ChartData; readonly label: string }) {
  if (data.kind === "missing" && data.reason === "no-source")
    return (
      <WorkspaceState
        title="This chart draws no query"
        description="Open it for a query node, or set its lens.focus to one."
      />
    );
  if (data.kind === "missing")
    return (
      <WorkspaceState
        title={`${label} is no query`}
        description="A chart draws a query node's rows. Turn this node into a query, or chart another one."
      />
    );
  if (data.kind === "error")
    return <WorkspaceState title="Its query cannot be run" description={data.message} />;
  return <WorkspaceState title="Running its query…" loading />;
}

export function ChartPage({ params, host }: ViewProps<ChartParams>) {
  const source = useNode(params.source) ?? null;
  const viewNode = useNode(host.viewNode);
  const appearance = useAppearance().key;
  const data = useChartData(source);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const pane = usePane();
  const sourceText = source?.text.trim() ?? "";
  const label = sourceText !== "" ? sourceText : (params.source ?? "This node");
  const viewText = viewNode?.text.trim() ?? "";
  const title = viewText !== "" ? viewText : label;
  const columns = useMemo(() => (data.kind === "rows" ? data.columns : []), [data]);

  const save = async (spec: ChartSpec): Promise<void> => {
    setSaving(true);
    try {
      if (host.viewNode !== undefined) {
        // The one check of a view node's settings, then the field it stores them in.
        const checked = viewNodeFor(ChartView, { spec }, params.source ?? null);
        if (Result.isFailure(checked)) {
          toast(`The spec cannot be saved: ${checked.failure.map((i) => i.message).join("; ")}`);
          return;
        }
        await browserHost().replaceField(
          host.viewNode,
          SYSTEM_IDS.chartField,
          checked.success.props[SYSTEM_IDS.chartField] ?? [],
        );
        setEditing(false);
        return;
      }
      const proposed = await browserHost().proposeView({
        view: ChartView,
        params: { spec },
        ...(params.source === undefined ? {} : { host: params.source }),
      });
      if ("refused" in proposed) {
        toast(`The chart cannot be saved: ${proposed.refused}`);
        return;
      }
      setEditing(false);
      if (params.source !== undefined)
        browserHost().navigatePane(pane, nodePath(params.source, proposed.id));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" data-chart-view="true">
      <header className="flex h-9 shrink-0 items-center gap-2 px-3">
        <ChartBarIcon size={14} className="shrink-0 text-foreground/40" aria-hidden />
        <h2 className="min-w-0 truncate text-ui font-medium text-foreground/80">{title}</h2>
        {data.kind === "rows" ? (
          <span className="shrink-0 text-label text-muted-foreground tabular-nums">
            {data.records.length} {data.records.length === 1 ? "row" : "rows"}
          </span>
        ) : null}
        <IconButton
          label={editing ? "Hide the spec" : "Edit the spec"}
          icon={BracketsCurlyIcon}
          size="md"
          className="ml-auto"
          aria-pressed={editing}
          onClick={() => setEditing(!editing)}
        />
      </header>
      {data.kind === "rows" ? (
        <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
          {/* Vega's chunk loads here, under the header that stays. */}
          <Suspense fallback={<ChartPending />}>
            <ChartCanvas spec={params.spec} records={data.records} appearance={appearance} />
          </Suspense>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <Missing data={data} label={label} />
        </div>
      )}
      {editing ? (
        <SpecEditor
          spec={params.spec}
          columns={columns}
          saving={saving}
          onSave={(spec) => void save(spec)}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </div>
  );
}
