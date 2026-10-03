/**
 * Where Vega draws: the chart's own chunk, the only module of the UI that
 * loads the chart stack (`@kb/vega`, behind the lazy-chunk fence). It keeps
 * one Vega view per spec and appearance; new rows are swapped into that view
 * (`CHART_DATA`) and a new box resizes it, so a live update or a pane resize
 * never rebuilds the chart.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CHART_DATA, chartSpecWithData, fillsChartBox, type ChartSpec } from "@kb/chart";
import { chartView } from "@kb/chart-vega";
import { logWarn } from "@/sdk";
import { chartTheme } from "./chart-theme";

type View = ReturnType<typeof chartView>;

type Records = readonly Readonly<Record<string, unknown>>[];

interface Box {
  readonly width: number;
  readonly height: number;
}

interface Tip {
  readonly x: number;
  readonly y: number;
  readonly rows: readonly (readonly [string, string])[];
}

/** A tooltip value as rows of label and value: an object's fields, or the one value. */
function tipRows(value: unknown): readonly (readonly [string, string])[] {
  if (value === null || value === undefined) return [];
  if (typeof value !== "object")
    return [["", typeof value === "string" ? value : JSON.stringify(value)]];
  return Object.entries(value).map(([key, inner]) => [
    key,
    typeof inner === "string" ? inner : JSON.stringify(inner),
  ]);
}

/** The element's content box, kept current. */
function useBox(element: HTMLElement | null): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  useLayoutEffect(() => {
    if (element === null) return undefined;
    const measure = () => {
      const width = Math.floor(element.clientWidth);
      const height = Math.floor(element.clientHeight);
      setBox((prev) =>
        prev !== null && prev.width === width && prev.height === height ? prev : { width, height },
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return box;
}

/** Fresh copies: Vega marks the objects it ingests. */
const copied = (records: Records) => records.map((record) => ({ ...record }));

export default function ChartCanvas({
  spec,
  records,
  appearance,
}: {
  readonly spec: ChartSpec;
  readonly records: Records;
  /** Changes exactly when the tokens the theme reads do (`useAppearance().key`). */
  readonly appearance: string;
}) {
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const target = useRef<HTMLDivElement>(null);
  const view = useRef<View | null>(null);
  const latest = useRef({ records, box: null as Box | null });
  const box = useBox(frame);
  const [tip, setTip] = useState<Tip | null>(null);
  const ready = box !== null && box.width > 0;
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- the appearance is what the tokens the theme reads hold; the theme reads them, not the key
  const theme = useMemo(() => chartTheme(), [appearance]);
  // Before the effects below read them: the rows and box a new view starts from.
  useLayoutEffect(() => {
    latest.current = { records, box };
  });

  // One view per spec and appearance, drawn into the target once the box is known.
  useEffect(() => {
    const element = target.current;
    const at = latest.current.box;
    if (!ready || element === null || at === null) return undefined;
    let built: View;
    try {
      built = chartView(chartSpecWithData(spec, copied(latest.current.records), at), {
        config: theme,
        container: element,
        renderer: "svg",
        tooltip: (_handler, event, _item, value) => {
          const rows = tipRows(value);
          const bounds = element.getBoundingClientRect();
          setTip(
            rows.length === 0
              ? null
              : { x: event.clientX - bounds.left, y: event.clientY - bounds.top, rows },
          );
        },
      });
    } catch (err) {
      logWarn(`[kb/chart] cannot draw: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
    view.current = built;
    built.runAsync().catch((err: unknown) => logWarn(`[kb/chart] ${String(err)}`));
    return () => {
      view.current = null;
      built.finalize();
      element.replaceChildren();
      setTip(null);
    };
  }, [spec, theme, ready]);

  // New rows go into the view it has.
  useEffect(() => {
    const current = view.current;
    if (current === null) return;
    current.data(CHART_DATA, copied(records));
    current.runAsync().catch((err: unknown) => logWarn(`[kb/chart] ${String(err)}`));
  }, [records]);

  // A new box resizes the view, when the chart fills its box.
  useEffect(() => {
    const current = view.current;
    if (current === null || box === null || !fillsChartBox(spec)) return;
    current.width(box.width).height(box.height);
    current.runAsync().catch((err: unknown) => logWarn(`[kb/chart] ${String(err)}`));
  }, [box, spec]);

  return (
    <div
      ref={setFrame}
      className="relative min-h-0 flex-1 overflow-hidden"
      data-chart-canvas="true"
    >
      <div
        ref={target}
        className="absolute inset-0"
        role="img"
        aria-label="Chart"
        onPointerLeave={() => setTip(null)}
      />
      {tip === null ? null : (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 max-w-64 rounded-md border border-foreground/10 bg-popover px-2 py-1.5 text-meta text-popover-foreground shadow-floating"
          style={{
            left: Math.min(tip.x + 12, Math.max(0, (box?.width ?? 0) - 200)),
            top: tip.y + 12,
          }}
        >
          {tip.rows.map(([key, value]) => (
            <div key={key} className="flex gap-2 tabular-nums">
              {key === "" ? null : <span className="text-muted-foreground">{key}</span>}
              <span className="ml-auto truncate font-medium">{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
