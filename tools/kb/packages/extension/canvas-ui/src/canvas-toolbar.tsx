import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CaretRightIcon,
  CircleIcon,
  CubeIcon,
  CursorIcon,
  CylinderIcon,
  DiamondIcon,
  FrameCornersIcon,
  ImageIcon,
  PlusIcon,
  RowsIcon,
  SphereIcon,
  SquareIcon,
  SquareHalfIcon,
  TagIcon,
  TextTIcon,
  TriangleIcon,
  WallIcon,
} from "@phosphor-icons/react";
import { CANVAS_SOLID_PRESETS, type CanvasProjectionKind } from "@kb/canvas";
import { isSolidTool, solidOf, type CanvasTool, type ToolState } from "./canvas-tool";
import { cn, isOutside } from "@kb/ui-sdk";
import { CANVAS_PROJECTIONS } from "./canvas-projections";

/** Every tool's name and mark: tsc asks for one per preset, so a new preset cannot go unnamed. */
const TOOL_LOOKS: {
  readonly [T in CanvasTool]: { readonly label: string; readonly icon: ReactNode };
} = {
  select: { label: "Select (V)", icon: <CursorIcon size={16} /> },
  text: { label: "Text (T)", icon: <TextTIcon size={16} /> },
  label: { label: "Label: faces you in 3D", icon: <TagIcon size={16} /> },
  rect: { label: "Rectangle (R)", icon: <SquareIcon size={16} /> },
  ellipse: { label: "Ellipse (O)", icon: <CircleIcon size={16} /> },
  diamond: { label: "Diamond (D)", icon: <DiamondIcon size={16} /> },
  group: { label: "Group / Frame (F)", icon: <FrameCornersIcon size={16} /> },
  "kb-node": { label: "Add kb node (N)", icon: <PlusIcon size={16} /> },
  image: { label: "Image (or paste or drop one)", icon: <ImageIcon size={16} /> },
  box: { label: "Box", icon: <CubeIcon size={16} /> },
  pillar: { label: "Pillar", icon: <CylinderIcon size={16} /> },
  sphere: { label: "Sphere", icon: <SphereIcon size={16} /> },
  cone: { label: "Cone", icon: <TriangleIcon size={16} /> },
  slab: { label: "Shelf", icon: <RowsIcon size={16} /> },
  wall: { label: "Wall", icon: <WallIcon size={16} /> },
};

/** The flat tools, in the strip's order; the solids sit behind one button after them. */
const FLAT_TOOLS: readonly CanvasTool[] = [
  "select",
  "text",
  "label",
  "rect",
  "ellipse",
  "diamond",
  "group",
  "kb-node",
  "image",
];

/** Each projection's mark on the toggle. */
const PROJECTION_ICONS: Record<CanvasProjectionKind, ReactNode> = {
  "2d": <SquareHalfIcon size={16} />,
  "3d": <CubeIcon size={16} />,
};

interface CanvasToolbarProps {
  projection: CanvasProjectionKind;
  onProjectionChange: (projection: CanvasProjectionKind) => void;
  toolState: ToolState;
  onToolChange: (tool: CanvasTool) => void;
  onToolDoubleClick: (tool: CanvasTool) => void;
}

const BUTTON = cn(
  "relative flex h-8 w-8 items-center justify-center rounded-md text-foreground/55 transition-colors",
  "hover:bg-foreground/5 hover:text-foreground/80",
);

function ToolButton({
  tool,
  active,
  sticky,
  onClick,
  onDoubleClick,
  children,
}: {
  tool: CanvasTool;
  active: boolean;
  sticky: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  children?: ReactNode;
}) {
  const { label, icon } = TOOL_LOOKS[tool];
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      data-tool={tool}
      className={cn(BUTTON, active && "bg-foreground/8 text-foreground/90")}
      onClick={onClick}
      onDoubleClick={(e) => {
        e.preventDefault();
        onDoubleClick();
      }}
    >
      {icon}
      {active && sticky && (
        <span className="absolute right-0.5 bottom-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
      )}
      {children}
    </button>
  );
}

/**
 * The solid tool (B): one button wearing the solid last picked, which a click
 * picks again and opens the picker beside it — box, pillar, sphere, cone,
 * shelf, wall — as tldraw's geo tool does.
 */
function SolidTool({
  toolState,
  onToolChange,
  onToolDoubleClick,
}: Pick<CanvasToolbarProps, "toolState" | "onToolChange" | "onToolDoubleClick">) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const solid = solidOf(toolState);
  const active = isSolidTool(toolState.tool);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (isOutside(ref.current, e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <ToolButton
        tool={solid}
        active={active}
        sticky={toolState.sticky === true}
        onClick={() => {
          onToolChange(solid);
          setOpen((was) => !was);
        }}
        onDoubleClick={() => onToolDoubleClick(solid)}
      >
        <CaretRightIcon
          size={7}
          weight="bold"
          className="absolute right-0 bottom-0.5 text-foreground/35"
        />
      </ToolButton>
      {open && (
        <div
          role="menu"
          aria-label="Solids"
          data-testid="canvas-solid-picker"
          className="absolute top-0 left-full ml-2 flex flex-col gap-0.5 rounded-lg border border-foreground/10 bg-popover/95 p-1 shadow-floating backdrop-blur-sm"
        >
          {CANVAS_SOLID_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              role="menuitemradio"
              aria-checked={preset === solid}
              data-tool={preset}
              className={cn(
                "flex h-8 items-center gap-2 rounded-md pr-3 pl-2 text-ui text-foreground/65 transition-colors",
                "hover:bg-foreground/5 hover:text-foreground/90",
                preset === solid && "bg-foreground/8 text-foreground/90",
              )}
              onClick={() => {
                onToolChange(preset);
                setOpen(false);
              }}
            >
              {TOOL_LOOKS[preset].icon}
              {TOOL_LOOKS[preset].label}
            </button>
          ))}
          <div className="px-2 pt-1 pb-0.5 text-label text-foreground/35">B picks the last one</div>
        </div>
      )}
    </div>
  );
}

export function CanvasToolbar({
  projection,
  onProjectionChange,
  toolState,
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
      {FLAT_TOOLS.map((tool) => (
        <ToolButton
          key={tool}
          tool={tool}
          active={toolState.tool === tool}
          sticky={toolState.sticky === true}
          onClick={() => onToolChange(tool)}
          onDoubleClick={() => onToolDoubleClick(tool)}
        />
      ))}
      <SolidTool
        toolState={toolState}
        onToolChange={onToolChange}
        onToolDoubleClick={onToolDoubleClick}
      />
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
