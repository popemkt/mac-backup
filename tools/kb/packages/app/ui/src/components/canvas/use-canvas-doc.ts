import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { withCanvasCamera, type CanvasCamera, type CanvasDoc } from "@kb/canvas";
import { persistCanvasDoc, readCanvasDoc, syncDocOnRev } from "./canvas-api";
import {
  adoptStored,
  canvasContent,
  initHistory,
  pushHistory,
  redo as redoHistory,
  undo as undoHistory,
  type CanvasHistory,
} from "./canvas-history";
import type { OutlineNode } from "@kb/ui-sdk";

const DEBOUNCE_MS = 300;

/** How many of its own writes a canvas remembers, to know their echoes. */
const REMEMBERED = 16;

type Send = (
  doc: CanvasDoc,
  ...opts: [Parameters<typeof persistCanvasDoc>[2]?]
) => Promise<boolean>;

/**
 * The canvas's writes to the store, remembered by content: the store echoing
 * one back, late, is not an edit made elsewhere (`adoptStored`).
 */
function useSentDocs(canvasId: string) {
  const sent = useRef<string[]>([]);
  const send: Send = useCallback(
    (doc, ...opts) => {
      sent.current = [...sent.current.slice(1 - REMEMBERED), canvasContent(doc)];
      return persistCanvasDoc(canvasId, doc, ...opts);
    },
    [canvasId],
  );
  const wasSent = useCallback((content: string) => sent.current.includes(content), []);
  return { send, wasSent };
}

/**
 * `next` looked at the way the canvas is now. The camera is view state, not
 * content: whatever document an edit was derived from, and wherever undo
 * goes, the view stays. Only `setCamera` and the store move it.
 */
function keepView(now: CanvasDoc, next: CanvasDoc): CanvasDoc {
  return withCanvasCamera(next, now.camera);
}

/** Undo and redo: a step through the history, with the view left where it is. */
function useHistoryTravel(
  send: Send,
  historyRef: RefObject<CanvasHistory>,
  installHistory: (next: CanvasHistory) => void,
) {
  return useCallback(
    (transform: (current: CanvasHistory) => CanvasHistory) => {
      const current = historyRef.current;
      const travelled = transform(current);
      if (travelled === current) return;
      const next = { ...travelled, present: keepView(current.present, travelled.present) };
      installHistory(next);
      void send(next.present);
    },
    [send, historyRef, installHistory],
  );
}

/**
 * The canvas's one write path: whatever is applied is written once edits
 * pause, or at once on demand, and a pending write still goes out when the
 * canvas closes. Content edits and camera changes both take it, in order.
 */
function useWritePath(send: Send, applied: () => CanvasDoc) {
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const write = useCallback(() => {
    timerRef.current = null;
    dirtyRef.current = false;
    void send(applied());
  }, [applied, send]);
  const soon = useCallback(() => {
    dirtyRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(write, DEBOUNCE_MS);
  }, [write]);
  const now = useCallback(
    async (doc: CanvasDoc, opts?: Parameters<typeof persistCanvasDoc>[2]) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      dirtyRef.current = false;
      await send(doc, opts);
    },
    [send],
  );
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (dirtyRef.current) write();
    },
    [write],
  );
  return { soon, now, pending: useCallback(() => dirtyRef.current, []) };
}

interface UseCanvasDocOptions {
  canvasId: string;
  canvasNode: OutlineNode | undefined;
  nodes: Map<string, OutlineNode>;
  rev: number;
  isInteracting: () => boolean;
}

export function useCanvasDoc({
  canvasId,
  canvasNode,
  nodes,
  rev,
  isInteracting,
}: UseCanvasDocOptions) {
  const [history, setHistory] = useState<CanvasHistory>(() =>
    initHistory(readCanvasDoc(canvasNode)),
  );
  const historyRef = useRef(history);
  historyRef.current = history;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const docRef = useRef(history.present);
  docRef.current = history.present;
  const previewBase = useRef<CanvasHistory | null>(null);
  // A preview is not yet an edit: what is written is the history under it.
  const applied = useCallback(() => (previewBase.current ?? historyRef.current).present, []);
  const { send, wasSent } = useSentDocs(canvasId);
  const writes = useWritePath(send, applied);

  const installHistory = useCallback((next: CanvasHistory) => {
    historyRef.current = next;
    docRef.current = next.present;
    setHistory(next);
  }, []);

  const applyDoc = useCallback(
    (next: CanvasDoc) => {
      const view = keepView(historyRef.current.present, next);
      const updated = pushHistory(previewBase.current ?? historyRef.current, view);
      previewBase.current = null;
      installHistory(updated);
    },
    [installHistory],
  );

  const applyDocSilent = useCallback(
    (next: CanvasDoc) => {
      installHistory({ ...historyRef.current, present: next });
    },
    [installHistory],
  );

  const previewDoc = useCallback(
    (next: CanvasDoc) => {
      previewBase.current ??= historyRef.current;
      applyDocSilent(keepView(historyRef.current.present, next));
    },
    [applyDocSilent],
  );

  const { soon, now, pending } = writes;
  const schedulePersist = useCallback(
    (next: CanvasDoc) => {
      applyDoc(next);
      soon();
    },
    [applyDoc, soon],
  );

  /** Look through `camera`: written on the same path as an edit, never an undo step. */
  const setCamera = useCallback(
    (camera: CanvasCamera) => {
      applyDocSilent(withCanvasCamera(historyRef.current.present, camera));
      soon();
    },
    [applyDocSilent, soon],
  );

  const flushPersist = useCallback(
    async (next: CanvasDoc, opts?: Parameters<typeof persistCanvasDoc>[2]) => {
      applyDoc(next);
      await now(historyRef.current.present, opts);
    },
    [applyDoc, now],
  );

  const cancelPreview = useCallback(() => {
    const base = previewBase.current;
    if (!base) return;
    previewBase.current = null;
    installHistory(base);
  }, [installHistory]);

  const travel = useHistoryTravel(send, historyRef, installHistory);

  /** What the store holds now, taken in: an edit made elsewhere is one step to undo. */
  const adoptStoredDoc = useCallback(
    (stored: CanvasDoc) => installHistory(adoptStored(historyRef.current, stored, wasSent)),
    [installHistory, wasSent],
  );

  useEffect(() => {
    syncDocOnRev(canvasId, nodesRef.current, {
      adopt: adoptStoredDoc,
      isBusy: () => isInteracting() || pending(),
    });
  }, [adoptStoredDoc, canvasId, isInteracting, pending, rev]);

  return {
    doc: history.present,
    docRef,
    schedulePersist,
    previewDoc,
    flushPersist,
    setCamera,
    undo: () => travel(undoHistory),
    redo: () => travel(redoHistory),
    cancelPreview,
  };
}
