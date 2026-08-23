import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { CircleHalf } from "@phosphor-icons/react";
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
import { graphPath, navigate, ontologyPath } from "@/lib/router";
import { PerspectivePicker } from "@/components/graph/perspective-picker";
import { RendererSwitch } from "@/components/graph/renderer-switch";
import { SigmaGraph } from "@/components/graph/sigma-graph";
import { ClusterGraph } from "@/components/graph/cluster-graph";
import { TreeGraph } from "@/components/graph/tree-graph";
import { SidebarToggle } from "@/components/sidebar/sidebar";

/** Heavier three.js bundle — must stay out of the sigma/graph-page chunk. */
const Force3dGraph = lazy(() => import("@/components/graph/force3d-graph"));

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

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

  /** Local pref: show sys/command/schema nodes (smart-elide off). */
  const [includeSystemNodes, setIncludeSystemNodes] = useState(false);

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

  const [lensGraph, setLensGraph] = useState(() =>
    queryDb && active
      ? extractLensGraph(queryDb, wireNodes, active, {
          includeSystemNodes,
          ...(restrictTo ? { restrictTo } : {}),
        })
      : { nodes: [], edges: [], dropped: 0 },
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

  // Theme tokens only — topology updates via nodes/edges props (not remount).
  const themeKey = `${theme}:${dark ? "d" : "l"}`;
  const onNodeClick = (id: string) => {
    navigate(ontologyId ? ontologyPath(ontologyId, "outline") : "/");
    zoomTo(id);
  };

  const renderer = active?.renderer ?? "force2d";

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
          onClick={() => setIncludeSystemNodes((v) => !v)}
        >
          {includeSystemNodes ? "sys on" : "sys off"}
        </button>
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
        ) : renderer === "tree" ? (
          <TreeGraph
            forest={forest}
            themeKey={themeKey}
            onNodeClick={onNodeClick}
          />
        ) : renderer === "cluster" ? (
          <ClusterGraph
            nodes={lensGraph.nodes}
            edges={lensGraph.edges}
            layoutKey={active.id}
            themeKey={themeKey}
            onNodeClick={onNodeClick}
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
              onNodeClick={onNodeClick}
            />
          </Suspense>
        ) : (
          <SigmaGraph
            nodes={lensGraph.nodes}
            edges={lensGraph.edges}
            layoutKey={active.id}
            themeKey={themeKey}
            onNodeClick={onNodeClick}
          />
        )}
      </div>
    </div>
  );
}
