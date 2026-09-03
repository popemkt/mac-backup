import { useMemo, useState } from "react";
import { Bullet } from "@/components/outline/bullet";
import { NodeRow } from "@/components/outline/node-row";
import { createCanvasNode, listCanvasNodes } from "@/lib/canvas-api";
import { navigate } from "@/lib/router";
import { useOutlineStore } from "@/stores/outline.store";

export function CanvasListPage() {
  const nodes = useOutlineStore((s) => s.nodes);
  const canvases = useMemo(() => listCanvasNodes(nodes), [nodes]);
  const [busy, setBusy] = useState(false);

  const onNew = async () => {
    setBusy(true);
    try {
      const id = await createCanvasNode();
      if (id) navigate(`/canvas/${id}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <button
            type="button"
            className="mb-1 text-[12px] text-foreground/40 hover:text-foreground/70"
            onClick={() => navigate("/")}
          >
            ← outline
          </button>
          <h2 className="text-[13px] font-medium text-foreground/80">Canvases</h2>
        </div>
        <button
          type="button"
          disabled={busy}
          className="rounded-md border border-foreground/10 px-3 py-1.5 text-[12px] text-foreground/70 hover:bg-foreground/5 disabled:opacity-50"
          onClick={() => void onNew()}
        >
          New canvas
        </button>
      </div>

      {canvases.length === 0 ? (
        <p className="text-[13px] text-foreground/40">
          No canvases yet. Create one to open a JSON Canvas board.
        </p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {canvases.map((n) => (
            <button
              key={n.id}
              type="button"
              className="w-full rounded-md text-left hover:bg-foreground/[0.03]"
              onClick={() => navigate(`/canvas/${n.id}`)}
            >
              <NodeRow
                depth={0}
                nodeId={n.id}
                bullet={
                  <Bullet
                    node={n}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/canvas/${n.id}`);
                    }}
                  />
                }
                content={
                  <span className="truncate text-[13px] text-foreground/80">
                    {n.text || "Untitled canvas"}
                  </span>
                }
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
