import { useEffect, useMemo, useState } from "react";
import { useOutlineStore } from "@/stores/outline.store";
import { usePrefsStore, resolveDark } from "@/stores/prefs.store";
import {
  extractLensGraph,
  listPerspectiveNodes,
  parsePerspective,
  type LensPerspective,
} from "@/lib/graph-lens";
import { SYSTEM_IDS } from "@/lib/types";
import { graphPath, navigate } from "@/lib/route";
import { SigmaGraph } from "@/components/graph/sigma-graph";

function readToken(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export interface GraphPageProps {
  perspectiveId: string | null;
}

export default function GraphPage({ perspectiveId }: GraphPageProps) {
  const wireNodes = useOutlineStore((s) => s.wireNodes);
  const queryDb = useOutlineStore((s) => s.queryDb);
  const rev = useOutlineStore((s) => s.rev);
  const zoomTo = useOutlineStore((s) => s.zoomTo);
  const theme = usePrefsStore((s) => s.theme);
  const dark = resolveDark(theme, systemPrefersDark());

  const perspectives = useMemo(
    () => listPerspectiveNodes(wireNodes).map(parsePerspective),
    [wireNodes, rev],
  );

  const active: LensPerspective | null = useMemo(() => {
    if (perspectives.length === 0) return null;
    if (perspectiveId) {
      const hit = perspectives.find((p) => p.id === perspectiveId);
      if (hit) return hit;
    }
    return (
      perspectives.find((p) => p.id === SYSTEM_IDS.lensAllMentions) ??
      perspectives[0]!
    );
  }, [perspectives, perspectiveId]);

  // Keep URL in sync when defaulting.
  useEffect(() => {
    if (!active) return;
    if (perspectiveId !== active.id) {
      navigate(graphPath(active.id));
    }
  }, [active, perspectiveId]);

  const [lensGraph, setLensGraph] = useState(() =>
    queryDb && active
      ? extractLensGraph(queryDb, wireNodes, active)
      : { nodes: [], edges: [], dropped: 0 },
  );

  // Debounced re-extract on store rev / perspective change; camera preserved in SigmaGraph.
  useEffect(() => {
    if (!queryDb || !active) return;
    const handle = window.setTimeout(() => {
      setLensGraph(extractLensGraph(queryDb, wireNodes, active));
    }, 300);
    return () => window.clearTimeout(handle);
  }, [queryDb, wireNodes, active, rev]);

  const background = readToken("--background", dark ? "#1a1a1a" : "#ffffff");
  const labelColor = readToken("--foreground", dark ? "#f5f5f5" : "#222222");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-foreground/[0.06] px-4">
        <button
          type="button"
          className="text-[13px] text-foreground/40 transition-colors duration-100 hover:text-foreground/70"
          onClick={() => navigate("/")}
        >
          ← outline
        </button>
        <span className="text-[13px] font-medium text-foreground/50">graph</span>
        <select
          className="min-w-0 max-w-xs cursor-pointer appearance-none rounded-sm border-none bg-transparent text-[13px] text-foreground/70 outline-none hover:text-foreground/85"
          aria-label="Perspective"
          value={active?.id ?? ""}
          onChange={(e) => navigate(graphPath(e.target.value))}
          disabled={!active}
        >
          {perspectives.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <span className="text-[11px] text-foreground/30">
          {lensGraph.nodes.length} nodes · {lensGraph.edges.length} edges
          {lensGraph.dropped > 0 ? ` · −${lensGraph.dropped}` : ""}
        </span>
        <div className="flex-1" />
      </header>
      <div className="min-h-0 flex-1">
        {!active || !queryDb ? (
          <div className="p-6 text-[13px] text-foreground/40">
            No graph perspectives seeded.
          </div>
        ) : (
          <SigmaGraph
            nodes={lensGraph.nodes}
            edges={lensGraph.edges}
            background={background}
            labelColor={labelColor}
            layoutKey={`${active.id}:${rev}:${lensGraph.nodes.length}:${lensGraph.edges.length}`}
            onNodeClick={(id) => {
              navigate("/");
              zoomTo(id);
            }}
          />
        )}
      </div>
    </div>
  );
}
