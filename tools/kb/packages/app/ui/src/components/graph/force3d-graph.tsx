/**
 * The 3D graph's React host: it mounts the scene (`force3d-scene`, the only
 * part that touches three) into a div and keeps it in step — graph, settings,
 * emphasis, appearance, reduced motion, size and tab visibility go in through
 * the scene's handle; unmounting (a renderer switch, a perspective change,
 * leaving the page) disposes it, every GPU resource, worker and listener with
 * it. This module is the lazy chunk `graph-adapters` imports.
 */
import { useEffect, useRef, useState } from "react";
import type { LensEdge, LensNode } from "@/lib/graph-lens";
import type { GraphEmphasis } from "@/lib/graph-interaction";
import { useReducedMotion } from "@/lib/motion";
import { readTiming } from "@/lib/timing";
import { readTokenColor } from "@/lib/css-color";
import { readScenePalette } from "@/scene/palette";
import type { GraphCameraControls } from "./graph-camera-controls";
import { selectionFromNode, type GraphSelection } from "./graph-selection";
import { GraphTooltip } from "./graph-tooltip";
import {
  mountForce3d,
  type Force3dHover,
  type Force3dScene,
  type Force3dSettings,
} from "./force3d-scene";

export interface Force3dGraphProps extends GraphEmphasis {
  nodes: LensNode[];
  edges: LensEdge[];
  layoutKey: string;
  /** `Appearance.key`: a change means the tokens hold new values. */
  appearanceKey: string;
  onControlsReady?: (controls: GraphCameraControls | null) => void;
  onSelectionChange?: (sel: GraphSelection | null) => void;
  onNodeOpen?: (id: string) => void;
  curvedLinks?: boolean;
  autorotate?: boolean;
  showLabels?: boolean;
  labelTopN?: number;
  spread?: number;
  linkDistance?: number;
}

/**
 * The 3D graph's palette roles: the page's own surfaces, so the canvas meets
 * the page without a seam — the card colour lifted at the focal point, falling
 * to the background at the frame's edge; ink and accent as the UI's.
 */
function readGraphPalette() {
  return readScenePalette({
    ground: "--card",
    edge: "--background",
    hue: "--muted-foreground",
    ink: "--foreground",
    accent: "--primary",
  });
}

type SettingProps = Pick<
  Force3dGraphProps,
  "spread" | "linkDistance" | "curvedLinks" | "autorotate" | "showLabels" | "labelTopN"
>;

function settingsOf(p: SettingProps): Force3dSettings {
  return {
    spread: p.spread ?? 150,
    linkDistance: p.linkDistance ?? 60,
    curvedLinks: p.curvedLinks ?? false,
    autorotate: p.autorotate ?? false,
    showLabels: p.showLabels ?? true,
    labelTopN: p.labelTopN ?? 24,
  };
}

function emphasisOf(p: GraphEmphasis): GraphEmphasis {
  return {
    selectedNodeId: p.selectedNodeId ?? null,
    ...(p.highlightIds === undefined ? {} : { highlightIds: p.highlightIds }),
    ...(p.filterIds === undefined ? {} : { filterIds: p.filterIds }),
  };
}

function visible(): boolean {
  return document.visibilityState !== "hidden";
}

type InspectableHost = HTMLDivElement & { __kbForce3d?: Force3dScene };

interface MountHandlers {
  readonly onMounted: (scene: Force3dScene | null) => void;
  readonly onHover: (hover: Force3dHover | null) => void;
  readonly onError: (error: Error) => void;
}

