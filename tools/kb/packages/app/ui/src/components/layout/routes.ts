import type { NodeParams } from "@kb/views";

/** `/node/<id>` or `/node/<id>/<view>`: the route a node is opened by (`nodePath`). */
export function matchNode(path: string): NodeParams | null {
  const match = /^\/node\/([^/]+)(?:\/([^/]+))?\/?$/.exec(path);
  const node = match?.[1];
  if (node === undefined) return null;
  const view = match?.[2];
  return view === undefined
    ? { node: decodeURIComponent(node) }
    : { node: decodeURIComponent(node), view: decodeURIComponent(view) };
}
