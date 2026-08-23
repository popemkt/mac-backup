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
  | { name: "graph"; perspectiveId: string | null }
  | { name: "ontology-list" }
  /**
   * Ontology scope lives in the URL so it is linkable, restorable on reload,
   * and survives the back button (r5 §2.6). `view` selects the surface the
   * scope is projected onto.
   */
  | { name: "ontology"; id: string; view: "page" | "outline" | "graph" };

/** Canonical route table — App.tsx and nav consume this only. */
export function matchRoute(path: string): AppRoute {
  if (path === "/canvas" || path === "/canvas/") return { name: "canvas-list" };
  const canvas = path.match(/^\/canvas\/([^/]+)\/?$/);
  if (canvas?.[1]) {
    return { name: "canvas", id: decodeURIComponent(canvas[1]) };
  }
  if (path === "/graph" || path === "/graph/") {
    return { name: "graph", perspectiveId: null };
  }
  const graph = path.match(/^\/graph\/([^/]+)\/?$/);
  if (graph?.[1]) {
    return { name: "graph", perspectiveId: decodeURIComponent(graph[1]) };
  }
  if (path === "/o" || path === "/o/") return { name: "ontology-list" };
  const onto = path.match(/^\/o\/([^/]+)(?:\/(outline|graph))?\/?$/);
  if (onto?.[1]) {
    return {
      name: "ontology",
      id: decodeURIComponent(onto[1]),
      view: onto[2] === "graph" ? "graph" : onto[2] === "outline" ? "outline" : "page",
    };
  }
  return { name: "outline" };
}

export function graphPath(perspectiveId?: string | null): string {
  if (perspectiveId) return `/graph/${encodeURIComponent(perspectiveId)}`;
  return "/graph";
}

export type OntologyView = "page" | "outline" | "graph";

/** `/o/<id>` (page) · `/o/<id>/outline` · `/o/<id>/graph`. */
export function ontologyPath(id: string, view: OntologyView = "page"): string {
  const base = `/o/${encodeURIComponent(id)}`;
  return view === "page" ? base : `${base}/${view}`;
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
