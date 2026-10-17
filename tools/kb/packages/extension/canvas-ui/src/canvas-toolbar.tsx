import { useRef, useState, type ReactNode, type Ref } from "react";
import {
  ArrowUpRightIcon,
  ArrowFatDownIcon,
  ArrowFatLeftIcon,
  ArrowFatRightIcon,
  ArrowFatUpIcon,
  CaretRightIcon,
  ChatCircleIcon,
  CheckSquareIcon,
  CloudIcon,
  CircleIcon,
  CubeIcon,
  CursorIcon,
  CylinderIcon,
  DiamondIcon,
  FrameCornersIcon,
  HandIcon,
  HexagonIcon,
  ImageIcon,
  LineSegmentIcon,
  PlusIcon,
  RowsIcon,
  SphereIcon,
  SquareIcon,
  SquareHalfIcon,
  StarIcon,
  TagIcon,
  TextTIcon,
  TriangleIcon,
  WallIcon,
} from "@phosphor-icons/react";
import type { CanvasProjectionKind } from "@kb/canvas";
import {
  TOOL_FAMILIES,
  familyOf,
  lastOf,
  type CanvasTool,
  type CanvasToolFamily,
  type ToolState,
} from "./canvas-tool";
import { cn, useDismiss } from "@kb/ui-sdk";
import { CANVAS_PROJECTIONS } from "./canvas-projections";
import { shortcutHint } from "./canvas-keymap";

/**
 * Every tool's name and mark: tsc asks for one per preset, so a new preset
 * cannot go unnamed. Its key is the shortcut table's (`shortcutHint`).
 */
const TOOL_LOOKS: {
  readonly [T in CanvasTool]: { readonly label: string; readonly icon: ReactNode };
} = {
  select: { label: "Select", icon: <CursorIcon size={16} /> },
  hand: { label: "Hand: a press pans", icon: <HandIcon size={16} /> },
  comment: { label: "Comment: on an item, or at a point", icon: <ChatCircleIcon size={16} /> },
  text: { label: "Text", icon: <TextTIcon size={16} /> },
  label: { label: "Label: faces you in 3D", icon: <TagIcon size={16} /> },
  rect: { label: "Rectangle", icon: <SquareIcon size={16} /> },
  ellipse: { label: "Ellipse", icon: <CircleIcon size={16} /> },
  diamond: { label: "Diamond", icon: <DiamondIcon size={16} /> },
  triangle: { label: "Triangle", icon: <TriangleIcon size={16} /> },
  hexagon: { label: "Hexagon", icon: <HexagonIcon size={16} /> },
  star: { label: "Star", icon: <StarIcon size={16} /> },
  cloud: { label: "Cloud", icon: <CloudIcon size={16} /> },
  "arrow-left": { label: "Arrow left", icon: <ArrowFatLeftIcon size={16} /> },
  "arrow-right": { label: "Arrow right", icon: <ArrowFatRightIcon size={16} /> },
  "arrow-up": { label: "Arrow up", icon: <ArrowFatUpIcon size={16} /> },
  "arrow-down": { label: "Arrow down", icon: <ArrowFatDownIcon size={16} /> },
  "check-box": { label: "Check box", icon: <CheckSquareIcon size={16} /> },
  line: { label: "Line", icon: <LineSegmentIcon size={16} /> },
  arrow: { label: "Arrow", icon: <ArrowUpRightIcon size={16} /> },
  group: { label: "Group / Frame", icon: <FrameCornersIcon size={16} /> },
  "kb-node": { label: "Add kb node", icon: <PlusIcon size={16} /> },
  image: { label: "Image (or paste or drop one)", icon: <ImageIcon size={16} /> },
  box: { label: "Box", icon: <CubeIcon size={16} /> },
  pillar: { label: "Pillar", icon: <CylinderIcon size={16} /> },
  sphere: { label: "Sphere", icon: <SphereIcon size={16} /> },
  cone: { label: "Cone", icon: <TriangleIcon size={16} /> },
  slab: { label: "Shelf", icon: <RowsIcon size={16} /> },
  wall: { label: "Wall", icon: <WallIcon size={16} /> },
};

/** The tools that stand alone, in the strip's order; the shapes and the solids each sit behind one button after them. */
const FLAT_TOOLS: readonly CanvasTool[] = [
  "select",
  "hand",
  "text",
  "label",
  "line",
  "arrow",
  "group",
  "kb-node",
  "image",
  "comment",
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

/** A tool's name, with the key that picks it when it has one. */
function toolLabel(tool: CanvasTool): string {
  const hint = shortcutHint({ type: "tool", tool });
  return hint === "" ? TOOL_LOOKS[tool].label : `${TOOL_LOOKS[tool].label} (${hint})`;
}

function ToolButton({
  ref,
  tool,
  active,
  sticky,
  onClick,
  onDoubleClick,
  children,
}: {
  ref?: Ref<HTMLButtonElement>;
  tool: CanvasTool;
  active: boolean;
  sticky: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  children?: ReactNode;
}) {
  const { icon } = TOOL_LOOKS[tool];
  const label = toolLabel(tool);
  return (
    <button
      ref={ref}
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

/** What each family's picker is called. */
const FAMILY_LOOKS: { readonly [F in CanvasToolFamily]: { readonly label: string } } = {
  shape: { label: "Shapes" },
  solid: { label: "Solids" },
};

/**
 * A family's tool (`TOOL_FAMILIES`): one button wearing the tool last
 * picked, which a click picks again and opens the picker beside it with
 * every tool of the family — the solids' box, pillar, sphere, cone, shelf
 * and wall — as tldraw's geo tool does.
 */
function FamilyTool({
  family,
  toolState,
  onToolChange,
  onToolDoubleClick,
}: Pick<CanvasToolbarProps, "toolState" | "onToolChange" | "onToolDoubleClick"> & {
  readonly family: CanvasToolFamily;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const last = lastOf(toolState, family);
  const active = familyOf(toolState.tool) === family;
  const hint = shortcutHint({ type: "tool", tool: family });
  // The tool's button is its trigger: its click toggles the picker.
  useDismiss(open, { inside: [ref], trigger: triggerRef }, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <ToolButton
        ref={triggerRef}
        tool={last}
        active={active}
        sticky={toolState.sticky === true}
        onClick={() => {
          onToolChange(last);
          setOpen((was) => !was);
        }}
        onDoubleClick={() => onToolDoubleClick(last)}
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
          aria-label={FAMILY_LOOKS[family].label}
          data-testid={`canvas-${family}-picker`}
          className="absolute top-0 left-full ml-2 flex flex-col gap-0.5 rounded-lg border border-foreground/10 bg-popover/95 p-1 shadow-floating backdrop-blur-sm"
        >
          {TOOL_FAMILIES[family].map((preset) => (
            <button
              key={preset}
              type="button"
              role="menuitemradio"
              aria-checked={preset === last}
              data-tool={preset}
              className={cn(
                "flex h-8 items-center gap-2 rounded-md pr-3 pl-2 text-ui text-foreground/65 transition-colors",
                "hover:bg-foreground/5 hover:text-foreground/90",
                preset === last && "bg-foreground/8 text-foreground/90",
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
          {hint !== "" && (
            <div className="px-2 pt-1 pb-0.5 text-label text-foreground/35">
              {hint} picks the last one
            </div>
          )}
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
      <FamilyTool
        family="shape"
        toolState={toolState}
        onToolChange={onToolChange}
        onToolDoubleClick={onToolDoubleClick}
      />
      <FamilyTool
        family="solid"
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
