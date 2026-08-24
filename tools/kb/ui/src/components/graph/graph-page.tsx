import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { CircleHalf, Warning } from "@phosphor-icons/react";
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
import { listOntologyItems } from "@/lib/ontology-scope";
import { SYSTEM_IDS } from "@/lib/types";
import { cn } from "@/lib/cn";
import { graphPath, navigate, ontologyPath } from "@/lib/router";
import { OntologyPicker } from "@/components/ontology/ontology-picker";
import { PerspectivePicker } from "@/components/graph/perspective-picker";
import { RendererSwitch } from "@/components/graph/renderer-switch";
import { SigmaGraph } from "@/components/graph/sigma-graph";
import { ClusterGraph } from "@/components/graph/cluster-graph";
import { TreeGraph } from "@/components/graph/tree-graph";
import { GraphCanvasFrame } from "@/components/graph/graph-canvas-frame";
import type { GraphCameraControls } from "@/components/graph/graph-camera-controls";
import type { GraphSelection } from "@/components/graph/graph-selection-card";
import { SidebarToggle } from "@/components/sidebar/sidebar";

const Force3dGraph = lazy(() => import("@/components/graph/force3d-graph"));

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

const SYS_STORAGE_KEY = "kb-graph-include-sys";

export interface GraphPageProps {
  perspectiveId: string | null;
  /**
   * Ontology scope: render member nodes and their internal edges only. No new
   * renderer — an ontology is just another way of producing the node set.
   */
  ontologyId?: string | null;
}

