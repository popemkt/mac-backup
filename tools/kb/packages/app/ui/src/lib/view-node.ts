/**
 * A view node, read against the views provided. The model is `@kb/model`'s
 * `view-node.ts` (DESIGN.md → Kinds, roles and options → View nodes): the
 * node's `sys.f.view` names an option, the key whose `option` it is names the
 * view, and the node's props are that view's params for a host
 * (`paramsFromProps`).
 */
import { viewOptionOf, type NodeProps } from "@kb/model";
import type { ViewKey } from "@/lib/view-key";

/** The key among `keys` that the view node names, or null when it names none of them. */
export function viewKeyOfNode<K extends ViewKey<unknown>>(
  node: { readonly props: NodeProps } | undefined,
  keys: readonly K[],
): K | null {
  const option = viewOptionOf(node);
  return option === null ? null : (keys.find((key) => key.option === option) ?? null);
}
