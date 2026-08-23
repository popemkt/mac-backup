import { cn } from "@/lib/cn";

export interface NodeRowProps {
  depth: number;
  isSelected?: boolean;
  isActive?: boolean;
  onRowClick?: (e: React.MouseEvent) => void;
  bullet: React.ReactNode;
  /** Full node-content area (text + optional trailing chips). */
  content: React.ReactNode;
  className?: string;
  nodeId?: string;
  /** Render-instance key when the same nodeId appears more than once. */
  instanceKey?: string;
}

/** DESIGN-RESKIN §1.3 — the one node row everywhere. */
export function NodeRow({
  depth,
  isSelected = false,
  isActive = false,
  onRowClick,
  bullet,
  content,
  className,
  nodeId,
  instanceKey,
}: NodeRowProps) {
  const interactive = Boolean(onRowClick);
  return (
    <div
      className={cn(
        "node-row group/node flex items-start",
        "rounded-sm transition-colors duration-75",
        isSelected && !isActive && "bg-primary/5",
        interactive &&
          "outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        className,
      )}
      style={{
        paddingLeft: `${depth * 24}px`,
        minHeight: "var(--kb-row-h)",
      }}
      data-node-id={nodeId}
      data-instance-key={instanceKey}
      data-node-row="true"
      data-selected={isSelected ? "true" : undefined}
      data-active={isActive ? "true" : undefined}
      role={interactive ? "treeitem" : undefined}
      aria-selected={interactive ? isSelected || isActive : undefined}
      tabIndex={interactive ? (isSelected || isActive ? 0 : -1) : undefined}
      onClick={onRowClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                // Don't steal keys from nested editors / buttons.
                const t = e.target as HTMLElement | null;
                if (
                  t &&
                  (t.isContentEditable ||
                    t.tagName === "INPUT" ||
                    t.tagName === "TEXTAREA" ||
                    t.tagName === "BUTTON" ||
                    t.closest("button,[contenteditable='true'],input,textarea"))
                ) {
                  return;
                }
                e.preventDefault();
                onRowClick?.(e as unknown as React.MouseEvent);
              }
            }
          : undefined
      }
    >
      {bullet}
      <div
        className={cn(
          "node-content flex min-h-6 min-w-0 flex-1 items-start gap-1.5 rounded-sm px-1",
          isSelected && !isActive && "bg-primary/8",
          isActive && "ring-1 ring-primary/25",
        )}
      >
        {content}
      </div>
    </div>
  );
}
