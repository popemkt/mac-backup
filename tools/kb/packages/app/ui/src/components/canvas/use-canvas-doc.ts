import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasDoc } from "@kb/canvas";
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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyDoc = useCallback((next: CanvasDoc) => {
    setHistory((current) => pushHistory(current, next));
  }, []);

  const applyDocSilent = useCallback((next: CanvasDoc) => {
    setHistory((current) => ({ ...current, present: next }));
  }, []);

  const persistLastApplied = useCallback(() => {
    timerRef.current = null;
    dirtyRef.current = false;
    void persistCanvasDoc(canvasId, historyRef.current.present);
  }, [canvasId]);

  const schedule = useCallback(
    (next: CanvasDoc, silent: boolean) => {
      dirtyRef.current = true;
      if (silent) applyDocSilent(next);
      else applyDoc(next);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(persistLastApplied, DEBOUNCE_MS);
    },
    [applyDoc, applyDocSilent, persistLastApplied],
  );

  const schedulePersist = useCallback((next: CanvasDoc) => schedule(next, false), [schedule]);
  const schedulePersistSilent = useCallback((next: CanvasDoc) => schedule(next, true), [schedule]);

  const flushPersist = useCallback(
    async (next: CanvasDoc, opts?: Parameters<typeof persistCanvasDoc>[2]) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      dirtyRef.current = false;
      applyDoc(next);
      await persistCanvasDoc(canvasId, next, opts);
    },
    [applyDoc, canvasId],
  );

  const undo = useCallback(() => {
    setHistory((current) => {
      const next = undoHistory(current);
      if (next !== current) void persistCanvasDoc(canvasId, next.present);
      return next;
    });
  }, [canvasId]);

  const redo = useCallback(() => {
    setHistory((current) => {
      const next = redoHistory(current);
      if (next !== current) void persistCanvasDoc(canvasId, next.present);
      return next;
    });
  }, [canvasId]);

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
    schedulePersistSilent,
    flushPersist,
    undo,
    redo,
  };
}
