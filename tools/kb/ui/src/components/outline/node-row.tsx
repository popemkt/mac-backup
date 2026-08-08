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
  return (
    <div
      className={cn(
        "node-row group/node flex items-start",
        "rounded-sm transition-colors duration-75",
        isSelected && !isActive && "bg-primary/5",
        className,
      )}
      style={{
        paddingLeft: `${depth * 24}px`,
        minHeight: "var(--kb-row-h)",
      }}
      data-node-id={nodeId}
      data-instance-key={instanceKey}
      onClick={onRowClick}
    >
      {bullet}
      <div
        className={cn(
          "node-content flex min-h-6 min-w-0 flex-1 items-start gap-1.5 rounded-sm px-1",
          isSelected && !isActive && "bg-primary/8",
        )}
      >
        {content}
      </div>
    </div>
  );
}
