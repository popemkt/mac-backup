import type { ReactNode } from "react";
import {
  CircleIcon,
  CubeIcon,
  CursorIcon,
  DiamondIcon,
  FrameCornersIcon,
  PlusIcon,
  SquareIcon,
  SquareHalfIcon,
  TextTIcon,
} from "@phosphor-icons/react";
import type { CanvasProjectionKind } from "@kb/canvas";
import type { CanvasTool } from "@/lib/canvas-tool";
import { cn } from "@/lib/cn";
import { CANVAS_PROJECTIONS } from "./canvas-projections";

const TOOLS: {
  id: CanvasTool;
  label: string;
  icon: ReactNode;
}[] = [
  { id: "select", label: "Select (V)", icon: <CursorIcon size={16} /> },
  { id: "text", label: "Text (T)", icon: <TextTIcon size={16} /> },
  { id: "rect", label: "Rectangle (R)", icon: <SquareIcon size={16} /> },
  { id: "ellipse", label: "Ellipse (O)", icon: <CircleIcon size={16} /> },
  { id: "diamond", label: "Diamond (D)", icon: <DiamondIcon size={16} /> },
  { id: "group", label: "Group / Frame (G)", icon: <FrameCornersIcon size={16} /> },
  { id: "kb-node", label: "Add kb node (N)", icon: <PlusIcon size={16} /> },
];

/** Each projection's mark on the toggle. */
const PROJECTION_ICONS: Record<CanvasProjectionKind, ReactNode> = {
  "2d": <SquareHalfIcon size={16} />,
  "3d": <CubeIcon size={16} />,
};

interface CanvasToolbarProps {
  projection: CanvasProjectionKind;
  onProjectionChange: (projection: CanvasProjectionKind) => void;
  tool: CanvasTool;
  sticky?: boolean;
  onToolChange: (tool: CanvasTool) => void;
  onToolDoubleClick: (tool: CanvasTool) => void;
}

const BUTTON = cn(
  "relative flex h-8 w-8 items-center justify-center rounded-md text-foreground/55 transition-colors",
  "hover:bg-foreground/5 hover:text-foreground/80",
);

export function CanvasToolbar({
  projection,
  onProjectionChange,
  tool,
  sticky,
  onToolChange,
  onToolDoubleClick,
}: CanvasToolbarProps) {
  return (
    <div
      className="absolute top-1/2 left-2 z-20 flex -translate-y-1/2 flex-col gap-0.5 rounded-lg border border-foreground/10 bg-popover/95 p-1 shadow-floating backdrop-blur-sm"
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
          className={cn(BUTTON, tool === t.id && "bg-foreground/8 text-foreground/90")}
          onClick={() => onToolChange(t.id)}
          onDoubleClick={(e) => {
            e.preventDefault();
            onToolDoubleClick(t.id);
          }}
        >
          {t.icon}
          {tool === t.id && sticky === true && (
            <span className="absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
          )}
        </button>
      ))}
      <div className="mx-1.5 my-1 h-px bg-foreground/10" role="separator" />
      <div role="group" aria-label="Projection" className="flex flex-col gap-0.5">
        {CANVAS_PROJECTIONS.map((p) => (
          <button
            key={p.kind}
            type="button"
            title={`${p.label}: ${p.title}`}
            aria-label={`${p.label} projection`}
            aria-pressed={projection === p.kind}
            data-projection={p.kind}
            className={cn(BUTTON, projection === p.kind && "bg-primary/12 text-primary")}
            onClick={() => onProjectionChange(p.kind)}
          >
            {PROJECTION_ICONS[p.kind]}
          </button>
        ))}
      </div>
    </div>
  );
}
