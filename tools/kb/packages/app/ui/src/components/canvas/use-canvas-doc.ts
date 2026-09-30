import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { withCanvasCamera, type CanvasCamera, type CanvasDoc } from "@kb/canvas";
import { persistCanvasDoc, readCanvasDoc, syncDocOnRev } from "@/lib/canvas-api";
import {
  initHistory,
  pushHistory,
  redo as redoHistory,
  undo as undoHistory,
  type CanvasHistory,
} from "@/lib/canvas-history";
import type { OutlineNode } from "@/lib/types";

const DEBOUNCE_MS = 300;

/**
 * `next` looked at the way the canvas is now. The camera is view state, not
 * content: whatever document an edit was derived from, and wherever undo
 * goes, the view stays. Only `setCamera` and the store move it.
 */
function keepView(now: CanvasDoc, next: CanvasDoc): CanvasDoc {
  return withCanvasCamera(next, now.camera);
}

/** Undo and redo, and the camera, which moves outside the history. */
function useViewOps(
  canvasId: string,
  historyRef: RefObject<CanvasHistory>,
  installHistory: (next: CanvasHistory) => void,
) {
  return useMemo(() => {
    const install = (next: CanvasHistory) => {
      installHistory(next);
      void persistCanvasDoc(canvasId, next.present);
    };
    return {
      travel: (transform: (current: CanvasHistory) => CanvasHistory) => {
        const current = historyRef.current;
        const travelled = transform(current);
        if (travelled === current) return;
        install({ ...travelled, present: keepView(current.present, travelled.present) });
      },
      /** Look through `camera`: saved with the document, never an undo step. */
      setCamera: (camera: CanvasCamera) => {
        const current = historyRef.current;
        install({ ...current, present: withCanvasCamera(current.present, camera) });
      },
    };
  }, [canvasId, historyRef, installHistory]);
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
  const dirtyRef = useRef(false);
  const previewBase = useRef<CanvasHistory | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const persistLastApplied = useCallback(() => {
    timerRef.current = null;
    dirtyRef.current = false;
    void persistCanvasDoc(canvasId, (previewBase.current ?? historyRef.current).present);
  }, [canvasId]);

  const previewDoc = useCallback(
    (next: CanvasDoc) => {
      previewBase.current ??= historyRef.current;
      applyDocSilent(keepView(historyRef.current.present, next));
    },
    [applyDocSilent],
  );

  const schedulePersist = useCallback(
    (next: CanvasDoc) => {
      dirtyRef.current = true;
      applyDoc(next);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(persistLastApplied, DEBOUNCE_MS);
    },
    [applyDoc, persistLastApplied],
  );

  const flushPersist = useCallback(
    async (next: CanvasDoc, opts?: Parameters<typeof persistCanvasDoc>[2]) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      dirtyRef.current = false;
      applyDoc(next);
      await persistCanvasDoc(canvasId, historyRef.current.present, opts);
    },
    [applyDoc, canvasId],
  );

  const cancelPreview = useCallback(() => {
    const base = previewBase.current;
    if (!base) return;
    previewBase.current = null;
    installHistory(base);
  }, [installHistory]);

  const view = useViewOps(canvasId, historyRef, installHistory);

  useEffect(() => {
    syncDocOnRev(canvasId, nodesRef.current, {
      applyLocal: applyDocSilent,
      isBusy: () => isInteracting() || dirtyRef.current,
    });
  }, [applyDocSilent, canvasId, isInteracting, rev]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (dirtyRef.current) persistLastApplied();
    },
    [persistLastApplied],
  );

  return {
    doc: history.present,
    docRef,
    schedulePersist,
    previewDoc,
    flushPersist,
    setCamera: view.setCamera,
    undo: () => view.travel(undoHistory),
    redo: () => view.travel(redoHistory),
    cancelPreview,
  };
}
