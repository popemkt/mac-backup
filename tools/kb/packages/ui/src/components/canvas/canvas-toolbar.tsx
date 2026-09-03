import type { ReactNode } from "react";
import { Circle, Cursor, Diamond, FrameCorners, Plus, Square, TextT } from "@phosphor-icons/react";
import type { CanvasTool } from "@/lib/canvas-tool";
import { cn } from "@/lib/cn";

const TOOLS: {
  id: CanvasTool;
  label: string;
  icon: ReactNode;
}[] = [
  { id: "select", label: "Select (V)", icon: <Cursor size={16} /> },
  { id: "text", label: "Text (T)", icon: <TextT size={16} /> },
  { id: "rect", label: "Rectangle (R)", icon: <Square size={16} /> },
  { id: "ellipse", label: "Ellipse (O)", icon: <Circle size={16} /> },
  { id: "diamond", label: "Diamond (D)", icon: <Diamond size={16} /> },
  { id: "group", label: "Group / Frame (G)", icon: <FrameCorners size={16} /> },
  { id: "kb-node", label: "Add kb node (N)", icon: <Plus size={16} /> },
];

interface CanvasToolbarProps {
  tool: CanvasTool;
  sticky?: boolean;
  onToolChange: (tool: CanvasTool) => void;
  onToolDoubleClick: (tool: CanvasTool) => void;
}

export function CanvasToolbar({
  tool,
  sticky,
  onToolChange,
  onToolDoubleClick,
}: CanvasToolbarProps) {
  return (
    <div
      className="absolute top-1/2 left-2 z-20 flex -translate-y-1/2 flex-col gap-0.5 rounded-lg border border-foreground/10 bg-popover/95 p-1 shadow-lg backdrop-blur-sm"
      data-testid="canvas-toolbar"
      role="toolbar"
      aria-label="Canvas tools"
    >
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          title={t.label}
          aria-label={t.label}
          aria-pressed={tool === t.id}
          className={cn(
            "relative flex h-8 w-8 items-center justify-center rounded-md text-foreground/55 transition-colors",
            "hover:bg-foreground/5 hover:text-foreground/80",
            tool === t.id && "bg-foreground/8 text-foreground/90",
          )}
          onClick={() => onToolChange(t.id)}
          onDoubleClick={(e) => {
            e.preventDefault();
            onToolDoubleClick(t.id);
          }}
        >
          {t.icon}
          {tool === t.id && sticky && (
            <span className="absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
          )}
        </button>
      ))}
    </div>
  );
}
