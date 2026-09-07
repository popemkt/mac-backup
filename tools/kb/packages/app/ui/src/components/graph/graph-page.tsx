import { GRAPH_RENDERERS } from "./graph-renderers";
import { useCallback, useEffect, useMemo, useState } from "react";
import { WarningIcon } from "@phosphor-icons/react";
import { mutations } from "@/actions/mutations";
import { useOutlineStore } from "@/stores/outline.store";
import { usePrefsStore, useDarkTheme, useSidebarToggle } from "@/stores/prefs.store";
import { useUiStore } from "@/stores/ui.store";
import {
  buildTreeForest,
  extractLensGraph,
  listPerspectiveNodes,
  parsePerspective,
  type LensPerspective,
  type LensRenderer,
} from "@/lib/graph-lens";
import { hasText } from "@/lib/text";
import { listOntologyItems } from "@/lib/ontology-scope";
import { SYSTEM_IDS } from "@/lib/types";
import { cn } from "@/lib/cn";
import { graphPath, navigate, ontologyPath } from "@/lib/router";
import { OntologyPicker } from "@/components/ui/ontology-picker";
import { PerspectivePicker } from "@/components/graph/perspective-picker";
import { RendererSwitch } from "@/components/graph/renderer-switch";
import { GraphCanvasFrame } from "@/components/graph/graph-canvas-frame";
import type { GraphCameraControls } from "@/components/graph/graph-camera-controls";
import { selectionFromNode, type GraphSelection } from "@/components/graph/graph-selection";
import { SidebarToggle } from "@/components/ui/sidebar-toggle";
import { ThemeIcon } from "@/components/ui/theme-icon";
import { WorkspaceState } from "@/components/ui/workspace-state";

const SYS_STORAGE_KEY = "kb-graph-include-sys";

export interface GraphPageProps {
  perspectiveId: string | null;
  /**
   * Ontology scope: render member nodes and their internal edges only. No new
   * renderer — an ontology is just another way of producing the node set.
   */
  ontologyId?: string | null;
}

