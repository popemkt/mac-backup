import { useEffect, useRef } from "react";
import { logWarn, useReducedMotion } from "@kb/ui-sdk";
import { createUnicornScene, type UnicornScene } from "@/lib/unicorn-scene";

/** Decorative scene: no hit targets, and no animation while hidden or reduced. */
export function UnicornBackdrop({ opacity }: { opacity: number }) {
  const host = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const element = host.current;
    if (!element) return undefined;
    const controller = new AbortController();
    let disposed = false;
    let visible = true;
    let scene: UnicornScene | null = null;
    const updatePlayback = () => {
      if (scene) scene.paused = reducedMotion || document.hidden || !visible;
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting === true;
      updatePlayback();
    });
    observer.observe(element);
    document.addEventListener("visibilitychange", updatePlayback);
    void createUnicornScene(element, controller.signal)
      .then((ready) => {
        if (disposed) {
          ready.destroy();
          return;
        }
        scene = ready;
        updatePlayback();
        element.dataset.sceneState = "ready";
      })
      .catch((error: unknown) => {
        if (disposed) return;
        element.dataset.sceneState = "unavailable";
        logWarn("header backdrop", error);
      });
    return () => {
      disposed = true;
      controller.abort();
      observer.disconnect();
      document.removeEventListener("visibilitychange", updatePlayback);
      scene?.destroy();
    };
  }, [reducedMotion]);

  return (
    <div
      ref={host}
      className="kb-unicorn-backdrop"
      style={{ opacity }}
      data-scene-state="loading"
    />
  );
}
