import { useSyncExternalStore } from "react";

/** Tiny path router — no react-router dependency. */

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) l();
}

export function getPath(): string {
  return window.location.pathname || "/";
}

export function navigate(to: string): void {
  if (to === getPath()) return;
  window.history.pushState({}, "", to);
  notify();
}

export function usePath(): string {
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      const onPop = () => onStoreChange();
      window.addEventListener("popstate", onPop);
      return () => {
        listeners.delete(onStoreChange);
        window.removeEventListener("popstate", onPop);
      };
    },
    getPath,
    () => "/",
  );
}

/** Match `/canvas/:id` → id, or null. */
export function matchCanvasId(path: string): string | null {
  const m = path.match(/^\/canvas\/([^/]+)\/?$/);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

export function isCanvasList(path: string): boolean {
  return path === "/canvas" || path === "/canvas/";
}
