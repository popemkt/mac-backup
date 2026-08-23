import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleHalf, Warning } from "@phosphor-icons/react";
import type Sigma from "sigma";
import { mutations } from "@/actions/mutations";
import { useOutlineStore } from "@/stores/outline.store";
import { usePrefsStore, resolveDark } from "@/stores/prefs.store";
import { useUiStore } from "@/stores/ui.store";
import {
  buildTreeForest,
  extractLensGraph,
  listPerspectiveNodes,
  parsePerspective,
  type LensPerspective,
  type LensRenderer,
} from "@/lib/graph-lens";
import { SYSTEM_IDS } from "@/lib/types";
import { cn } from "@/lib/cn";
import { graphPath, navigate } from "@/lib/router";
import { PerspectivePicker } from "@/components/graph/perspective-picker";
import { RendererSwitch } from "@/components/graph/renderer-switch";
import { SigmaGraph, type GraphSelection } from "@/components/graph/sigma-graph";
import { ClusterGraph } from "@/components/graph/cluster-graph";
import { TreeGraph } from "@/components/graph/tree-graph";
import { GraphToolbar } from "@/components/graph/graph-toolbar";
import { GraphLegend } from "@/components/graph/graph-legend";
import { SidebarToggle } from "@/components/sidebar/sidebar";

const Force3dGraph = lazy(() => import("@/components/graph/force3d-graph"));

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

const SYS_STORAGE_KEY = "kb-graph-include-sys";

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

  const [includeSystemNodes, setIncludeSystemNodes] = useState(() => {
    try {
      return localStorage.getItem(SYS_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const toggleSys = () => {
    setIncludeSystemNodes((v) => {
      const next = !v;
      try { localStorage.setItem(SYS_STORAGE_KEY, next ? "1" : "0"); } catch {}
      return next;
    });
  };

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

  useEffect(() => {
    if (!active) return;
    if (perspectiveId !== active.id) {
      navigate(graphPath(active.id));
    }
  }, [active, perspectiveId]);

  const [lensGraph, setLensGraph] = useState(() =>
    queryDb && active
      ? extractLensGraph(queryDb, wireNodes, active, { includeSystemNodes })
      : { nodes: [], edges: [], dropped: 0, queryError: null },
  );

  useEffect(() => {
    if (!queryDb || !active) return;
    const handle = window.setTimeout(() => {
      setLensGraph(
        extractLensGraph(queryDb, wireNodes, active, { includeSystemNodes }),
      );
    }, 300);
    return () => window.clearTimeout(handle);
  }, [queryDb, wireNodes, active, rev, includeSystemNodes]);

  const forest = useMemo(
    () =>
      active
        ? buildTreeForest(wireNodes, lensGraph.nodes, active.focus)
        : [],
    [wireNodes, lensGraph.nodes, active],
  );

  const themeKey = `${theme}:${dark ? "d" : "l"}`;

  const onNodeOpen = useCallback((id: string) => {
    navigate("/");
    zoomTo(id);
  }, [zoomTo]);

  const renderer = active?.renderer ?? "force2d";

  // Graph interaction state
  const sigmaInstanceRef = useRef<Sigma | null>(null);
  const [selection, setSelection] = useState<GraphSelection | null>(null);
  const [searchHighlight, setSearchHighlight] = useState<Set<string> | null>(null);
  const [filterIds, setFilterIds] = useState<Set<string> | null>(null);

  const nodeIds = useMemo(() => lensGraph.nodes.map((n) => n.id), [lensGraph.nodes]);

  const showForce2d = renderer === "force2d";

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-foreground/[0.06] px-4">
        <SidebarToggle />
        <span className="text-[13px] font-medium text-foreground/50">graph</span>
        <PerspectivePicker
          perspectives={perspectives}
          activeId={active?.id ?? null}
          onSelect={(id) => navigate(graphPath(id))}
        />
        {active ? (
          <RendererSwitch
            value={renderer}
            onChange={(r: LensRenderer) => {
              void mutations.setLensRenderer(active.id, r);
            }}
          />
        ) : null}
        <button
          type="button"
          className={cn(
            "rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors duration-100",
            includeSystemNodes
              ? "bg-foreground/[0.08] text-foreground/70"
              : "text-foreground/35 hover:bg-foreground/[0.04] hover:text-foreground/55",
          )}
          data-elide-toggle="true"
          aria-pressed={includeSystemNodes}
          title={
            includeSystemNodes
              ? "Hide sys / command / schema nodes"
              : "Show sys / command / schema nodes"
          }
          onClick={toggleSys}
        >
          {includeSystemNodes ? "sys on" : "sys off"}
        </button>
        <span className="text-[11px] text-foreground/30">
          {lensGraph.nodes.length} nodes · {lensGraph.edges.length} edges
          {lensGraph.dropped > 0 && (
            <span
              className="ml-1 cursor-help text-foreground/40"
              title={`Showing top ${lensGraph.nodes.length} of ${lensGraph.nodes.length + lensGraph.dropped} by degree. Edit this perspective’s max-nodes to widen.`}
            >
              −{lensGraph.dropped}
            </span>
          )}
        </span>
        {lensGraph.queryError && (
          <span
            className="flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-600 dark:text-amber-400"
            title={lensGraph.queryError}
          >
            <Warning size={12} /> query error
          </span>
        )}
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
      <div className="relative min-h-0 flex-1">
        {!active || !queryDb ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-center text-[13px] text-foreground/40">
              No graph perspectives seeded.
            </p>
          </div>
        ) : lensGraph.nodes.length === 0 && !lensGraph.queryError ? (
          <div className="flex h-full items-center justify-center">
            <p className="max-w-xs text-center text-[13px] text-foreground/40">
              0 nodes match — edit this perspective’s query to broaden the view.
            </p>
          </div>
        ) : renderer === "tree" ? (
          <TreeGraph
            forest={forest}
            themeKey={themeKey}
            onNodeClick={onNodeOpen}
          />
        ) : renderer === "cluster" ? (
          <ClusterGraph
            nodes={lensGraph.nodes}
            edges={lensGraph.edges}
            layoutKey={active.id}
            themeKey={themeKey}
            onNodeClick={onNodeOpen}
          />
        ) : renderer === "force3d" ? (
          <Suspense
            fallback={
              <div className="p-6 text-[13px] text-foreground/40">
                loading 3D…
              </div>
            }
          >
            <Force3dGraph
              nodes={lensGraph.nodes}
              edges={lensGraph.edges}
              layoutKey={active.id}
              themeKey={themeKey}
              onNodeClick={onNodeOpen}
            />
          </Suspense>
        ) : (
          <>
            <SigmaGraph
              nodes={lensGraph.nodes}
              edges={lensGraph.edges}
              layoutKey={active.id}
              themeKey={themeKey}
              onNodeOpen={onNodeOpen}
              onSelectionChange={setSelection}
              sigmaRef={sigmaInstanceRef}
              highlightIds={searchHighlight ?? undefined}
              filterIds={filterIds ?? undefined}
            />
            <GraphToolbar
              sigmaRef={sigmaInstanceRef}
              selectedNodeId={selection?.nodeId ?? null}
              nodeIds={nodeIds}
              onSearchChange={setSearchHighlight}
            />
            <GraphLegend
              nodes={lensGraph.nodes}
              onFilterChange={setFilterIds}
            />
          </>
        )}
      </div>
    </div>
  );
}
