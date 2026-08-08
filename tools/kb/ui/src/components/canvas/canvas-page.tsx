import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ulid } from "ulid";
import type {
  CanvasDoc,
  CanvasEdge,
  CanvasNode,
  CanvasSide,
  KbLinkMode,
} from "@kb/canvas";
import {
  removeCanvasEdge,
  upsertCanvasEdge,
  upsertCanvasNode,
} from "@kb/canvas";
import { Bullet } from "@/components/outline/bullet";
import { NodeRow } from "@/components/outline/node-row";
import { KbNodeCard, TextCard } from "@/components/canvas/canvas-card";
import { EdgeInspector } from "@/components/canvas/edge-inspector";
import { NodePicker } from "@/components/canvas/node-picker";
import { edgePath } from "@/components/canvas/edge-path";
import {
  listRefFields,
  persistCanvasDoc,
  readCanvasDoc,
  reconcileAndMaybePersist,
} from "@/lib/canvas-api";
import { navigate } from "@/lib/router";
import { useOutlineStore } from "@/stores/outline.store";
import { cn } from "@/lib/cn";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
const DEBOUNCE_MS = 300;

interface CanvasPageProps {
  canvasId: string;
}

type Drag =
  | { kind: "pan"; x: number; y: number; ox: number; oy: number }
  | {
      kind: "move";
      id: string;
      startX: number;
      startY: number;
      origX: number;
      origY: number;
    }
  | {
      kind: "resize";
      id: string;
      startX: number;
      startY: number;
      origW: number;
      origH: number;
    }
  | {
      kind: "edge";
      fromCardId: string;
      fromSide: CanvasSide;
      x: number;
      y: number;
    };