export default function GraphPage({
  perspectiveId,
  ontologyId = null,
}: GraphPageProps) {
  const wireNodes = useOutlineStore((s) => s.wireNodes);
  const queryDb = useOutlineStore((s) => s.queryDb);
  const rev = useOutlineStore((s) => s.rev);
  const zoomTo = useOutlineStore((s) => s.zoomTo);
  const ontologyMembers = useOutlineStore((s) => s.ontologyMembers);
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
    // Under an ontology scope the URL is /o/<id>/graph; never rewrite it.
    if (!active || ontologyId) return;
    if (perspectiveId !== active.id) {
      navigate(graphPath(active.id));
    }
  }, [active, perspectiveId, ontologyId]);

  const restrictTo = ontologyId ? (ontologyMembers ?? new Set<string>()) : undefined;

  // An ontology decides WHICH nodes, a perspective decides how they look —
  // orthogonal, so both pickers sit in the header together (r5 §1.4).
  const ontologies = useMemo(
    () => listOntologyItems(wireNodes),
    [wireNodes, rev],
  );

  const [lensGraph, setLensGraph] = useState(() =>
    queryDb && active
      ? extractLensGraph(queryDb, wireNodes, active, {
          includeSystemNodes,
          ...(restrictTo ? { restrictTo } : {}),
        })
      : { nodes: [], edges: [], dropped: 0, queryError: null },
  );

  useEffect(() => {
    if (!queryDb || !active) return;
    const handle = window.setTimeout(() => {
      setLensGraph(
        extractLensGraph(queryDb, wireNodes, active, {
          includeSystemNodes,
          ...(restrictTo ? { restrictTo } : {}),
        }),
      );
    }, 300);
    return () => window.clearTimeout(handle);
  }, [queryDb, wireNodes, active, rev, includeSystemNodes, restrictTo]);

  const forest = useMemo(
    () =>
      active
        ? buildTreeForest(wireNodes, lensGraph.nodes, active.focus)
        : [],
    [wireNodes, lensGraph.nodes, active],
  );

  const themeKey = `${theme}:${dark ? "d" : "l"}`;
  const onNodeOpen = useCallback((id: string) => {
    navigate(ontologyId ? ontologyPath(ontologyId, "outline") : "/");
    zoomTo(id);
  }, [navigate, ontologyId, zoomTo]);

  const renderer = active?.renderer ?? "force2d";

  // Graph interaction state — selection + camera live on the frame, not per-renderer.
  const [controls, setControls] = useState<GraphCameraControls | null>(null);
  const [selection, setSelection] = useState<GraphSelection | null>(null);
  const [searchHighlight, setSearchHighlight] = useState<Set<string> | null>(null);
  const [filterIds, setFilterIds] = useState<Set<string> | null>(null);
  const [capDismissed, setCapDismissed] = useState(false);

  useEffect(() => { setCapDismissed(false); }, [lensGraph.dropped]);
  useEffect(() => {
    setSelection(null);
    setControls(null);
  }, [renderer]);

  const clearSelection = useCallback(() => setSelection(null), []);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-foreground/[0.06] px-4">
        <SidebarToggle />
        <span className="text-[13px] font-medium text-foreground/50">
          {ontologyId ? "ontology graph" : "graph"}
        </span>
        <PerspectivePicker
          perspectives={perspectives}
          activeId={active?.id ?? null}
          onSelect={(id) => navigate(graphPath(id))}
        />
        {ontologies.length > 0 ? (
          <OntologyPicker
            ontologies={ontologies}
            activeId={ontologyId}
            placeholder="all nodes"
            onSelect={(id) => navigate(ontologyPath(id, "graph"))}
            onClear={() => navigate(graphPath(active?.id ?? null))}
          />
        ) : null}
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
      <div className="relative min-h-0 flex-1" key={renderer} style={{ animation: "graph-fade-in 200ms ease-out" }}>
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
        ) : (
          <GraphCanvasFrame
            nodes={lensGraph.nodes}
            renderer={renderer}
            controls={controls}
            selectedNodeId={selection?.nodeId ?? null}
            selection={selection}
            onClearSelection={clearSelection}
            onOpenNode={onNodeOpen}
            onSearchChange={setSearchHighlight}
            onFilterChange={setFilterIds}
            queryError={lensGraph.queryError}
            resetKey={`${renderer}:${active.id}`}
            perspective={active}
          >
          {renderer === "tree" ? (
            <TreeGraph
            forest={forest}
            themeKey={themeKey}
            selectedNodeId={selection?.nodeId ?? null}
            onSelectionChange={setSelection}
            onControlsReady={setControls}
            />
          ) : renderer === "cluster" ? (
            <ClusterGraph
            nodes={lensGraph.nodes}
            edges={lensGraph.edges}
            layoutKey={active.id}
            themeKey={themeKey}
            onNodeClick={onNodeOpen}
            onControlsReady={setControls}
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
              onSelectionChange={setSelection}
              selectedNodeId={selection?.nodeId ?? null}
              onControlsReady={setControls}
              curvedLinks={active.curvedLinks}
              autorotate={active.autorotate}
              showLabels={active.showLabels}
              labelTopN={
                active.labelDensity === "low"
                  ? 12
                  : active.labelDensity === "high"
                    ? 48
                    : 24
              }
            />
            </Suspense>
          ) : (
            <SigmaGraph
              nodes={lensGraph.nodes}
              edges={lensGraph.edges}
              layoutKey={active.id}
              themeKey={themeKey}
              layout={active.layout}
              onNodeOpen={onNodeOpen}
              onSelectionChange={setSelection}
              selectedNodeId={selection?.nodeId ?? null}
              onControlsReady={setControls}
              highlightIds={searchHighlight ?? undefined}
              filterIds={filterIds ?? undefined}
            />
          )}
          </GraphCanvasFrame>
        )}
        {lensGraph.dropped > 0 && !capDismissed && (
          <div className="absolute left-1/2 top-3 z-30 -translate-x-1/2 flex items-center gap-2 rounded-lg border border-foreground/8 bg-popover/95 px-3 py-1.5 shadow-md backdrop-blur-sm">
            <span className="text-[11px] text-foreground/60">
              showing top {lensGraph.nodes.length} of {lensGraph.nodes.length + lensGraph.dropped} by degree
            </span>
            <button
              type="button"
              className="rounded-md bg-foreground/[0.06] px-2 py-0.5 text-[10px] font-medium text-foreground/60 transition-colors hover:bg-foreground/[0.1] hover:text-foreground/80"
              onClick={() => {
                if (active) { navigate("/"); zoomTo(active.id); }
              }}
            >
              edit max-nodes
            </button>
            <button
              type="button"
              className="text-foreground/30 hover:text-foreground/60 text-[11px]"
              onClick={() => setCapDismissed(true)}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
