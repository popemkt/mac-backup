import { useOutlineStore } from "@/stores/outline.store";
import { useUiStore } from "@/stores/ui.store";

const MAX_ROWS = 500;

function Cell({ value }: { value: unknown }) {
  const nodes = useOutlineStore((s) => s.nodes);
  const jumpToNode = useOutlineStore((s) => s.jumpToNode);
  const setView = useUiStore((s) => s.setView);

  if (typeof value === "string" && nodes.has(value)) {
    const node = nodes.get(value)!;
    return (
      <button
        type="button"
        title={value}
        className="group flex max-w-xs flex-col text-left"
        onClick={() => {
          setView("outline");
          jumpToNode(value);
        }}
      >
        <span className="truncate text-[13px] text-teal-700 group-hover:underline">
          {node.text || "(empty)"}
        </span>
        <span className="truncate font-mono text-[10px] text-stone-400">
          {value}
        </span>
      </button>
    );
  }
  return (
    <span className="text-[13px] text-stone-700">
      {typeof value === "string" ? value : JSON.stringify(value)}
    </span>
  );
}

export function ResultsTable({ rows }: { rows: unknown[][] }) {
  if (rows.length === 0) {
    return <p className="px-1 py-3 text-[13px] text-stone-400">No rows.</p>;
  }
  const width = Math.max(...rows.map((r) => r.length));
  const shown = rows.slice(0, MAX_ROWS);
  return (
    <div className="overflow-auto rounded-md border border-stone-200">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-stone-200 bg-stone-50 text-left">
            {Array.from({ length: width }, (_, i) => (
              <th
                key={i}
                className="px-3 py-1.5 font-mono text-[11px] font-medium text-stone-500"
              >
                ?{i}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, ri) => (
            <tr
              key={ri}
              className="border-b border-stone-100 align-top last:border-0 hover:bg-stone-50/60"
            >
              {Array.from({ length: width }, (_, ci) => (
                <td key={ci} className="px-3 py-1.5">
                  <Cell value={row[ci]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > MAX_ROWS && (
        <p className="px-3 py-1.5 text-[11px] text-stone-400">
          showing {MAX_ROWS} of {rows.length} rows
        </p>
      )}
    </div>
  );
}
