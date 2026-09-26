/**
 * The scene host: the one interface every real-time 3D view meets, and the
 * one mechanism that keeps a mounted scene in step with the element it draws
 * into (Lab principle P4). A lab study and the 3D graph are two
 * implementations of `SceneHandle`; each surface wraps `attachScene` in its
 * own thin React host, and nothing here knows React (D-8).
 *
 * `attachScene` owns what every host must get right the same way:
 *
 * - a scene that finishes mounting after its element has gone is disposed at
 *   once, so an in-flight mount never leaks a renderer;
 * - the scene is sized to its element on arrival and on every resize;
 * - it runs only while the tab is visible (P3: a hidden tab draws nothing);
 * - detaching disposes it: every GPU resource, loop, worker and listener.
 *
 * `host.test.ts` proves these over a stand-in scene.
 */
import type { SceneBackend } from "@/scene/backend";

/** A mounted scene, as a host drives it. */
export interface SceneHandle {
  readonly backend: SceneBackend;
  /** CSS pixels; the stage clamps the device pixel ratio itself. */
  resize(width: number, height: number): void;
  /** Off while the tab is hidden: no frames are drawn. */
  setRunning(running: boolean): void;
  /** Under reduced motion no animation loop runs (M7). */
  setReducedMotion(reduced: boolean): void;
  /** Release every GPU resource, loop, worker and listener the scene took. */
  dispose(): void;
}

export interface SceneEvents<H extends SceneHandle> {
  /** The scene is mounted, sized and running (while visible). */
  readonly onReady: (handle: H) => void;
  /** The scene could not start; nothing of it is left live. */
  readonly onError: (error: Error) => void;
}

function visible(): boolean {
  return document.visibilityState !== "hidden";
}

/**
 * Keep the scene `pending` is mounting into `el` in step with it until the
 * returned detach is called; detaching disposes the scene, or the scene that
 * arrives later.
 */
export function attachScene<H extends SceneHandle>(
  el: HTMLElement,
  pending: Promise<H>,
  events: SceneEvents<H>,
): () => void {
  let gone = false;
  let mounted: H | null = null;
  pending
    .then((handle) => {
      if (gone) {
        handle.dispose();
        return undefined;
      }
      mounted = handle;
      handle.resize(el.clientWidth, el.clientHeight);
      handle.setRunning(visible());
      events.onReady(handle);
      return undefined;
    })
    .catch((error: unknown) => {
      if (!gone) events.onError(error instanceof Error ? error : new Error(String(error)));
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
    mounted = null;
  };
}
