import { cn } from "@/lib/cn";

interface BulletProps {
  hasChildren: boolean;
  collapsed: boolean;
  childCount: number;
  onClick: (e: React.MouseEvent) => void;
}

export function Bullet({
  hasChildren,
  collapsed,
  childCount,
  onClick,
}: BulletProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "bullet-container group/bullet relative flex shrink-0 items-center justify-center",
        "w-6 h-6 rounded-sm",
        "hover:bg-stone-900/5 transition-colors duration-100",
        "cursor-pointer",
      )}
      tabIndex={-1}
      title={
        hasChildren
          ? "Click to toggle, Cmd+click to focus"
          : "Cmd+click to focus"
      }
      aria-label={
        hasChildren
          ? collapsed
            ? `Expand (${childCount} children)`
            : "Collapse"
          : undefined
      }
    >
      {hasChildren && collapsed && (
        <span className="absolute inset-[3px] rounded-full bg-stone-900/8" />
      )}

      <span
        className={cn(
          "block rounded-full transition-all duration-100",
          hasChildren ? "h-[5px] w-[5px]" : "h-[4px] w-[4px]",
          "bg-stone-900/40",
          hasChildren && "bg-stone-900/50",
          hasChildren &&
            !collapsed &&
            "group-hover/bullet:bg-stone-900/60",
        )}
      />

      {hasChildren && collapsed && childCount > 0 && (
        <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-stone-900/10 px-0.5 text-[9px] font-medium text-stone-600">
          {childCount}
        </span>
      )}
    </button>
  );
}