/** Mount the scene while this effect lives; the latest props come through `live`. */
function useMountedScene(
  host: React.RefObject<HTMLDivElement | null>,
  live: React.RefObject<Force3dGraphProps>,
  reduced: React.RefObject<boolean>,
  handlers: MountHandlers,
): void {
  const { layoutKey } = live.current;
  const { onMounted, onHover, onError } = handlers;
  useEffect(() => {
    const el = host.current;
    if (el === null) return undefined;
    let gone = false;
    let mounted: Force3dScene | null = null;
    const props = live.current;
    // The host's hand-back target is fixed for the scene's life (the page's setter).
    const report = props.onControlsReady;
    mountForce3d(el, {
      nodes: props.nodes,
      edges: props.edges,
      settings: settingsOf(props),
      emphasis: emphasisOf(props),
      palette: readGraphPalette(),
      link: readTokenColor("--graph-edge"),
      reducedMotion: reduced.current,
      timing: readTiming(),
      onSelect: (id) => {
        const node = id === null ? undefined : live.current.nodes.find((n) => n.id === id);
        live.current.onSelectionChange?.(node === undefined ? null : selectionFromNode(node));
      },
      onOpen: (id) => live.current.onNodeOpen?.(id),
      onHover,
    })
      .then((scene) => {
        if (gone) {
          scene.dispose();
          return undefined;
        }
        mounted = scene;
        scene.resize(el.clientWidth, el.clientHeight);
        scene.setRunning(visible());
        if (import.meta.env.MODE === "test-render") (el as InspectableHost).__kbForce3d = scene;
        report?.(scene.controls);
        onMounted(scene);
        return undefined;
      })
      .catch((error: unknown) => {
        if (!gone) onError(error instanceof Error ? error : new Error(String(error)));
      });
    const resize = new ResizeObserver(() => mounted?.resize(el.clientWidth, el.clientHeight));
    resize.observe(el);
    const onVisibility = () => mounted?.setRunning(visible());
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      gone = true;
      resize.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      mounted?.dispose();
      delete (el as InspectableHost).__kbForce3d;
      report?.(null);
      onMounted(null);
      onHover(null);
    };
    // One scene per perspective: a new layout key is a new scene.
  }, [host, live, layoutKey, reduced, onMounted, onHover, onError]);
}

export default function Force3dGraph(props: Force3dGraphProps) {
  const { nodes, edges, appearanceKey, selectedNodeId, highlightIds, filterIds } = props;
  const { spread, linkDistance, curvedLinks, autorotate, showLabels, labelTopN } = props;
  const host = useRef<HTMLDivElement>(null);
  const live = useRef(props);
  live.current = props;
  const reducedMotion = useReducedMotion();
  const reduced = useRef(reducedMotion);
  reduced.current = reducedMotion;
  const [scene, setScene] = useState<Force3dScene | null>(null);
  const [hover, setHover] = useState<Force3dHover | null>(null);
  const [error, setError] = useState<Error | null>(null);
  if (error !== null) throw error;
  useMountedScene(host, live, reduced, {
    onMounted: setScene,
    onHover: setHover,
    onError: setError,
  });

  useEffect(() => scene?.setGraph(nodes, edges), [scene, nodes, edges]);
  useEffect(() => {
    scene?.setSettings(
      settingsOf({ spread, linkDistance, curvedLinks, autorotate, showLabels, labelTopN }),
    );
  }, [scene, spread, linkDistance, curvedLinks, autorotate, showLabels, labelTopN]);
  useEffect(() => {
    scene?.setEmphasis(emphasisOf({ selectedNodeId, highlightIds, filterIds }));
  }, [scene, selectedNodeId, highlightIds, filterIds]);
  // By the time this runs <html> carries the new appearance, so the tokens hold its values.
  useEffect(() => {
    if (appearanceKey !== "") scene?.setPalette(readGraphPalette(), readTokenColor("--graph-edge"));
  }, [scene, appearanceKey]);
  useEffect(() => scene?.setReducedMotion(reducedMotion), [scene, reducedMotion]);

  const hovered = hover === null ? undefined : nodes.find((n) => n.id === hover.id);
  return (
    <div className="relative h-full w-full min-h-0">
      <div ref={host} className="absolute inset-0" data-testid="force3d-graph" />
      {hover !== null && hovered !== undefined && (selectedNodeId ?? null) === null ? (
        <GraphTooltip
          node={hovered}
          x={hover.x}
          y={hover.y}
          hostWidth={host.current?.clientWidth ?? 400}
        />
      ) : null}
    </div>
  );
}
