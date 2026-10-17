import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  CANVAS_IDS,
  CanvasView,
  canvasCameraProps,
  canvasViewIdOf,
  posesAgree,
  readCanvasCamera,
  type CanvasCamera,
} from "@kb/canvas";
import { browserHost, type OutlineNode } from "@kb/ui-sdk";

/** How long a camera waits for gestures to pause before it is written. */
const DEBOUNCE_MS = 300;

const sameCamera = (a: CanvasCamera | undefined, b: CanvasCamera | undefined) =>
  a?.projection === b?.projection && posesAgree(a?.pose, b?.pose);

interface UseCanvasCameraOptions {
  readonly canvasId: string;
  /** The view node the page shows the canvas through, when its route names one. */
  readonly viewNode: string | undefined;
  readonly nodes: ReadonlyMap<string, OutlineNode>;
}

/**
 * Write `camera` onto the canvas view node `viewId`, only the fields it
 * changes; or, when the canvas names no canvas view, propose one for it,
 * looking through `camera`, and answer its id.
 */
async function writeCamera(
  canvasId: string,
  viewId: string | null,
  stored: CanvasCamera | undefined,
  camera: CanvasCamera,
): Promise<string | null> {
  const host = browserHost();
  if (viewId === null) {
    const proposed = await host.proposeView({
      view: CanvasView,
      params: { id: canvasId, ...camera },
      host: canvasId,
    });
    return "id" in proposed ? proposed.id : null;
  }
  const props = canvasCameraProps(camera);
  if (camera.projection !== stored?.projection)
    await host.writes.replaceField(
      viewId,
      CANVAS_IDS.canvasProjectionField,
      props[CANVAS_IDS.canvasProjectionField] ?? [],
    );
  if (!posesAgree(camera.pose, stored?.pose))
    await host.writes.replaceField(
      viewId,
      CANVAS_IDS.canvasPoseField,
      props[CANVAS_IDS.canvasPoseField] ?? [],
    );
  return viewId;
}

/**
 * How the page looks at its canvas (DESIGN.md → Canvas documents → Camera):
 * the camera of the canvas view node it shows the canvas through — the one
 * its route names, else the canvas's own (`canvasViewIdOf`) — and the way to
 * move it. A camera set shows at once and is written once gestures pause,
 * on the view node alone, never the document; the page's last word still
 * goes out when it closes. A canvas that names no canvas view gets one
 * proposed for it the first time its camera is set.
 */
export function useCanvasCamera({ canvasId, viewNode, nodes }: UseCanvasCameraOptions) {
  /** A view node this page proposed, until the canvas names it. */
  const [proposed, setProposed] = useState<string | null>(null);
  const viewId = viewNode ?? canvasViewIdOf(nodes.get(canvasId), (id) => nodes.get(id)) ?? proposed;
  const stored = viewId === null ? undefined : readCanvasCamera(nodes.get(viewId)?.props ?? {});
  /**
   * A camera set here, over the view node's camera as it was then: shown
   * until the view node moves, by this page's write landing or another's.
   */
  const [pending, setPending] = useState<{ camera: CanvasCamera; over: string } | null>(null);
  const storedKey = JSON.stringify(stored ?? null);
  const camera = pending !== null && pending.over === storedKey ? pending.camera : stored;

  const latest = useRef({ canvasId, viewId, stored, next: null as CanvasCamera | null });
  useLayoutEffect(() => {
    latest.current = { ...latest.current, canvasId, viewId, stored };
  });
  /** The proposal in flight: a camera set meanwhile is written onto what it makes. */
  const proposing = useRef<Promise<string | null> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const write = useCallback(() => {
    timer.current = null;
    const { canvasId: canvas, viewId: view, stored: held, next } = latest.current;
    latest.current = { ...latest.current, next: null };
    if (next === null || sameCamera(next, held)) return;
    const inFlight = proposing.current;
    if (view === null && inFlight !== null) {
      void inFlight.then((id) => (id === null ? null : writeCamera(canvas, id, undefined, next)));
      return;
    }
    const written = writeCamera(canvas, view, held, next);
    if (view !== null) return;
    proposing.current = written;
    void written.then((id) => {
      setProposed(id);
      proposing.current = null;
    });
  }, []);

  /** Look through `next`: shown now, written once gestures pause. */
  const setCamera = useCallback(
    (next: CanvasCamera) => {
      latest.current = { ...latest.current, next };
      setPending({ camera: next, over: JSON.stringify(latest.current.stored ?? null) });
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(write, DEBOUNCE_MS);
    },
    [write, setPending],
  );

  useEffect(
    () => () => {
      if (timer.current === null) return;
      clearTimeout(timer.current);
      write();
    },
    [write],
  );

  return { camera, setCamera };
}
