import { useEffect, useRef } from "react";
import { logWarn, useReducedMotion, type BackdropProps } from "@kb/ui-sdk";
import { watchPlayback } from "./playback";
import { TintBackdrop } from "./tint-backdrop";
import { createUnicornScene, type UnicornScene } from "./unicorn-scene";

/** Decorative scene: no hit targets, and no animation while hidden or reduced. */
function UnicornBackdrop({ opacity }: { opacity: number }) {
  const host = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const element = host.current;
    if (!element) return undefined;
    const controller = new AbortController();
    let disposed = false;
    let scene: UnicornScene | null = null;
    const watch = watchPlayback(element, reducedMotion, (playing) => {
      if (scene) scene.paused = !playing;
    });
    void createUnicornScene(element, controller.signal)
      .then((ready) => {
        if (disposed) {
          ready.destroy();
          return;
        }
        scene = ready;
        scene.paused = !watch.playing();
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
      watch.dispose();
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

/** The unicorn backdrop: the scene over the wash. */
export function UnicornWashBackdrop({ color, opacity }: BackdropProps) {
  return (
    <>
      <TintBackdrop color={color} opacity={opacity} />
      <UnicornBackdrop opacity={opacity} />
    </>
  );
}
