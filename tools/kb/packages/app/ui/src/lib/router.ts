import { useSyncExternalStore } from "react";
import type { OntologyView } from "@kb/views";

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

/**
 * Show `to` in the address bar without a history entry: the URL names the
 * focused pane, and moving the focus to another pane is not a step back can
 * undo.
 */
export function replacePath(to: string): void {
  if (to === getPath()) return;
  window.history.replaceState({}, "", to);
  notify();
}

/** Call `listener` whenever the path changes, by `navigate` or by history; returns the unsubscribe. */
export function subscribePath(listener: Listener): () => void {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

export function usePath(): string {
  return useSyncExternalStore(subscribePath, getPath, () => "/");
}

export function graphPath(perspectiveId?: string | null): string {
  if (perspectiveId !== null && perspectiveId !== undefined) {
    return `/graph/${encodeURIComponent(perspectiveId)}`;
  }
  return "/graph";
}

/**
 * `/node/<id>`: a node in its default view; `/node/<id>/<view>`: the node
 * through one view (a view node it names, or a view type by its option).
 */
export function nodePath(node: string, view?: string): string {
  const base = `/node/${encodeURIComponent(node)}`;
  return view === undefined ? base : `${base}/${encodeURIComponent(view)}`;
}

/** `/o/<id>` (page) · `/o/<id>/outline` · `/o/<id>/graph`. */
export function ontologyPath(id: string, view: OntologyView = "page"): string {
  const base = `/o/${encodeURIComponent(id)}`;
  return view === "page" ? base : `${base}/${view}`;
}