// oxlint-disable-next-line complexity -- GAP [[01M1MGCFTMWY5EYHEWP9QVH8Z9]]
export default function GraphPage({ perspectiveId, ontologyId = null }: GraphPageProps) {
  const wireNodes = useOutlineStore((s) => s.wireNodes);
  const queryDb = useOutlineStore((s) => s.index);
  const generation = useOutlineStore((s) => s.index?.generation ?? 0);
  const zoomTo = useOutlineStore((s) => s.zoomTo);
  const ontologyMembers = useOutlineStore((s) => s.ontologyMembers);
  const theme = usePrefsStore((s) => s.theme);
  const dark = useDarkTheme();
  const sidebar = useSidebarToggle();
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
      try {
        localStorage.setItem(SYS_STORAGE_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  };

  const perspectives = useMemo(
    () => listPerspectiveNodes(wireNodes).map(parsePerspective),
    [wireNodes],
  );

  const active: LensPerspective | null = useMemo(() => {
    if (perspectives.length === 0) return null;
    if (perspectiveId !== null) {
      const hit = perspectives.find((p) => p.id === perspectiveId);
      if (hit) return hit;
    }
    return perspectives.find((p) => p.id === SYSTEM_IDS.lensAllMentions) ?? perspectives[0] ?? null;
  }, [perspectives, perspectiveId]);

  useEffect(() => {
    // Under an ontology scope the URL is /o/<id>/graph; never rewrite it.
    if (!active || ontologyId !== null) return;
    if (perspectiveId !== active.id) {
      navigate(graphPath(active.id));
    }
  }, [active, perspectiveId, ontologyId]);

  const restrictTo = useMemo(
    () => (ontologyId !== null ? (ontologyMembers ?? new Set<string>()) : undefined),
    [ontologyId, ontologyMembers],
  );

  // An ontology decides WHICH nodes, a perspective decides how they look —
  // orthogonal, so both pickers sit in the header together (r5 §1.4).
  const ontologies = useMemo(() => listOntologyItems(wireNodes), [wireNodes]);

  const [lensGraph, setLensGraph] = useState(() =>
    queryDb && active
      ? extractLensGraph(queryDb, wireNodes, active, {
          includeSystemNodes,
          ...(restrictTo ? { restrictTo } : {}),
        })
      : { nodes: [], edges: [], dropped: 0, queryError: null },
  );

  useEffect(() => {
    if (!queryDb || !active) return undefined;
    const handle = window.setTimeout(() => {
      setLensGraph(
        extractLensGraph(queryDb, wireNodes, active, {
          includeSystemNodes,
          ...(restrictTo ? { restrictTo } : {}),
        }),
      );
    }, 300);
    return () => window.clearTimeout(handle);
  }, [queryDb, wireNodes, active, generation, includeSystemNodes, restrictTo]);

  const forest = useMemo(
    () => (active ? buildTreeForest(lensGraph.nodes, lensGraph.edges, active.focus) : []),
    [lensGraph.nodes, lensGraph.edges, active],
  );

  const themeKey = `${theme}:${dark ? "d" : "l"}`;
  const onNodeOpen = useCallback(
    (id: string) => {
      navigate(ontologyId !== null ? ontologyPath(ontologyId, "outline") : "/");
      zoomTo(id);
    },
    [ontologyId, zoomTo],
  );

  const renderer = active?.renderer ?? "force2d";

  const Adapter = GRAPH_RENDERERS[renderer]?.Component;

  // Graph interaction state — selection + camera live on the frame, not per-renderer.
  const [controls, setControls] = useState<GraphCameraControls | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedNode = lensGraph.nodes.find((node) => node.id === selectedId);
  const selection = selectedNode ? selectionFromNode(selectedNode) : null;
  const setSelection = useCallback(
    (value: GraphSelection | null) => setSelectedId(value?.nodeId ?? null),
    [],
  );
  const [searchHighlight, setSearchHighlight] = useState<Set<string> | null>(null);
  const [filterIds, setFilterIds] = useState<Set<string> | null>(null);
  const [capDismissed, setCapDismissed] = useState(false);

  useEffect(() => {
    setCapDismissed(false);
  }, [lensGraph.dropped]);
  useEffect(() => {
    if (selectedId !== null && !lensGraph.nodes.some((node) => node.id === selectedId))
      setSelectedId(null);
  }, [lensGraph.nodes, selectedId]);

  const clearSelection = useCallback(() => setSelectedId(null), []);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <header className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-foreground/[0.06] px-4 py-2">
        <SidebarToggle {...sidebar} />
        <span className="text-[13px] font-medium text-foreground/50">
          {ontologyId !== null ? "ontology graph" : "graph"}
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
        {hasText(lensGraph.queryError) && (
          <span
            className="flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-600 dark:text-amber-400"
            title={lensGraph.queryError}
          >
            <WarningIcon size={12} /> query error
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
          <ThemeIcon theme={theme} size={15} />
        </button>
      </header>
      <div className="relative min-h-0 flex-1 kb-workspace-reveal">
        {!active || !queryDb ? (
          <WorkspaceState
            title="No graph perspectives yet"
            description="A perspective chooses which nodes and connections to explore."
          />
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
            {lensGraph.nodes.length === 0 && !hasText(lensGraph.queryError) ? (
              <WorkspaceState
                title="No nodes in view"
                description="Broaden the node query in Graph settings."
              />
            ) : Adapter ? (
              <Adapter
                lensGraph={lensGraph}
                active={active}
                forest={forest}
                themeKey={themeKey}
                selection={selection}
                setSelection={setSelection}
                setControls={setControls}
                onNodeOpen={onNodeOpen}
                searchHighlight={searchHighlight}
                filterIds={filterIds}
              />
            ) : (
              <WorkspaceState
                title="Visualization unavailable"
                description={`No renderer is registered for ${renderer}. Choose another visualization above.`}
              />
            )}
          </GraphCanvasFrame>
        )}
        {lensGraph.dropped > 0 && !capDismissed && (
          <div className="absolute left-1/2 top-3 z-30 -translate-x-1/2 flex items-center gap-2 rounded-lg border border-foreground/8 bg-popover/95 px-3 py-1.5 shadow-md backdrop-blur-sm">
            <span className="text-[11px] text-foreground/60">
              showing top {lensGraph.nodes.length} of {lensGraph.nodes.length + lensGraph.dropped}{" "}
              by degree
            </span>
            <button
              type="button"
              className="rounded-md bg-foreground/[0.06] px-2 py-0.5 text-[10px] font-medium text-foreground/60 transition-colors hover:bg-foreground/[0.1] hover:text-foreground/80"
              onClick={() => {
                if (active) {
                  navigate("/");
                  zoomTo(active.id);
                }
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
