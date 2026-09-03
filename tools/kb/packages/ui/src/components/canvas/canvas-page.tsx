import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ulid } from "ulid";
import type { CanvasDoc, CanvasEdge, CanvasNode, CanvasSide, KbLinkMode } from "@kb/canvas";
import {
  isGroupNode,
  isKbNode,
  isShapeNode,
  isTextNode,
  parseCanvasDoc,
  removeCanvasEdge,
  upsertCanvasEdge,
  upsertCanvasNode,
} from "@kb/canvas";
import { Bullet } from "@/components/outline/bullet";
import { NodeRow } from "@/components/outline/node-row";
import { KbNodeCard, TextCard } from "@/components/canvas/canvas-card";
import { CanvasToolbar } from "@/components/canvas/canvas-toolbar";
import { EdgeInspector } from "@/components/canvas/edge-inspector";
import { NodePicker } from "@/components/canvas/node-picker";
import { edgePath, sidePoint } from "@/components/canvas/edge-path";
import { ShapeCard } from "@/components/canvas/shape-card";
import { ShapeInspector } from "@/components/canvas/shape-inspector";
import {
  edgePropPresent,
  isValidNativeTarget,
  listRefFields,
  persistCanvasDoc,
  planNativeBind,
  readCanvasDoc,
  syncDocOnRev,
} from "@/lib/canvas-api";
import {
  placeWithTool,
  reduceCanvasTool,
  type CanvasTool,
  type ToolState,
} from "@/lib/canvas-tool";
import {
  type CanvasSelection,
  EMPTY_SELECTION,
  addNodes,
  deleteSelected,
  marqueeSelect,
  selectAll,
  selectEdge,
  selectNode as selNode,
  selectionEmpty,
  toggleEdge,
  toggleNode,
} from "@/lib/canvas-selection";
import {
  type CanvasHistory,
  initHistory,
  pushHistory,
  undo as histUndo,
  redo as histRedo,
} from "@/lib/canvas-history";
import { resolveCanvasColor } from "@/lib/canvas-color";
import { navigate } from "@/lib/router";
import { toast } from "@/lib/toast";
import { useOutlineStore } from "@/stores/outline.store";
import { cn } from "@/lib/cn";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 3;
const DEBOUNCE_MS = 300;
const DRAG_THRESHOLD = 4;
const MIN_NODE_W = 80;
const MIN_NODE_H = 40;

interface CanvasPageProps {
  canvasId: string;
}

type ResizeCorner = "nw" | "ne" | "se" | "sw";

type Drag =
  | { kind: "pan"; x: number; y: number; ox: number; oy: number }
  | {
      kind: "move-pending";
      id: string;
      startX: number;
      startY: number;
      origPositions: Map<string, { x: number; y: number }>;
    }
  | {
      kind: "move";
      startX: number;
      startY: number;
      origPositions: Map<string, { x: number; y: number }>;
    }
  | {
      kind: "resize-pending";
      id: string;
      corner: ResizeCorner;
      startX: number;
      startY: number;
      origX: number;
      origY: number;
      origW: number;
      origH: number;
    }
  | {
      kind: "resize";
      id: string;
      corner: ResizeCorner;
      startX: number;
      startY: number;
      origX: number;
      origY: number;
      origW: number;
      origH: number;
    }
  | {
      kind: "edge";
      fromCardId: string;
      fromSide: CanvasSide;
      x: number;
      y: number;
    }
  | {
      kind: "marquee-pending";
      startX: number;
      startY: number;
      worldX: number;
      worldY: number;
      additive: boolean;
    }
  | {
      kind: "marquee";
      worldX: number;
      worldY: number;
      curX: number;
      curY: number;
      additive: boolean;
      baseSel: CanvasSelection;
    };

function closestPort(node: CanvasNode, px: number, py: number): { side: CanvasSide; dist: number } {
  const sides: CanvasSide[] = ["top", "right", "bottom", "left"];
  let best: { side: CanvasSide; dist: number } = { side: "left", dist: Infinity };
  for (const s of sides) {
    const pt = sidePoint(node, s);
    const d = Math.hypot(pt.x - px, pt.y - py);
    if (d < best.dist) best = { side: s, dist: d };
  }
  return best;
}

