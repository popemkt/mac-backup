import { useCallback, useEffect, useState } from "react";
import { invokeAction } from "@/api/action";
import { useUiStore } from "@/stores/ui.store";

interface RenderedView {
  name: string;
  format: "html" | "md";
  content: string;
}

/**
 * Rendered-view panel: saved view (query + template) rendered to HTML by
 * the server's render backbone (`render.view` action), shown in a
 * sandboxed iframe. Same layer that feeds docs/kb/*.md and MCP `ui://`
 * resources.
 */
export function ViewPanel() {
  const pushToast = useUiStore((s) => s.pushToast);
  const [views, setViews] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [html, setHtml] = useState<string>("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    invokeAction<{ views: string[] }>("render.views")
      .then(({ views }) => {
        if (cancelled) return;
        setViews(views);
        setSelected((cur) =>
          cur || (views.includes("todos") ? "todos" : (views[0] ?? "")),
        );
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          pushToast(
            "error",
            `views unavailable: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pushToast]);

  const render = useCallback(
    (name: string) => {
      if (!name) return;
      setLoading(true);
      invokeAction<RenderedView>("render.view", { name, format: "html" })
        .then((view) => setHtml(view.content))
        .catch((err: unknown) =>
          pushToast(
            "error",
            `render failed: ${err instanceof Error ? err.message : String(err)}`,
          ),
        )
        .finally(() => setLoading(false));
    },
    [pushToast],
  );

  useEffect(() => {
    if (selected) render(selected);
  }, [selected, render]);

  return (
    <section className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-[13px] font-semibold text-stone-700">
          Rendered view
        </h2>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="rounded border border-stone-300 bg-white px-2 py-1 text-[12px]"
          aria-label="Saved view"
        >
          {views.length === 0 && <option value="">no views</option>}
          {views.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => render(selected)}
          disabled={!selected || loading}
          className="rounded border border-stone-300 bg-white px-2 py-1 text-[12px] text-stone-600 hover:bg-stone-50 disabled:opacity-50"
        >
          {loading ? "rendering…" : "refresh"}
        </button>
      </div>
      {html ? (
        <iframe
          title={`kb view: ${selected}`}
          sandbox=""
          srcDoc={html}
          className="h-72 w-full rounded-md border border-stone-200 bg-white"
        />
      ) : (
        <p className="text-[12px] text-stone-400">
          Select a saved view to render it through the server render layer.
        </p>
      )}
    </section>
  );
}
