import { useMemo } from "react";
import { CaretRight, House } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { WORKSPACE_ROOT_ID } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";

export function Breadcrumbs() {
  const rootNodeId = useOutlineStore((s) => s.rootNodeId);
  // getBreadcrumbs builds a fresh array; selecting it directly makes the
  // uSES snapshot unstable (infinite rerender). Derive it with useMemo.
  const nodes = useOutlineStore((s) => s.nodes);
  const crumbs = useMemo(
    () => useOutlineStore.getState().getBreadcrumbs(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes, rootNodeId],
  );
  const zoomHome = useOutlineStore((s) => s.zoomHome);
  const zoomTo = useOutlineStore((s) => s.zoomTo);
  const isAtRoot = rootNodeId === WORKSPACE_ROOT_ID;

  return (
    <nav className="breadcrumbs flex items-center gap-1 px-1 py-2 text-[13px]">
      <button
        type="button"
        className={cn(
          "flex items-center gap-1 rounded-sm px-1.5 py-0.5",
          "text-stone-500 hover:text-stone-800 hover:bg-stone-900/5",
          "transition-colors duration-100",
          isAtRoot && "text-stone-700",
        )}
        onClick={() => zoomHome()}
      >
        <House size={14} weight="bold" />
        <span>Home</span>
      </button>

      {crumbs.map((item) => (
        <div key={item.id} className="flex items-center gap-1">
          <CaretRight size={10} weight="bold" className="text-stone-300" />
          <button
            type="button"
            className={cn(
              "rounded-sm px-1.5 py-0.5",
              "text-stone-500 hover:text-stone-800 hover:bg-stone-900/5",
              "transition-colors duration-100",
              item.id === rootNodeId && "text-stone-800 font-medium",
            )}
            onClick={() => zoomTo(item.id)}
          >
            {item.text}
          </button>
        </div>
      ))}
    </nav>
  );
}