export function CanvasPage({ canvasId }: CanvasPageProps) {
  const nodes = useOutlineStore((s) => s.nodes);
  const rev = useOutlineStore((s) => s.rev);
  const canvasNode = nodes.get(canvasId);

  const [doc, setDoc] = useState<CanvasDoc>(() =>
    readCanvasDoc(canvasNode),
  );
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [zoom, setZoom] = useState(1);
  const [spaceDown, setSpaceDown] = useState(false);
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [inspectorAnchor, setInspectorAnchor] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const dragRef = useRef<Drag | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;

  // Load + reconcile on rev bumps (WS / remote prop changes).
  useEffect(() => {
    const map = useOutlineStore.getState().nodes;
    const next = readCanvasDoc(map.get(canvasId));
    const reconciled = reconcileAndMaybePersist(canvasId, next, map);
    setDoc(reconciled);
  }, [canvasId, rev]);

  const schedulePersist = useCallback(
    (next: CanvasDoc) => {
      setDoc(next);
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(() => {
        void persistCanvasDoc(canvasId, next);
      }, DEBOUNCE_MS);
    },
    [canvasId],
  );

  const flushPersist = useCallback(
    async (
      next: CanvasDoc,
      opts?: Parameters<typeof persistCanvasDoc>[2],
    ) => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
      setDoc(next);
      await persistCanvasDoc(canvasId, next, opts);
    },
    [canvasId],
  );

  const byId = useMemo(() => {
    const m = new Map<string, CanvasNode>();
    for (const n of doc.nodes) m.set(n.id, n);
    return m;
  }, [doc.nodes]);

  const refFields = useMemo(() => listRefFields(nodes), [nodes]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && !(e.target as HTMLElement).isContentEditable) {
        setSpaceDown(true);
        e.preventDefault();
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
      setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor)));
      return;
    }
    setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
  };

  const onPointerDownStage = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button === 1 || spaceDown || e.button === 0 && e.altKey) {
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
    if (e.button === 0 && e.target === e.currentTarget) {
      setSelectedCard(null);
      setSelectedEdge(null);
      setInspectorAnchor(null);
    }
  };

  const onDoubleClickStage = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
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
    setSelectedCard(card.id);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === "pan") {
      setPan({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) });
      return;
    }
    if (d.kind === "move") {
      const dx = (e.clientX - d.startX) / zoom;
      const dy = (e.clientY - d.startY) / zoom;
      const node = byId.get(d.id);
      if (!node) return;
      schedulePersist(
        upsertCanvasNode(docRef.current, {
          ...node,
          x: d.origX + dx,
          y: d.origY + dy,
        }),
      );
      return;
    }
    if (d.kind === "resize") {
      const dx = (e.clientX - d.startX) / zoom;
      const dy = (e.clientY - d.startY) / zoom;
      const node = byId.get(d.id);
      if (!node) return;
      schedulePersist(
        upsertCanvasNode(docRef.current, {
          ...node,
          width: Math.max(120, d.origW + dx),
          height: Math.max(48, d.origH + dy),
        }),
      );
      return;
    }
    if (d.kind === "edge") {
      dragRef.current = { ...d, x: e.clientX, y: e.clientY };
      // force re-render for preview line
      setPan((p) => ({ ...p }));
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.kind !== "edge") return;

    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const cardEl = el?.closest("[data-card-id]") as HTMLElement | null;
    const toCardId = cardEl?.dataset.cardId;
    if (!toCardId || toCardId === d.fromCardId) return;
    const from = byId.get(d.fromCardId);
    const to = byId.get(toCardId);
    if (!from || !to) return;

    const edge: CanvasEdge = {
      id: ulid(),
      fromNode: d.fromCardId,
      toNode: toCardId,
      fromSide: d.fromSide,
      toSide: "left",
      toEnd: "arrow",
      kbLink: {
        mode: "layout",
        via: "prop",
        fieldId: "",
        sourceNodeId: from.type === "kb-node" ? from.nodeId : "",
        targetNodeId: to.type === "kb-node" ? to.nodeId : "",
        bindingId: ulid(),
      },
    };
    void flushPersist(upsertCanvasEdge(docRef.current, edge));
    setSelectedEdge(edge.id);
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
    setSelectedCard(card.id);
  };

  const selectedEdgeObj = doc.edges.find((e) => e.id === selectedEdge) ?? null;

  const onModeChange = async (mode: KbLinkMode) => {
    if (!selectedEdgeObj) return;
    const from = byId.get(selectedEdgeObj.fromNode);
    const to = byId.get(selectedEdgeObj.toNode);
    if (!from || !to || from.type !== "kb-node" || to.type !== "kb-node") {
      const next = upsertCanvasEdge(docRef.current, {
        ...selectedEdgeObj,
        kbLink: selectedEdgeObj.kbLink
          ? { ...selectedEdgeObj.kbLink, mode }
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
    const nextEdge = { ...selectedEdgeObj, kbLink: link };
    const next = upsertCanvasEdge(docRef.current, nextEdge);

    if (mode === "native" && link.fieldId) {
      await flushPersist(next, {
        propTargetId: from.nodeId,
        setProps: [
          { field: link.fieldId, value: { t: "ref", v: to.nodeId } },
        ],
      });
    } else if (
      mode === "layout" &&
      selectedEdgeObj.kbLink?.mode === "native" &&
      selectedEdgeObj.kbLink.fieldId
    ) {
      await flushPersist(next, {
        propTargetId: from.nodeId,
        unsetProps: [
          {
            field: selectedEdgeObj.kbLink.fieldId,
            value: { t: "ref", v: to.nodeId },
          },
        ],
      });
    } else {
      await flushPersist(next);
    }
  };

  const onFieldChange = async (fieldId: string) => {
    if (!selectedEdgeObj) return;
    const from = byId.get(selectedEdgeObj.fromNode);
    const to = byId.get(selectedEdgeObj.toNode);
    if (!from || !to || from.type !== "kb-node" || to.type !== "kb-node") return;

    const prev = selectedEdgeObj.kbLink;
    const link = {
      mode: (prev?.mode ?? "native") as KbLinkMode,
      via: "prop" as const,
      fieldId,
      sourceNodeId: from.nodeId,
      targetNodeId: to.nodeId,
      bindingId: prev?.bindingId ?? ulid(),
    };
    // Promote to native when picking a field.
    link.mode = "native";
    const next = upsertCanvasEdge(docRef.current, {
      ...selectedEdgeObj,
      kbLink: link,
    });

    const unsetProps =
      prev?.mode === "native" && prev.fieldId && prev.fieldId !== fieldId
        ? [
            {
              field: prev.fieldId,
              value: { t: "ref" as const, v: to.nodeId },
            },
          ]
        : undefined;

    await flushPersist(next, {
      propTargetId: from.nodeId,
      unsetProps,
      setProps: [{ field: fieldId, value: { t: "ref", v: to.nodeId } }],
    });
  };

  const onDeleteEdge = async () => {
    if (!selectedEdgeObj) return;
    const next = removeCanvasEdge(docRef.current, selectedEdgeObj.id);
    const link = selectedEdgeObj.kbLink;
    if (link?.mode === "native" && link.fieldId) {
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
    setSelectedEdge(null);
    setInspectorAnchor(null);
  };

  if (!canvasNode) {
    return (
      <div className="p-6 text-[13px] text-destructive">
        Canvas not found: {canvasId}{" "}
        <button
          type="button"
          className="underline"
          onClick={() => navigate("/canvas")}
        >
          back
        </button>
      </div>
    );
  }

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
          bullet={
            <Bullet
              node={canvasNode}
              tagColor={canvasNode.tags[0]?.color ?? null}
              onClick={() => {}}
            />
          }
          content={
            <span className="truncate text-[13px] text-foreground/70">
              {canvasNode.text}
            </span>
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
        <span className="text-[11px] text-foreground/30">
          {Math.round(zoom * 100)}%
        </span>
      </div>

      <div
        className={cn(
          "relative min-h-0 flex-1 overflow-hidden",
          spaceDown ? "cursor-grab" : "cursor-default",
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
            </defs>
            <g className="pointer-events-auto text-foreground/35">
              {doc.edges.map((edge) => {
                const from = byId.get(edge.fromNode);
                const to = byId.get(edge.toNode);
                if (!from || !to) return null;
                const d = edgePath(from, to, edge);
                const selected = edge.id === selectedEdge;
                return (
                  <path
                    key={edge.id}
                    d={d}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={selected ? 2.5 : 1.5}
                    className={cn(
                      selected ? "text-primary" : "text-foreground/35",
                      "cursor-pointer",
                    )}
                    markerEnd={
                      edge.toEnd === "none" ? undefined : "url(#kb-arrow)"
                    }
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setSelectedEdge(edge.id);
                      setSelectedCard(null);
                      setInspectorAnchor({
                        x: ev.clientX,
                        y: ev.clientY,
                      });
                    }}
                  />
                );
              })}
            </g>
          </svg>

          <div data-canvas-stage className="contents">
            {doc.nodes.map((card) => {
              if (card.type === "group") {
                return (
                  <div
                    key={card.id}
                    data-card-id={card.id}
                    className="absolute rounded-md border border-dashed border-foreground/10 bg-foreground/[0.02]"
                    style={{
                      left: card.x,
                      top: card.y,
                      width: card.width,
                      height: card.height,
                    }}
                  >
                    {card.label && (
                      <div className="px-2 py-1 text-[11px] text-foreground/40">
                        {card.label}
                      </div>
                    )}
                  </div>
                );
              }
              if (card.type === "text") {
                return (
                  <div key={card.id} data-card-id={card.id}>
                    <TextCard
                      card={card}
                      selected={selectedCard === card.id}
                      onSelect={() => setSelectedCard(card.id)}
                      onChange={(text) =>
                        schedulePersist(
                          upsertCanvasNode(docRef.current, { ...card, text }),
                        )
                      }
                      onMoveStart={(e) => {
                        dragRef.current = {
                          kind: "move",
                          id: card.id,
                          startX: e.clientX,
                          startY: e.clientY,
                          origX: card.x,
                          origY: card.y,
                        };
                        (e.target as HTMLElement).setPointerCapture?.(
                          e.pointerId,
                        );
                      }}
                      onResizeStart={(e) => {
                        dragRef.current = {
                          kind: "resize",
                          id: card.id,
                          startX: e.clientX,
                          startY: e.clientY,
                          origW: card.width,
                          origH: card.height,
                        };
                      }}
                      onPortDown={(side, e) => {
                        dragRef.current = {
                          kind: "edge",
                          fromCardId: card.id,
                          fromSide: side,
                          x: e.clientX,
                          y: e.clientY,
                        };
                      }}
                    />
                  </div>
                );
              }
              return (
                <div key={card.id} data-card-id={card.id}>
                  <KbNodeCard
                    card={card}
                    selected={selectedCard === card.id}
                    onSelect={() => setSelectedCard(card.id)}
                    onMoveStart={(e) => {
                      dragRef.current = {
                        kind: "move",
                        id: card.id,
                        startX: e.clientX,
                        startY: e.clientY,
                        origX: card.x,
                        origY: card.y,
                      };
                    }}
                    onResizeStart={(e) => {
                      dragRef.current = {
                        kind: "resize",
                        id: card.id,
                        startX: e.clientX,
                        startY: e.clientY,
                        origW: card.width,
                        origH: card.height,
                      };
                    }}
                    onPortDown={(side, e) => {
                      dragRef.current = {
                        kind: "edge",
                        fromCardId: card.id,
                        fromSide: side,
                        x: e.clientX,
                        y: e.clientY,
                      };
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {selectedEdgeObj && inspectorAnchor && (
        <EdgeInspector
          edge={selectedEdgeObj}
          anchor={inspectorAnchor}
          refFields={refFields}
          onClose={() => {
            setSelectedEdge(null);
            setInspectorAnchor(null);
          }}
          onModeChange={(m) => void onModeChange(m)}
          onFieldChange={(f) => void onFieldChange(f)}
          onDelete={() => void onDeleteEdge()}
        />
      )}
      {pickerOpen && (
        <NodePicker
          onPick={addKbNode}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