export function CanvasPage({ canvasId }: CanvasPageProps) {
  const nodes = useOutlineStore((s) => s.nodes);
  const queryDb = useOutlineStore((s) => s.queryDb);
  const rev = useOutlineStore((s) => s.rev);
  const canvasNode = nodes.get(canvasId);

  const [historyState, setHistoryState] = useState<CanvasHistory>(() =>
    initHistory(readCanvasDoc(canvasNode)),
  );
  const doc = historyState.present;

  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [zoom, setZoom] = useState(1);
  const [spaceDown, setSpaceDown] = useState(false);
  const [selection, setSelection] = useState<CanvasSelection>(EMPTY_SELECTION);
  const [inspectorAnchor, setInspectorAnchor] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [toolState, setToolState] = useState<ToolState>({ tool: "select" });
  const [shapeInspectorAnchor, setShapeInspectorAnchor] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [snapGuides, setSnapGuides] = useState<{ axis: "x" | "y"; pos: number }[]>([]);
  const [editingEdgeLabel, setEditingEdgeLabel] = useState<string | null>(null);

  const dragRef = useRef<Drag | null>(null);
  const dirtyRef = useRef(false);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const histRef = useRef(historyState);
  histRef.current = historyState;
  const selRef = useRef(selection);
  selRef.current = selection;

  const docRef = useRef(doc);
  docRef.current = doc;

  const isBusy = useCallback(() => dragRef.current !== null || dirtyRef.current, []);

  const applyDoc = useCallback((next: CanvasDoc) => {
    setHistoryState((h) => pushHistory(h, next));
  }, []);

  const applyDocSilent = useCallback((next: CanvasDoc) => {
    setHistoryState((h) => ({ ...h, present: next }));
  }, []);

  useEffect(() => {
    syncDocOnRev(canvasId, useOutlineStore.getState().nodes, {
      applyLocal: (next) => applyDocSilent(next),
      isBusy,
    });
  }, [canvasId, rev, applyDocSilent, isBusy]);

  const schedulePersist = useCallback(
    (next: CanvasDoc) => {
      dirtyRef.current = true;
      applyDoc(next);
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(() => {
        dirtyRef.current = false;
        void persistCanvasDoc(canvasId, histRef.current.present);
      }, DEBOUNCE_MS);
    },
    [canvasId, applyDoc],
  );

  const schedulePersistSilent = useCallback(
    (next: CanvasDoc) => {
      dirtyRef.current = true;
      applyDocSilent(next);
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(() => {
        dirtyRef.current = false;
        void persistCanvasDoc(canvasId, histRef.current.present);
      }, DEBOUNCE_MS);
    },
    [canvasId, applyDocSilent],
  );

  const flushPersist = useCallback(
    async (next: CanvasDoc, opts?: Parameters<typeof persistCanvasDoc>[2]) => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
      dirtyRef.current = false;
      applyDoc(next);
      await persistCanvasDoc(canvasId, next, opts);
    },
    [canvasId, applyDoc],
  );

  const byId = useMemo(() => {
    const m = new Map<string, CanvasNode>();
    for (const n of doc.nodes) m.set(n.id, n);
    return m;
  }, [doc.nodes]);

  const refFields = useMemo(() => listRefFields(nodes), [nodes]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const inField =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement).isContentEditable;

      // Undo / Redo (works even when in field)
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        setHistoryState((h) => {
          const next = histUndo(h);
          if (next !== h) void persistCanvasDoc(canvasId, next.present);
          return next;
        });
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "Z" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        setHistoryState((h) => {
          const next = histRedo(h);
          if (next !== h) void persistCanvasDoc(canvasId, next.present);
          return next;
        });
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "y") {
        e.preventDefault();
        setHistoryState((h) => {
          const next = histRedo(h);
          if (next !== h) void persistCanvasDoc(canvasId, next.present);
          return next;
        });
        return;
      }

      if (inField) {
        if (e.key === "Escape") return;
        return;
      }

      // Delete / Backspace
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        const sel = selRef.current;
        if (selectionEmpty(sel)) return;
        const nextDoc = deleteSelected(docRef.current, sel);
        schedulePersist(nextDoc);
        setSelection(EMPTY_SELECTION);
        setInspectorAnchor(null);
        setShapeInspectorAnchor(null);
        return;
      }

      // Select All
      if ((e.metaKey || e.ctrlKey) && e.key === "a") {
        e.preventDefault();
        setSelection(selectAll(docRef.current));
        return;
      }

      // Copy
      if ((e.metaKey || e.ctrlKey) && e.key === "c") {
        e.preventDefault();
        const sel = selRef.current;
        if (selectionEmpty(sel)) return;
        const copied: CanvasDoc = {
          nodes: docRef.current.nodes.filter((n) => sel.nodeIds.has(n.id)),
          edges: docRef.current.edges.filter(
            (edge) =>
              sel.edgeIds.has(edge.id) ||
              (sel.nodeIds.has(edge.fromNode) && sel.nodeIds.has(edge.toNode)),
          ),
        };
        void navigator.clipboard.writeText(JSON.stringify(copied));
        return;
      }

      // Paste
      if ((e.metaKey || e.ctrlKey) && e.key === "v") {
        e.preventDefault();
        void navigator.clipboard.readText().then((text) => {
          try {
            const parsed = parseCanvasDoc(text);
            const idMap = new Map<string, string>();
            const newNodes: CanvasNode[] = parsed.nodes.map((n) => {
              const newId = ulid();
              idMap.set(n.id, newId);
              return { ...n, id: newId, x: n.x + 24, y: n.y + 24 };
            });
            const newEdges: CanvasEdge[] = parsed.edges
              .filter((edge) => idMap.has(edge.fromNode) && idMap.has(edge.toNode))
              .map((edge) => ({
                ...edge,
                id: ulid(),
                fromNode: idMap.get(edge.fromNode)!,
                toNode: idMap.get(edge.toNode)!,
              }));
            let nextDoc = docRef.current;
            for (const n of newNodes) nextDoc = upsertCanvasNode(nextDoc, n);
            for (const edge of newEdges) nextDoc = upsertCanvasEdge(nextDoc, edge);
            schedulePersist(nextDoc);
            setSelection({
              nodeIds: new Set(newNodes.map((n) => n.id)),
              edgeIds: new Set(newEdges.map((e) => e.id)),
            });
          } catch {
            // not valid canvas JSON
          }
        });
        return;
      }

      // Duplicate
      if ((e.metaKey || e.ctrlKey) && e.key === "d") {
        e.preventDefault();
        const sel = selRef.current;
        if (selectionEmpty(sel)) return;
        const idMap = new Map<string, string>();
        let nextDoc = docRef.current;
        for (const nodeId of sel.nodeIds) {
          const node = byId.get(nodeId);
          if (!node) continue;
          const newId = ulid();
          idMap.set(nodeId, newId);
          nextDoc = upsertCanvasNode(nextDoc, {
            ...node,
            id: newId,
            x: node.x + 24,
            y: node.y + 24,
          });
        }
        for (const edge of docRef.current.edges) {
          if (sel.nodeIds.has(edge.fromNode) && sel.nodeIds.has(edge.toNode)) {
            nextDoc = upsertCanvasEdge(nextDoc, {
              ...edge,
              id: ulid(),
              fromNode: idMap.get(edge.fromNode) ?? edge.fromNode,
              toNode: idMap.get(edge.toNode) ?? edge.toNode,
            });
          }
        }
        schedulePersist(nextDoc);
        setSelection({
          nodeIds: new Set(idMap.values()),
          edgeIds: new Set(),
        });
        return;
      }

      // Escape
      if (e.key === "Escape") {
        setToolState((s) => reduceCanvasTool(s, { type: "escape" }));
        setSelection(EMPTY_SELECTION);
        setInspectorAnchor(null);
        setShapeInspectorAnchor(null);
        return;
      }

      // Space for panning
      if (e.code === "Space") {
        setSpaceDown(true);
        e.preventDefault();
        return;
      }

      // Arrow nudge
      if (e.key.startsWith("Arrow")) {
        const sel = selRef.current;
        if (selectionEmpty(sel)) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        let nextDoc = docRef.current;
        for (const nodeId of sel.nodeIds) {
          const node = byId.get(nodeId);
          if (node) {
            nextDoc = upsertCanvasNode(nextDoc, {
              ...node,
              x: node.x + dx,
              y: node.y + dy,
            });
          }
        }
        schedulePersistSilent(nextDoc);
        return;
      }

      // Tool shortcuts
      const toolKeys: Record<string, CanvasTool> = {
        v: "select",
        "1": "select",
        t: "text",
        "2": "text",
        r: "rect",
        "3": "rect",
        o: "ellipse",
        c: "ellipse",
        "4": "ellipse",
        d: "diamond",
        "5": "diamond",
        n: "kb-node",
        "6": "kb-node",
        g: "group",
        f: "group",
        "7": "group",
      };
      const mapped = toolKeys[e.key.toLowerCase()];
      if (mapped) {
        e.preventDefault();
        if (mapped === "kb-node") {
          setToolState({ tool: "select" });
          setPickerOpen(true);
        } else {
          setToolState((s) => reduceCanvasTool(s, { type: "set-tool", tool: mapped }));
        }
        return;
      }

      // Zoom shortcuts
      if ((e.metaKey || e.ctrlKey) && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        setZoom((z) => Math.min(MAX_ZOOM, z * 1.15));
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "-") {
        e.preventDefault();
        setZoom((z) => Math.max(MIN_ZOOM, z / 1.15));
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "0") {
        e.preventDefault();
        setZoom(1);
        return;
      }

      // Zoom to fit (Shift+1)
      if (e.shiftKey && e.key === "!") {
        e.preventDefault();
        zoomToFit();
        return;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [canvasId, byId, schedulePersist, schedulePersistSilent]); // oxlint-disable-line react-hooks/exhaustive-deps -- zoomToFit is recreated per render and is not a stable dep; this effect intentionally binds a one-shot keydown listener

  const setTool = useCallback((tool: CanvasTool) => {
    if (tool === "kb-node") {
      setToolState({ tool: "select" });
      setPickerOpen(true);
      return;
    }
    setToolState((s) => reduceCanvasTool(s, { type: "set-tool", tool }));
  }, []);

  const setToolSticky = useCallback((tool: CanvasTool) => {
    if (tool === "kb-node" || tool === "select") return;
    setToolState((s) => reduceCanvasTool(s, { type: "set-tool-sticky", tool }));
  }, []);

  const zoomToFit = useCallback(() => {
    const nodes = docRef.current.nodes;
    if (nodes.length === 0) return;
    const stageEl = document.querySelector("[data-canvas-stage]")?.parentElement?.parentElement;
    if (!stageEl) return;
    const rect = stageEl.getBoundingClientRect();
    const PAD = 40;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    }
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    if (contentW <= 0 || contentH <= 0) return;
    const scaleX = (rect.width - PAD * 2) / contentW;
    const scaleY = (rect.height - PAD * 2) / contentH;
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(scaleX, scaleY, 1)));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    setPan({
      x: rect.width / 2 - cx * newZoom,
      y: rect.height / 2 - cy * newZoom,
    });
    setZoom(newZoom);
  }, []);

  const screenToWorld = useCallback(
    (clientX: number, clientY: number, el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      return {
        x: (clientX - rect.left - pan.x) / zoom,
        y: (clientY - rect.top - pan.y) / zoom,
      };
    },
    [pan, zoom],
  );

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
      // Cursor-centered zoom
      const rect = e.currentTarget.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const worldX = (px - pan.x) / zoom;
      const worldY = (py - pan.y) / zoom;
      setPan({
        x: px - worldX * newZoom,
        y: py - worldY * newZoom,
      });
      setZoom(newZoom);
      return;
    }
    setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
  };

  const isEmptyStageTarget = (target: EventTarget | null) => {
    const el = target as HTMLElement | null;
    if (!el?.closest) return false;
    if (el.closest("[data-card-id]")) return false;
    if (el.closest("[data-testid='canvas-toolbar']")) return false;
    if (el.closest("path")) return false;
    return true;
  };

  const startMoveForSelection = (e: React.PointerEvent, clickedId: string) => {
    const sel = selRef.current;
    const selectedIds = sel.nodeIds.has(clickedId) ? sel.nodeIds : new Set([clickedId]);
    const origPositions = new Map<string, { x: number; y: number }>();
    for (const id of selectedIds) {
      const node = byId.get(id);
      if (node) origPositions.set(id, { x: node.x, y: node.y });
    }
    dragRef.current = {
      kind: "move-pending",
      id: clickedId,
      startX: e.clientX,
      startY: e.clientY,
      origPositions,
    };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerDownStage = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button === 1 || spaceDown || (e.button === 0 && e.altKey)) {
      dragRef.current = {
        kind: "pan",
        x: e.clientX,
        y: e.clientY,
        ox: pan.x,
        oy: pan.y,
      };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      return;
    }
    if (e.button === 0 && isEmptyStageTarget(e.target)) {
      const placed = placeWithTool(
        docRef.current,
        toolState.tool,
        screenToWorld(e.clientX, e.clientY, e.currentTarget),
        ulid(),
      );
      if (placed) {
        schedulePersist(placed.doc);
        setSelection(selNode(placed.node.id));
        setToolState((s) => reduceCanvasTool(s, { type: "placed" }));
        setInspectorAnchor(null);
        setShapeInspectorAnchor(null);
        if (isShapeNode(placed.node)) {
          setShapeInspectorAnchor({ x: e.clientX, y: e.clientY });
        }
        return;
      }
      // Begin marquee or clear selection
      const world = screenToWorld(e.clientX, e.clientY, e.currentTarget);
      dragRef.current = {
        kind: "marquee-pending",
        startX: e.clientX,
        startY: e.clientY,
        worldX: world.x,
        worldY: world.y,
        additive: e.shiftKey,
      };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    }
  };

  const onDoubleClickStage = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isEmptyStageTarget(e.target)) return;
    if (toolState.tool !== "select") return;
    const world = screenToWorld(e.clientX, e.clientY, e.currentTarget);
    const card = {
      id: ulid(),
      type: "text" as const,
      text: "",
      x: world.x,
      y: world.y,
      width: 220,
      height: 80,
    };
    schedulePersist(upsertCanvasNode(docRef.current, card));
    setSelection(selNode(card.id));
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;

    if (d.kind === "pan") {
      setPan({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) });
      return;
    }

    if (d.kind === "marquee-pending") {
      const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
      if (dist < DRAG_THRESHOLD) return;
      const curWorld = screenToWorld(e.clientX, e.clientY, e.currentTarget);
      dragRef.current = {
        kind: "marquee",
        worldX: d.worldX,
        worldY: d.worldY,
        curX: curWorld.x,
        curY: curWorld.y,
        additive: d.additive,
        baseSel: d.additive ? selRef.current : EMPTY_SELECTION,
      };
      setMarqueeRect({
        x: d.worldX,
        y: d.worldY,
        w: curWorld.x - d.worldX,
        h: curWorld.y - d.worldY,
      });
      return;
    }

    if (d.kind === "marquee") {
      const curWorld = screenToWorld(e.clientX, e.clientY, e.currentTarget);
      dragRef.current = { ...d, curX: curWorld.x, curY: curWorld.y };
      const rect = {
        x: d.worldX,
        y: d.worldY,
        w: curWorld.x - d.worldX,
        h: curWorld.y - d.worldY,
      };
      setMarqueeRect(rect);
      const hits = marqueeSelect(docRef.current.nodes, rect);
      setSelection(addNodes(d.baseSel, hits));
      return;
    }

    if (d.kind === "move-pending") {
      const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
      if (dist < DRAG_THRESHOLD) return;
      dragRef.current = {
        kind: "move",
        startX: d.startX,
        startY: d.startY,
        origPositions: d.origPositions,
      };
      return;
    }

    if (d.kind === "move") {
      let dx = (e.clientX - d.startX) / zoom;
      let dy = (e.clientY - d.startY) / zoom;

      // Alignment snapping (5px tolerance)
      const SNAP_TOL = 5;
      const guides: { axis: "x" | "y"; pos: number }[] = [];
      const movingIds = new Set(d.origPositions.keys());
      const firstOrig = d.origPositions.values().next().value;
      const firstId = d.origPositions.keys().next().value;
      if (firstOrig && firstId && movingIds.size > 0) {
        const movingNode = byId.get(firstId);
        if (movingNode) {
          const myLeft = firstOrig.x + dx;
          const myTop = firstOrig.y + dy;
          const myRight = myLeft + movingNode.width;
          const myBottom = myTop + movingNode.height;
          const myCx = (myLeft + myRight) / 2;
          const myCy = (myTop + myBottom) / 2;

          for (const other of docRef.current.nodes) {
            if (movingIds.has(other.id)) continue;
            const oLeft = other.x;
            const oRight = other.x + other.width;
            const oTop = other.y;
            const oBottom = other.y + other.height;
            const oCx = (oLeft + oRight) / 2;
            const oCy = (oTop + oBottom) / 2;

            // X-axis snaps
            for (const [myEdge, oEdge] of [
              [myLeft, oLeft],
              [myLeft, oRight],
              [myRight, oLeft],
              [myRight, oRight],
              [myCx, oCx],
            ] as [number, number][]) {
              if (Math.abs(myEdge - oEdge) < SNAP_TOL) {
                dx += oEdge - myEdge;
                guides.push({ axis: "x", pos: oEdge });
                break;
              }
            }
            // Y-axis snaps
            for (const [myEdge, oEdge] of [
              [myTop, oTop],
              [myTop, oBottom],
              [myBottom, oTop],
              [myBottom, oBottom],
              [myCy, oCy],
            ] as [number, number][]) {
              if (Math.abs(myEdge - oEdge) < SNAP_TOL) {
                dy += oEdge - myEdge;
                guides.push({ axis: "y", pos: oEdge });
                break;
              }
            }
            if (guides.length >= 2) break;
          }
        }
      }
      setSnapGuides(guides);

      let nextDoc = docRef.current;
      for (const [id, orig] of d.origPositions) {
        const node = byId.get(id);
        if (!node) continue;
        nextDoc = upsertCanvasNode(nextDoc, {
          ...node,
          x: orig.x + dx,
          y: orig.y + dy,
        });
      }
      schedulePersistSilent(nextDoc);
      return;
    }

    if (d.kind === "resize-pending") {
      const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
      if (dist < DRAG_THRESHOLD) return;
      dragRef.current = { ...d, kind: "resize" };
      return;
    }

    if (d.kind === "resize") {
      const dx = (e.clientX - d.startX) / zoom;
      const dy = (e.clientY - d.startY) / zoom;
      const node = byId.get(d.id);
      if (!node) return;

      let newX = d.origX;
      let newY = d.origY;
      let newW = d.origW;
      let newH = d.origH;

      switch (d.corner) {
        case "se":
          newW = Math.max(MIN_NODE_W, d.origW + dx);
          newH = Math.max(MIN_NODE_H, d.origH + dy);
          break;
        case "sw":
          newW = Math.max(MIN_NODE_W, d.origW - dx);
          newH = Math.max(MIN_NODE_H, d.origH + dy);
          newX = d.origX + d.origW - newW;
          break;
        case "ne":
          newW = Math.max(MIN_NODE_W, d.origW + dx);
          newH = Math.max(MIN_NODE_H, d.origH - dy);
          newY = d.origY + d.origH - newH;
          break;
        case "nw":
          newW = Math.max(MIN_NODE_W, d.origW - dx);
          newH = Math.max(MIN_NODE_H, d.origH - dy);
          newX = d.origX + d.origW - newW;
          newY = d.origY + d.origH - newH;
          break;
        // Exhaustive over ResizeCorner; switch-exhaustiveness-check guards it
        // no default
      }

      // Shift: lock aspect ratio
      if (e.shiftKey && d.origW > 0 && d.origH > 0) {
        const ratio = d.origW / d.origH;
        if (newW / newH > ratio) {
          newW = Math.max(MIN_NODE_W, newH * ratio);
        } else {
          newH = Math.max(MIN_NODE_H, newW / ratio);
        }
      }

      schedulePersistSilent(
        upsertCanvasNode(docRef.current, {
          ...node,
          x: newX,
          y: newY,
          width: newW,
          height: newH,
        }),
      );
      return;
    }

    if (d.kind === "edge") {
      dragRef.current = { ...d, x: e.clientX, y: e.clientY };
      setPan((p) => ({ ...p }));
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    dragRef.current = null;

    if (!d) return;

    if (d.kind === "marquee-pending") {
      // Was a click on empty stage — clear selection
      if (!d.additive) {
        setSelection(EMPTY_SELECTION);
        setInspectorAnchor(null);
        setShapeInspectorAnchor(null);
      }
      return;
    }

    if (d.kind === "marquee") {
      setMarqueeRect(null);
      return;
    }

    if (d.kind === "move-pending") {
      // Was a click on a card (no drag happened)
      return;
    }

    if (d.kind === "move") {
      setSnapGuides([]);
      // Commit the final position into history
      const dx = (e.clientX - d.startX) / zoom;
      const dy = (e.clientY - d.startY) / zoom;
      let nextDoc = histRef.current.present;
      for (const [id, orig] of d.origPositions) {
        const n = byId.get(id);
        if (!n) continue;
        nextDoc = upsertCanvasNode(nextDoc, {
          ...n,
          x: orig.x + dx,
          y: orig.y + dy,
        });
      }
      schedulePersist(nextDoc);
      return;
    }

    if (d.kind === "resize-pending" || d.kind === "resize") {
      // If we were resizing, commit the final size into history
      if (d.kind === "resize") {
        schedulePersist(docRef.current);
      }
      return;
    }

    if (d.kind !== "edge") return;

    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const cardEl = el?.closest("[data-card-id]") as HTMLElement | null;
    const toCardId = cardEl?.dataset.cardId;
    if (!toCardId || toCardId === d.fromCardId) return;
    const from = byId.get(d.fromCardId);
    const to = byId.get(toCardId);
    if (!from || !to) return;

    // Smart port snapping: find closest port on target
    const world = screenToWorld(d.x, d.y, e.currentTarget);
    const bestPort = closestPort(to, world.x, world.y);

    const edge: CanvasEdge = {
      id: ulid(),
      fromNode: d.fromCardId,
      toNode: toCardId,
      fromSide: d.fromSide,
      toSide: bestPort.side,
      toEnd: "arrow",
      kbLink: {
        mode: "layout",
        via: "prop",
        fieldId: "",
        sourceNodeId: isKbNode(from) ? from.nodeId : "",
        targetNodeId: isKbNode(to) ? to.nodeId : "",
        bindingId: ulid(),
      },
    };
    void flushPersist(upsertCanvasEdge(docRef.current, edge));
    setSelection(selectEdge(edge.id));
    setInspectorAnchor({ x: e.clientX, y: e.clientY });
  };

  const addKbNode = (nodeId: string) => {
    setPickerOpen(false);
    const card = {
      id: ulid(),
      type: "kb-node" as const,
      nodeId,
      x: (200 - pan.x) / zoom,
      y: (160 - pan.y) / zoom,
      width: 280,
      height: 72,
    };
    void flushPersist(upsertCanvasNode(docRef.current, card));
    setSelection(selNode(card.id));
  };

  // Derive selected edge/shape for inspectors
  const selectedEdgeId = selection.edgeIds.size === 1 ? [...selection.edgeIds][0] : null;
  const selectedEdgeObj = selectedEdgeId
    ? (doc.edges.find((e) => e.id === selectedEdgeId) ?? null)
    : null;

  const selectedShapeId = selection.nodeIds.size === 1 ? [...selection.nodeIds][0] : null;
  const selectedShape = selectedShapeId
    ? (() => {
        const n = byId.get(selectedShapeId);
        return n && isShapeNode(n) ? n : null;
      })()
    : null;

  const onModeChange = async (mode: KbLinkMode) => {
    if (!selectedEdgeObj) return;
    const from = byId.get(selectedEdgeObj.fromNode);
    const to = byId.get(selectedEdgeObj.toNode);

    if (mode === "native" && !selectedEdgeObj.kbLink?.fieldId) {
      toast("Pick a ref field before enabling native mode");
      return;
    }

    if (!from || !to || !isKbNode(from) || !isKbNode(to)) {
      const next = upsertCanvasEdge(docRef.current, {
        ...selectedEdgeObj,
        kbLink: selectedEdgeObj.kbLink
          ? {
              ...selectedEdgeObj.kbLink,
              mode: mode === "native" && !selectedEdgeObj.kbLink.fieldId ? "layout" : mode,
            }
          : undefined,
      });
      await flushPersist(next);
      return;
    }

    const link = {
      mode,
      via: "prop" as const,
      fieldId: selectedEdgeObj.kbLink?.fieldId ?? "",
      sourceNodeId: from.nodeId,
      targetNodeId: to.nodeId,
      bindingId: selectedEdgeObj.kbLink?.bindingId ?? ulid(),
    };
    if (mode === "native" && !link.fieldId) {
      toast("Pick a ref field before enabling native mode");
      return;
    }

    const next = upsertCanvasEdge(docRef.current, {
      ...selectedEdgeObj,
      kbLink: link,
    });

    if (mode === "native" && link.fieldId) {
      if (!isValidNativeTarget(link.fieldId, to.nodeId, nodes, queryDb)) {
        toast("Target not allowed for this ref field");
        return;
      }
      const bind = planNativeBind(nodes, from.nodeId, link.fieldId, to.nodeId);
      await flushPersist(next, {
        propTargetId: from.nodeId,
        setProps: bind.skip ? undefined : bind.setProps,
      });
    } else {
      await flushPersist(next);
    }
  };

  const onFieldChange = async (fieldId: string) => {
    if (!selectedEdgeObj) return;
    const from = byId.get(selectedEdgeObj.fromNode);
    const to = byId.get(selectedEdgeObj.toNode);
    if (!from || !to || !isKbNode(from) || !isKbNode(to)) return;

    if (!isValidNativeTarget(fieldId, to.nodeId, nodes, queryDb)) {
      toast("Target not allowed for this ref field");
      return;
    }

    const link = {
      mode: "native" as const,
      via: "prop" as const,
      fieldId,
      sourceNodeId: from.nodeId,
      targetNodeId: to.nodeId,
      bindingId: selectedEdgeObj.kbLink?.bindingId ?? ulid(),
    };
    const next = upsertCanvasEdge(docRef.current, {
      ...selectedEdgeObj,
      kbLink: link,
    });

    const bind = planNativeBind(nodes, from.nodeId, fieldId, to.nodeId);
    await flushPersist(next, {
      propTargetId: from.nodeId,
      setProps: bind.skip ? undefined : bind.setProps,
    });
  };

  const onDeleteEdge = async () => {
    if (!selectedEdgeObj) return;
    const link = selectedEdgeObj.kbLink;
    const next = removeCanvasEdge(docRef.current, selectedEdgeObj.id);
    const offerUnset =
      link?.mode === "native" &&
      !!link.fieldId &&
      window.confirm("Also remove the bound prop from the source node?");
    if (offerUnset && link) {
      await flushPersist(next, {
        propTargetId: link.sourceNodeId,
        unsetProps: [
          {
            field: link.fieldId,
            value: { t: "ref", v: link.targetNodeId },
          },
        ],
      });
    } else {
      await flushPersist(next);
    }
    setSelection(EMPTY_SELECTION);
    setInspectorAnchor(null);
  };

  // Ghost edge rendering
  const ghostEdge = (() => {
    const d = dragRef.current;
    if (!d || d.kind !== "edge") return null;
    const from = byId.get(d.fromCardId);
    if (!from) return null;
    const start = sidePoint(from, d.fromSide);
    return { start, endX: d.x, endY: d.y, fromSide: d.fromSide };
  })();

  if (!canvasNode) {
    return (
      <div className="p-6 text-[13px] text-destructive">
        Canvas not found: {canvasId}{" "}
        <button type="button" className="underline" onClick={() => navigate("/canvas")}>
          back
        </button>
      </div>
    );
  }

  const handleCardPointerDown = (
    card: CanvasNode,
    e: React.PointerEvent,
    anchor?: { x: number; y: number },
  ) => {
    const isSelected = selection.nodeIds.has(card.id);
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      setSelection(toggleNode(selection, card.id));
      setInspectorAnchor(null);
      setShapeInspectorAnchor(null);
      return;
    }
    if (!isSelected) {
      setSelection(selNode(card.id));
      setInspectorAnchor(null);
      if (anchor) setShapeInspectorAnchor(anchor);
      else setShapeInspectorAnchor(null);
    }
    startMoveForSelection(e, card.id);
  };

  const handleEdgeClick = (edge: CanvasEdge, ev: React.MouseEvent) => {
    ev.stopPropagation();
    if (ev.shiftKey || ev.metaKey || ev.ctrlKey) {
      setSelection(toggleEdge(selection, edge.id));
    } else {
      setSelection(selectEdge(edge.id));
    }
    setInspectorAnchor({ x: ev.clientX, y: ev.clientY });
    setShapeInspectorAnchor(null);
  };

  const renderResizeHandles = (card: CanvasNode, isSelected: boolean) => {
    if (!isSelected) return null;
    const corners: { corner: ResizeCorner; cursor: string; style: React.CSSProperties }[] = [
      { corner: "nw", cursor: "nwse-resize", style: { top: -4, left: -4 } },
      { corner: "ne", cursor: "nesw-resize", style: { top: -4, right: -4 } },
      { corner: "se", cursor: "nwse-resize", style: { bottom: -4, right: -4 } },
      { corner: "sw", cursor: "nesw-resize", style: { bottom: -4, left: -4 } },
    ];
    return corners.map(({ corner, cursor, style }) => (
      <div
        key={corner}
        data-resize={corner}
        className="absolute z-20 h-2.5 w-2.5 rounded-sm border border-primary/60 bg-background"
        style={{ ...style, cursor }}
        onPointerDown={(e) => {
          e.stopPropagation();
          dragRef.current = {
            kind: "resize-pending",
            id: card.id,
            corner,
            startX: e.clientX,
            startY: e.clientY,
            origX: card.x,
            origY: card.y,
            origW: card.width,
            origH: card.height,
          };
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        }}
      />
    ));
  };

  const renderPorts = (
    _card: CanvasNode,
    onPortDown: (side: CanvasSide, e: React.PointerEvent) => void,
  ) => (
    <>
      {(["left", "right", "top", "bottom"] as const).map((side) => (
        <button
          key={side}
          type="button"
          data-port={side}
          aria-label={`Connect ${side}`}
          className={cn(
            "absolute z-10 h-4.5 w-4.5 rounded-full",
            "opacity-0 transition-opacity group-hover/card:opacity-100",
            side === "left" && "top-1/2 left-0 -translate-x-1/2 -translate-y-1/2",
            side === "right" && "top-1/2 right-0 translate-x-1/2 -translate-y-1/2",
            side === "top" && "top-0 left-1/2 -translate-x-1/2 -translate-y-1/2",
            side === "bottom" && "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2",
          )}
          onPointerDown={(e) => {
            e.stopPropagation();
            onPortDown(side, e);
          }}
        >
          <span className="block h-2 w-2 rounded-full border border-foreground/20 bg-background mx-auto mt-[5px]" />
        </button>
      ))}
    </>
  );

  const portHandler = (cardId: string) => (side: CanvasSide, e: React.PointerEvent) => {
    dragRef.current = {
      kind: "edge",
      fromCardId: cardId,
      fromSide: side,
      x: e.clientX,
      y: e.clientY,
    };
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-foreground/[0.06] px-3">
        <button
          type="button"
          className="text-[12px] text-foreground/40 hover:text-foreground/70"
          onClick={() => navigate("/canvas")}
        >
          ← canvases
        </button>
        <NodeRow
          depth={0}
          nodeId={canvasId}
          bullet={<Bullet node={canvasNode} onClick={() => {}} />}
          content={
            <span className="truncate text-[13px] text-foreground/70">{canvasNode.text}</span>
          }
          className="min-w-0 flex-1"
        />
        <button
          type="button"
          className="rounded-md border border-foreground/10 px-2 py-1 text-[12px] text-foreground/60 hover:bg-foreground/5"
          onClick={() => setPickerOpen(true)}
        >
          Add node
        </button>
        <span className="text-[11px] text-foreground/30">{Math.round(zoom * 100)}%</span>
      </div>

      <div
        className={cn(
          "relative min-h-0 flex-1 overflow-hidden",
          spaceDown
            ? "cursor-grab"
            : toolState.tool !== "select"
              ? "cursor-crosshair"
              : "cursor-default",
        )}
        style={{
          backgroundImage:
            "radial-gradient(circle, color-mix(in oklab, var(--foreground) 4%, transparent) 1px, transparent 1px)",
          backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
        onWheel={onWheel}
        onPointerDown={onPointerDownStage}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClickStage}
      >
        <CanvasToolbar
          tool={toolState.tool}
          sticky={toolState.sticky}
          onToolChange={setTool}
          onToolDoubleClick={setToolSticky}
        />
        <div
          className="absolute inset-0 origin-top-left"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        >
          <svg
            className="pointer-events-none absolute top-0 left-0 overflow-visible"
            width={8000}
            height={8000}
          >
            <defs>
              <marker
                id="kb-arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
              </marker>
              {["1", "2", "3", "4", "5", "6"].map((cid) => (
                <marker
                  key={cid}
                  id={`kb-arrow-${cid}`}
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill={`var(--canvas-color-${cid})`} />
                </marker>
              ))}
              <marker
                id="kb-arrow-rev"
                viewBox="0 0 10 10"
                refX="2"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 10 0 L 0 5 L 10 10 z" fill="currentColor" />
              </marker>
              {["1", "2", "3", "4", "5", "6"].map((cid) => (
                <marker
                  key={`rev-${cid}`}
                  id={`kb-arrow-rev-${cid}`}
                  viewBox="0 0 10 10"
                  refX="2"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 10 0 L 0 5 L 10 10 z" fill={`var(--canvas-color-${cid})`} />
                </marker>
              ))}
            </defs>
            <g className="pointer-events-auto text-foreground/35">
              {doc.edges.map((edge) => {
                const from = byId.get(edge.fromNode);
                const to = byId.get(edge.toNode);
                if (!from || !to) return null;
                const d = edgePath(from, to, edge);
                const selected = selection.edgeIds.has(edge.id);
                const unbound =
                  edge.kbLink?.mode === "native" &&
                  !!edge.kbLink.fieldId &&
                  !edgePropPresent(edge, nodes);
                const edgeColor = resolveCanvasColor(edge.color);
                const markerEnd =
                  edge.toEnd === "none"
                    ? undefined
                    : edge.color
                      ? `url(#kb-arrow-${edge.color})`
                      : "url(#kb-arrow)";
                const markerStart =
                  edge.fromEnd === "arrow"
                    ? edge.color
                      ? `url(#kb-arrow-rev-${edge.color})`
                      : "url(#kb-arrow-rev)"
                    : undefined;

                // Edge label midpoint
                const labelEl = (() => {
                  const a = sidePoint(from, edge.fromSide ?? "right");
                  const b = sidePoint(to, edge.toSide ?? "left");
                  const mx = (a.x + b.x) / 2;
                  const my = (a.y + b.y) / 2;
                  if (editingEdgeLabel === edge.id) {
                    return (
                      <foreignObject x={mx - 60} y={my - 12} width={120} height={24}>
                        <input
                          // eslint-disable-next-line jsx-a11y/no-autofocus
                          autoFocus
                          type="text"
                          className="h-full w-full rounded border border-primary/40 bg-popover px-1 text-center text-[11px]"
                          defaultValue={edge.label ?? ""}
                          onBlur={(ev) => {
                            const val = ev.currentTarget.value.trim();
                            const updated = { ...edge, label: val || undefined };
                            if (!val) delete updated.label;
                            schedulePersist(upsertCanvasEdge(docRef.current, updated));
                            setEditingEdgeLabel(null);
                          }}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter" || ev.key === "Escape") {
                              ev.currentTarget.blur();
                            }
                            ev.stopPropagation();
                          }}
                        />
                      </foreignObject>
                    );
                  }
                  if (!edge.label) return null;
                  return (
                    <g
                      transform={`translate(${mx}, ${my})`}
                      className="cursor-pointer"
                      onDoubleClick={(ev) => {
                        ev.stopPropagation();
                        setEditingEdgeLabel(edge.id);
                      }}
                    >
                      <rect
                        x={-edge.label.length * 3.5 - 6}
                        y={-10}
                        width={edge.label.length * 7 + 12}
                        height={20}
                        rx={4}
                        className="fill-popover stroke-foreground/10"
                        strokeWidth={1}
                      />
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        className="fill-foreground/70 text-[11px] font-medium"
                        style={{ pointerEvents: "none" }}
                      >
                        {edge.label}
                      </text>
                    </g>
                  );
                })();

                return (
                  <g key={edge.id}>
                    {/* Fat transparent hit area */}
                    <path
                      d={d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={20}
                      className="cursor-pointer"
                      onClick={(ev) => handleEdgeClick(edge, ev)}
                      onDoubleClick={(ev) => {
                        ev.stopPropagation();
                        setEditingEdgeLabel(edge.id);
                      }}
                    />
                    {/* Visible stroke */}
                    <path
                      d={d}
                      fill="none"
                      stroke={
                        edgeColor ??
                        (unbound
                          ? "color-mix(in oklab, var(--foreground) 15%, transparent)"
                          : selected
                            ? "var(--primary)"
                            : "currentColor")
                      }
                      strokeWidth={selected ? 2.5 : 1.5}
                      className="pointer-events-none transition-colors"
                      markerEnd={markerEnd}
                      markerStart={markerStart}
                    >
                      {unbound && <title>prop no longer present — rebind?</title>}
                    </path>
                    {labelEl}
                  </g>
                );
              })}
            </g>

            {/* Ghost edge while creating connection */}
            {ghostEdge &&
              (() => {
                const stageEl = document.querySelector("[data-canvas-stage]")?.parentElement;
                if (!stageEl) return null;
                const stageRect = stageEl.getBoundingClientRect();
                const endWorld = {
                  x: (ghostEdge.endX - stageRect.left - pan.x) / zoom,
                  y: (ghostEdge.endY - stageRect.top - pan.y) / zoom,
                };
                const a = ghostEdge.start;
                const b = endWorld;
                const dx = Math.max(40, Math.abs(b.x - a.x) * 0.45);
                const c1x =
                  a.x +
                  (ghostEdge.fromSide === "left" ? -dx : ghostEdge.fromSide === "right" ? dx : 0);
                const c1y =
                  a.y +
                  (ghostEdge.fromSide === "top" ? -dx : ghostEdge.fromSide === "bottom" ? dx : 0);
                const ghostD = `M ${a.x} ${a.y} C ${c1x} ${c1y}, ${b.x} ${b.y}, ${b.x} ${b.y}`;
                return (
                  <path
                    d={ghostD}
                    fill="none"
                    stroke="var(--primary)"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    className="pointer-events-none"
                    opacity={0.6}
                  />
                );
              })()}
          </svg>

          {/* Alignment snap guides */}
          {snapGuides.map((g, i) =>
            g.axis === "x" ? (
              <div
                key={`sg-${i}`}
                className="absolute border-l border-dashed border-primary/40"
                style={{ left: g.pos, top: -4000, height: 8000, pointerEvents: "none" }}
              />
            ) : (
              <div
                key={`sg-${i}`}
                className="absolute border-t border-dashed border-primary/40"
                style={{ top: g.pos, left: -4000, width: 8000, pointerEvents: "none" }}
              />
            ),
          )}

          {/* Marquee selection rectangle */}
          {marqueeRect && (
            <div
              className="absolute border border-primary/40 bg-primary/10"
              style={{
                left: Math.min(marqueeRect.x, marqueeRect.x + marqueeRect.w),
                top: Math.min(marqueeRect.y, marqueeRect.y + marqueeRect.h),
                width: Math.abs(marqueeRect.w),
                height: Math.abs(marqueeRect.h),
                pointerEvents: "none",
              }}
            />
          )}

          <div data-canvas-stage className="contents">
            {doc.nodes.map((card) => {
              const isSelected = selection.nodeIds.has(card.id);

              if (isGroupNode(card)) {
                return (
                  <div
                    key={card.id}
                    data-card-id={card.id}
                    className={cn(
                      "group/card absolute rounded-md border border-dashed bg-foreground/[0.02]",
                      isSelected ? "border-primary/40" : "border-foreground/10",
                    )}
                    style={{
                      left: card.x,
                      top: card.y,
                      width: card.width,
                      height: card.height,
                    }}
                    onPointerDown={(e) => {
                      if ((e.target as HTMLElement).closest("[data-port]")) return;
                      if ((e.target as HTMLElement).closest("[data-resize]")) return;
                      e.stopPropagation();
                      handleCardPointerDown(card, e);
                    }}
                  >
                    {card.label && (
                      <div className="px-2 py-1 text-[11px] text-foreground/40">{card.label}</div>
                    )}
                    {renderResizeHandles(card, isSelected)}
                    {renderPorts(card, portHandler(card.id))}
                  </div>
                );
              }
              if (isTextNode(card)) {
                return (
                  <div key={card.id} data-card-id={card.id}>
                    <TextCard
                      card={card}
                      selected={isSelected}
                      onSelect={() => {
                        if (!selection.nodeIds.has(card.id)) {
                          setSelection(selNode(card.id));
                        }
                      }}
                      onChange={(text) =>
                        schedulePersist(upsertCanvasNode(docRef.current, { ...card, text }))
                      }
                      onMoveStart={(e) => {
                        handleCardPointerDown(card, e);
                      }}
                      onResizeStart={(e) => {
                        dragRef.current = {
                          kind: "resize-pending",
                          id: card.id,
                          corner: "se",
                          startX: e.clientX,
                          startY: e.clientY,
                          origX: card.x,
                          origY: card.y,
                          origW: card.width,
                          origH: card.height,
                        };
                        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                      }}
                      onPortDown={portHandler(card.id)}
                    />
                  </div>
                );
              }
              if (isShapeNode(card)) {
                return (
                  <div key={card.id} data-card-id={card.id}>
                    <ShapeCard
                      card={card}
                      selected={isSelected}
                      onSelect={(anchor) => {
                        if (!selection.nodeIds.has(card.id)) {
                          setSelection(selNode(card.id));
                          setShapeInspectorAnchor(anchor);
                        }
                      }}
                      onLabelChange={(label) =>
                        schedulePersist(
                          upsertCanvasNode(docRef.current, {
                            ...card,
                            label,
                          }),
                        )
                      }
                      onMoveStart={(e) => {
                        handleCardPointerDown(card, e, {
                          x: e.clientX,
                          y: e.clientY,
                        });
                      }}
                      onResizeStart={(e) => {
                        dragRef.current = {
                          kind: "resize-pending",
                          id: card.id,
                          corner: "se",
                          startX: e.clientX,
                          startY: e.clientY,
                          origX: card.x,
                          origY: card.y,
                          origW: card.width,
                          origH: card.height,
                        };
                        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                      }}
                      onPortDown={portHandler(card.id)}
                    />
                  </div>
                );
              }
              if (!isKbNode(card)) {
                return (
                  <div
                    key={card.id}
                    data-card-id={card.id}
                    className={cn(
                      "group/card absolute rounded-md border bg-background px-2 py-1 text-[11px] text-foreground/40",
                      isSelected ? "border-primary/40" : "border-foreground/[0.06]",
                    )}
                    style={{
                      left: card.x,
                      top: card.y,
                      width: card.width,
                      height: card.height,
                    }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      handleCardPointerDown(card, e);
                    }}
                  >
                    {card.type}
                    {renderResizeHandles(card, isSelected)}
                    {renderPorts(card, portHandler(card.id))}
                  </div>
                );
              }
              return (
                <div key={card.id} data-card-id={card.id}>
                  <KbNodeCard
                    card={card}
                    selected={isSelected}
                    onSelect={() => {
                      if (!selection.nodeIds.has(card.id)) {
                        setSelection(selNode(card.id));
                        setInspectorAnchor(null);
                        setShapeInspectorAnchor(null);
                      }
                    }}
                    onMoveStart={(e) => {
                      handleCardPointerDown(card, e);
                    }}
                    onResizeStart={(e) => {
                      dragRef.current = {
                        kind: "resize-pending",
                        id: card.id,
                        corner: "se",
                        startX: e.clientX,
                        startY: e.clientY,
                        origX: card.x,
                        origY: card.y,
                        origW: card.width,
                        origH: card.height,
                      };
                      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                    }}
                    onPortDown={portHandler(card.id)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Floating selection toolbar */}
      {!selectionEmpty(selection) && !inspectorAnchor && !shapeInspectorAnchor && (
        <div className="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-foreground/10 bg-popover/95 px-2 py-1.5 shadow-lg backdrop-blur-sm">
          <span className="mr-1 text-[11px] text-foreground/40">
            {selection.nodeIds.size + selection.edgeIds.size} selected
          </span>
          <button
            type="button"
            title="Bring to front"
            className="rounded-md px-1.5 py-1 text-[11px] text-foreground/60 hover:bg-foreground/5"
            onClick={() => {
              let nextDoc = docRef.current;
              const kept = nextDoc.nodes.filter((n) => !selection.nodeIds.has(n.id));
              const moved = nextDoc.nodes.filter((n) => selection.nodeIds.has(n.id));
              nextDoc = { ...nextDoc, nodes: [...kept, ...moved] };
              schedulePersist(nextDoc);
            }}
          >
            ↑ Front
          </button>
          <button
            type="button"
            title="Send to back"
            className="rounded-md px-1.5 py-1 text-[11px] text-foreground/60 hover:bg-foreground/5"
            onClick={() => {
              let nextDoc = docRef.current;
              const moved = nextDoc.nodes.filter((n) => selection.nodeIds.has(n.id));
              const kept = nextDoc.nodes.filter((n) => !selection.nodeIds.has(n.id));
              nextDoc = { ...nextDoc, nodes: [...moved, ...kept] };
              schedulePersist(nextDoc);
            }}
          >
            ↓ Back
          </button>
          <div className="mx-1 h-4 w-px bg-foreground/10" />
          <button
            type="button"
            title="Delete selected (Del)"
            className="rounded-md px-1.5 py-1 text-[11px] text-destructive hover:bg-destructive/10"
            onClick={() => {
              const nextDoc = deleteSelected(docRef.current, selection);
              schedulePersist(nextDoc);
              setSelection(EMPTY_SELECTION);
            }}
          >
            Delete
          </button>
        </div>
      )}

      {selectedEdgeObj && inspectorAnchor && (
        <EdgeInspector
          edge={selectedEdgeObj}
          anchor={inspectorAnchor}
          refFields={refFields}
          onClose={() => {
            setSelection(EMPTY_SELECTION);
            setInspectorAnchor(null);
          }}
          onModeChange={(m) => void onModeChange(m)}
          onFieldChange={(f) => void onFieldChange(f)}
          onDelete={() => void onDeleteEdge()}
          onArrowChange={(end, val) => {
            const next = upsertCanvasEdge(docRef.current, { ...selectedEdgeObj, [end]: val });
            schedulePersist(next);
          }}
          onColorChange={(color) => {
            const updated = { ...selectedEdgeObj };
            if (color === undefined) delete updated.color;
            else updated.color = color;
            const next = upsertCanvasEdge(docRef.current, updated);
            schedulePersist(next);
          }}
          onLabelChange={(label) => {
            const updated = { ...selectedEdgeObj, label: label || undefined };
            if (!label) delete updated.label;
            const next = upsertCanvasEdge(docRef.current, updated);
            schedulePersist(next);
          }}
        />
      )}
      {selectedShape && shapeInspectorAnchor && (
        <ShapeInspector
          card={selectedShape}
          anchor={shapeInspectorAnchor}
          onClose={() => setShapeInspectorAnchor(null)}
          onColorChange={(color) => {
            const next = { ...selectedShape };
            if (color === undefined) delete next.color;
            else next.color = color;
            schedulePersist(upsertCanvasNode(docRef.current, next));
          }}
        />
      )}
      {pickerOpen && <NodePicker onPick={addKbNode} onClose={() => setPickerOpen(false)} />}
    </div>
  );
}
