import { useEffect, useMemo, useState } from "react";
import { CircleHalf } from "@phosphor-icons/react";
import { useOutlineStore } from "@/stores/outline.store";
import { usePrefsStore, resolveDark } from "@/stores/prefs.store";
import { useUiStore } from "@/stores/ui.store";
import {
  extractLensGraph,
  listPerspectiveNodes,
  parsePerspective,
  type LensPerspective,
} from "@/lib/graph-lens";
import { SYSTEM_IDS } from "@/lib/types";
import { graphPath, navigate } from "@/lib/router";
import { PerspectivePicker } from "@/components/graph/perspective-picker";
import { SigmaGraph } from "@/components/graph/sigma-graph";

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
  const prefsOpen = useUiStore((s) => s.prefsOpen);
  const setPrefsOpen = useUiStore((s) => s.setPrefsOpen);

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

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-foreground/[0.06] px-4">
        <button
          type="button"
          className="text-[13px] text-foreground/40 transition-colors duration-100 hover:text-foreground/70"
          onClick={() => navigate("/")}
        >
          ← outline
        </button>
        <span className="text-[13px] font-medium text-foreground/50">graph</span>
        <PerspectivePicker
          perspectives={perspectives}
          activeId={active?.id ?? null}
          onSelect={(id) => navigate(graphPath(id))}
        />
        <span className="text-[11px] text-foreground/30">
          {lensGraph.nodes.length} nodes · {lensGraph.edges.length} edges
          {lensGraph.dropped > 0 ? ` · −${lensGraph.dropped}` : ""}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded-md text-foreground/40 transition-colors duration-100 hover:bg-foreground/5 hover:text-foreground/70"
          aria-label="Preferences"
          title="Preferences"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setPrefsOpen(!prefsOpen)}
        >
          <CircleHalf size={15} />
        </button>
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
            layoutKey={active.id}
            themeKey={`${theme}:${dark ? "d" : "l"}:${rev}`}
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
