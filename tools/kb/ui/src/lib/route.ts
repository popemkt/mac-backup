/** Tiny path router — avoids pulling react-router into the outline bundle. */

export type AppRoute =
  | { name: "outline" }
  | { name: "graph"; perspectiveId: string | null };

export function parseRoute(pathname: string): AppRoute {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/graph") return { name: "graph", perspectiveId: null };
  const m = /^\/graph\/([^/]+)$/.exec(path);
  if (m) return { name: "graph", perspectiveId: decodeURIComponent(m[1]!) };
  return { name: "outline" };
}

export function graphPath(perspectiveId?: string | null): string {
  if (perspectiveId) return `/graph/${encodeURIComponent(perspectiveId)}`;
  return "/graph";
}

export function navigate(to: string): void {
  if (window.location.pathname === to) return;
  window.history.pushState({}, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function pathnameSubscribe(cb: () => void): () => void {
  window.addEventListener("popstate", cb);
  return () => window.removeEventListener("popstate", cb);
}

export function getPathname(): string {
  return window.location.pathname;
}
