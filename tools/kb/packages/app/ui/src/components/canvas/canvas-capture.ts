/**
 * A canvas drawn as a picture for an agent (`ui.capture`; plan 2026-10-02,
 * decision 16): its 3D scene draws what a camera would see from a view
 * without the person's camera moving (`picture`), and the tab answers the
 * capture with the PNG. 2D is that scene's top view, so a canvas showing 2D
 * starts its scene, unseen, for as long as the picture takes.
 */
import { useCallback, useRef } from "react";
import { screenRejected, type ScreenAck } from "@kb/contracts";
import type { CanvasView } from "./canvas-camera";

/** A picture a canvas's scene drew: a PNG, and its size in pixels. */
interface CanvasPicture {
  readonly png: Blob;
  readonly width: number;
  readonly height: number;
}

/** What draws a canvas as a picture: its mounted 3D scene. */
export interface CanvasPainter {
  /** What `view` sees, drawn once and never shown; null when the canvas gave no picture. */
  picture(view: CanvasView): Promise<CanvasPicture | null>;
}

/** How long a capture waits for a scene it started to draw its first frame, ms. */
const SCENE_WAIT_MS = 8000;

/** Bytes as base64, in chunks a call's arguments can hold. */
function base64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let text = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    text += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(text);
}

/** `painter`'s picture of `view` as the tab's answer to a capture. */
async function pictureOf(painter: CanvasPainter, view: CanvasView): Promise<ScreenAck> {
  const drawn = await painter.picture(view);
  if (drawn === null) return screenRejected("the canvas drew no picture");
  const data = base64(new Uint8Array(await drawn.png.arrayBuffer()));
  return {
    outcome: "applied",
    picture: { mime: "image/png", data, width: drawn.width, height: drawn.height },
  };
}

/**
 * The page's side of a capture: `onPainter` takes the scene as it mounts and
 * goes, and `capture` draws a view through it — holding the scene mounted
 * meanwhile (`hold`, which a canvas showing 2D needs to start one).
 */
export function useCanvasCapture(hold: () => () => void) {
  const painter = useRef<CanvasPainter | null>(null);
  const waiting = useRef(new Set<(painter: CanvasPainter) => void>());

  const onPainter = useCallback((next: CanvasPainter | null) => {
    painter.current = next;
    if (next === null) return;
    for (const resume of waiting.current) resume(next);
    waiting.current.clear();
  }, []);

  const mounted = (): Promise<CanvasPainter | null> => {
    if (painter.current !== null) return Promise.resolve(painter.current);
    return new Promise((resolve) => {
      const resume = (ready: CanvasPainter) => {
        clearTimeout(timer);
        resolve(ready);
      };
      const timer = setTimeout(() => {
        waiting.current.delete(resume);
        resolve(null);
      }, SCENE_WAIT_MS);
      waiting.current.add(resume);
    });
  };

  const capture = async (view: CanvasView): Promise<ScreenAck> => {
    const release = hold();
    try {
      const ready = await mounted();
      if (ready === null) return screenRejected("the canvas's 3D scene did not start in time");
      return await pictureOf(ready, view);
    } finally {
      release();
    }
  };

  return { onPainter, capture };
}
