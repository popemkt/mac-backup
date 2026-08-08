import { useSyncExternalStore } from "react";

/** Tiny path router — no react-router dependency. Single route table. */

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

export type AppRoute =
  | { name: "outline" }
  | { name: "canvas-list" }
  | { name: "canvas"; id: string }
  | { name: "graph" };

/** Canonical route table — App.tsx and nav consume this only. */
export function matchRoute(path: string): AppRoute {
  if (path === "/canvas" || path === "/canvas/") return { name: "canvas-list" };
  const canvas = path.match(/^\/canvas\/([^/]+)\/?$/);
  if (canvas?.[1]) {
    return { name: "canvas", id: decodeURIComponent(canvas[1]) };
  }
  if (path === "/graph" || path === "/graph/") return { name: "graph" };
  return { name: "outline" };
}

/** @deprecated use matchRoute */
export function matchCanvasId(path: string): string | null {
  const r = matchRoute(path);
  return r.name === "canvas" ? r.id : null;
}

/** @deprecated use matchRoute */
export function isCanvasList(path: string): boolean {
  return matchRoute(path).name === "canvas-list";
}
