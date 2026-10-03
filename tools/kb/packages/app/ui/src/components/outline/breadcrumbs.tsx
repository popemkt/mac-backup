import { useContext, useMemo } from "react";
import { CaretRightIcon, HouseIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { WORKSPACE_ROOT_ID, type NodeMap } from "@/lib/types";
import { OpenNodeContext } from "@/stores/follow";
import { useOutlineStore } from "@/stores/outline.store";

/** The path from home down to `root`, home left out: a rooted outline's crumbs. */
function pathTo(root: string, nodes: NodeMap): Array<{ id: string; text: string }> {
  const chain: Array<{ id: string; text: string }> = [];
  const seen = new Set<string>();
  let id: string | null = root;
  while (id !== null && id !== WORKSPACE_ROOT_ID && !seen.has(id)) {
    seen.add(id);
    const node = nodes.get(id);
    if (node === undefined) break;
    chain.unshift({ id, text: node.text });
    id = node.parentId;
  }
  return chain;
}

/**
 * Where the outline is: home, then each node down to its root. The zoomed
 * outline's crumbs zoom; a rooted outline's open the crumb in its pane
 * (`OpenNodeContext`).
 */
export function Breadcrumbs({ root }: { readonly root?: string | undefined }) {
  const zoomRoot = useOutlineStore((s) => s.rootNodeId);
  const rootNodeId = root ?? zoomRoot;
  // getBreadcrumbs builds a fresh array; selecting it directly makes the
  // uSES snapshot unstable (infinite rerender). Derive it with useMemo.
  const nodes = useOutlineStore((s) => s.nodes);
  const crumbs = useMemo(
    () => (root === undefined ? useOutlineStore.getState().getBreadcrumbs() : pathTo(root, nodes)),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- getBreadcrumbs is read off getState(), so its real inputs are named here by hand
    [nodes, rootNodeId, root],
  );
  const open = useContext(OpenNodeContext);
  const zoomHomeInStore = useOutlineStore((s) => s.zoomHome);
  const zoomToInStore = useOutlineStore((s) => s.zoomTo);
  const zoomTo = open ?? zoomToInStore;
  const zoomHome = open === null ? zoomHomeInStore : () => open(WORKSPACE_ROOT_ID);
  const isAtRoot = rootNodeId === WORKSPACE_ROOT_ID;

  return (
    <nav className="breadcrumbs flex h-11 items-center gap-1 px-1 text-ui" aria-label="Breadcrumb">
      <button
        type="button"
        className={cn(
          "flex items-center gap-1 rounded-sm px-1.5 py-0.5",
          "text-foreground/40 hover:text-foreground/70 hover:bg-foreground/5",
          "transition-colors duration-100",
          isAtRoot && "text-foreground/70",
        )}
        onClick={() => zoomHome()}
        aria-current={isAtRoot ? "page" : undefined}
      >
        <HouseIcon size={14} weight="bold" />
        <span>Home</span>
      </button>

      {crumbs.map((item) => (
        <div key={item.id} className="flex items-center gap-1">
          <CaretRightIcon size={10} weight="bold" className="text-foreground/25" />
          <button
            type="button"
            title={item.text}
            className={cn(
              "max-w-[12rem] truncate rounded-sm px-1.5 py-0.5",
              "text-foreground/40 hover:text-foreground/70 hover:bg-foreground/5",
              "transition-colors duration-100",
              item.id === rootNodeId && "text-foreground/70 font-medium",
            )}
            onClick={() => zoomTo(item.id)}
            aria-current={item.id === rootNodeId ? "page" : undefined}
          >
            {item.text}
          </button>
        </div>
      ))}
    </nav>
  );
}
