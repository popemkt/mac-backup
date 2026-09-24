import { useSyncExternalStore } from "react";

/**
 * Tiny path router — no react-router dependency. Which page owns a path is
 * not written here: each surface plugin matches its own (`lib/plugins`), and
 * this module only tracks the path and builds the links other views share.
 */

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

export function graphPath(perspectiveId?: string | null): string {
  if (perspectiveId !== null && perspectiveId !== undefined) {
    return `/graph/${encodeURIComponent(perspectiveId)}`;
  }
  return "/graph";
}

export type OntologyView = "page" | "outline" | "graph";

/** `/o/<id>` (page) · `/o/<id>/outline` · `/o/<id>/graph`. */
export function ontologyPath(id: string, view: OntologyView = "page"): string {
  const base = `/o/${encodeURIComponent(id)}`;
  return view === "page" ? base : `${base}/${view}`;
}
