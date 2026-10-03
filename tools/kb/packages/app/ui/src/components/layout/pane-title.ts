import { Predicate } from "effect";
import { viewLabelOf } from "@kb/views";
import { RoutePoint, matchRoute, useContributions } from "@/lib/plugins";
import { WORKSPACE_ROOT_ID } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";

/** The params a page names its subject by, in the order a title prefers them. */
const SUBJECT_KEYS = ["node", "perspective", "id", "root", "view"] as const;

/**
 * What a pane at `path` is called: the node its page is shown for, by its
 * text, else the page's view by the label the seed names it. Read off the
 * route the path resolves to, so a page names itself the same way wherever it
 * is open.
 */
export function usePaneTitle(path: string): string {
  const route = matchRoute(useContributions(RoutePoint), path);
  const subject = route === null ? undefined : subjectOf(route.params);
  const text = useOutlineStore((s) => {
    const id = subject ?? (path === "/" ? s.rootNodeId : undefined);
    if (id === undefined) return undefined;
    if (id === WORKSPACE_ROOT_ID) return "Home";
    const node = s.nodes.get(id);
    return node === undefined ? undefined : node.text.trim();
  });
  if (route === null) return "Not found";
  return text !== undefined && text !== "" ? text : viewLabelOf(route.view);
}

function subjectOf(params: unknown): string | undefined {
  if (!Predicate.isObject(params)) return undefined;
  for (const key of SUBJECT_KEYS) {
    const value = params[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
}
