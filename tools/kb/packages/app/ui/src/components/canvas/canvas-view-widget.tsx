/**
 * The canvas's view widget (DESIGN-UI.md → Canvas → Projections): an axis
 * gizmo in the stage's corner, computed from the camera's frame
 * (`screenAxes`), so it needs no second scene, and under it the name of the
 * view, which opens the view menu. In 2D it shows the top view, which is what
 * 2D is.
 *
 * Clicking an axis end looks from that side (Blender's convention: the +X end
 * is the right view). The menu lists the view commands (`CANVAS_VIEW_COMMANDS`,
 * the keymap's own table) and sends them through the keymap's applier, so a
 * key and a click cannot mean different things.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { CanvasProjectionKind } from "@kb/canvas";
import {
  CANVAS_VIEW_PRESETS,
  lensOf,
  presetOf,
  screenAxes,
  type CanvasView,
  type CanvasViewPreset,
} from "./canvas-camera";
import type { CanvasCameraRig } from "./canvas-camera-rig";
import { CANVAS_VIEW_COMMANDS, type CanvasIntent, type CanvasViewCommand } from "./canvas-keymap";
import { cn, isOutside } from "@/sdk";
import { AXIS_INK } from "./canvas-gizmo";

export interface CanvasViewWidgetProps {
  readonly rig: CanvasCameraRig;
  /** The 3D scene is the one showing (otherwise the view is `flatView`). */
  readonly in3d: boolean;
  readonly flatView: CanvasView;
  /** The projection the canvas asks for. */
  readonly projection: CanvasProjectionKind;
  readonly selectionEmpty: boolean;
  readonly menuOpen: boolean;
  readonly onMenuOpenChange: (open: boolean) => void;
  readonly onIntent: (intent: CanvasIntent) => void;
}

type Axis = "x" | "y" | "z";

/** The view from each axis end; none from under the floor. */
const END_VIEWS: Record<
  Axis,
  { readonly plus: CanvasViewPreset; readonly minus: CanvasViewPreset | null }
> = {
  x: { plus: "right", minus: "left" },
  y: { plus: "front", minus: "back" },
  z: { plus: "top", minus: null },
};

/** The gizmo's size and how far an axis reaches from its centre, CSS pixels. */
const GIZMO = 72;
const REACH = 25;

interface AxisEnd {
  readonly axis: Axis;
  readonly sign: 1 | -1;
  readonly x: number;
  readonly y: number;
  readonly toward: number;
  readonly view: CanvasViewPreset | null;
}

function axisEnds(view: CanvasView): AxisEnd[] {
  const axes = screenAxes(view);
  const ends: AxisEnd[] = [];
  for (const axis of ["x", "y", "z"] as const) {
    const a = axes[axis];
    for (const sign of [1, -1] as const) {
      ends.push({
        axis,
        sign,
        x: GIZMO / 2 + a.x * REACH * sign,
        y: GIZMO / 2 + a.y * REACH * sign,
        toward: a.toward * sign,
        view: sign === 1 ? END_VIEWS[axis].plus : END_VIEWS[axis].minus,
      });
    }
  }
  // The ends nearest the eye are drawn last, over the others.
  return ends.toSorted((p, q) => p.toward - q.toward);
}

function viewName(view: CanvasView, in3d: boolean): string {
  if (!in3d) return "Top · 2D";
  const preset = presetOf(view);
  const lens = lensOf(view) === "perspective" ? "Perspective" : "Orthographic";
  return `${preset === null ? "Free" : CANVAS_VIEW_PRESETS[preset].label} · ${lens}`;
}

function AxisGizmo({ view, onLook }: { view: CanvasView; onLook: (p: CanvasViewPreset) => void }) {
  const ends = axisEnds(view);
  return (
    <div
      className="relative"
      style={{ width: GIZMO, height: GIZMO }}
      data-testid="canvas-axis-gizmo"
    >
      <svg width={GIZMO} height={GIZMO} className="absolute inset-0" aria-hidden>
        <circle
          cx={GIZMO / 2}
          cy={GIZMO / 2}
          r={GIZMO / 2 - 1}
          className="fill-popover/70 stroke-foreground/10"
        />
        {ends
          .filter((end) => end.sign === 1)
          .map((end) => (
            <line
              key={end.axis}
              x1={GIZMO / 2}
              y1={GIZMO / 2}
              x2={end.x}
              y2={end.y}
              stroke={AXIS_INK[end.axis]}
              strokeWidth={2}
              strokeLinecap="round"
              opacity={0.55 + 0.45 * Math.max(0, end.toward + 0.4)}
            />
          ))}
      </svg>
      {ends.map((end) => {
        const name = `${end.sign === 1 ? "" : "−"}${end.axis.toUpperCase()}`;
        const looks = end.view === null ? "no view from under the floor" : `look from ${name}`;
        return (
          <button
            key={`${end.axis}${end.sign}`}
            type="button"
            disabled={end.view === null}
            title={`${name}: ${looks}`}
            aria-label={`${name}: ${looks}`}
            data-axis-end={`${end.sign === 1 ? "+" : "-"}${end.axis}`}
            className={cn(
              "absolute flex items-center justify-center rounded-full font-semibold leading-none",
              "-translate-x-1/2 -translate-y-1/2 transition-transform hover:scale-115",
              "focus-visible:outline-2 focus-visible:outline-ring",
              end.sign === 1 ? "h-4 w-4 text-micro text-background" : "h-3 w-3 border-2",
              end.view === null && "pointer-events-none",
            )}
            style={{
              left: end.x,
              top: end.y,
              backgroundColor:
                end.sign === 1
                  ? AXIS_INK[end.axis]
                  : `color-mix(in oklch, ${AXIS_INK[end.axis]} 22%, transparent)`,
              borderColor: end.sign === 1 ? undefined : AXIS_INK[end.axis],
              opacity: end.view === null ? 0.35 : 1,
            }}
            onClick={() => {
              if (end.view !== null) onLook(end.view);
            }}
          >
            {end.sign === 1 ? end.axis.toUpperCase() : null}
          </button>
        );
      })}
    </div>
  );
}

/** Whether a command is the state it names (the view, the lens, the projection). */
function checkedOf(
  command: CanvasViewCommand,
  view: CanvasView,
  in3d: boolean,
  projection: CanvasProjectionKind,
): boolean | null {
  const { intent } = command;
  if (intent.type === "look") return (in3d ? presetOf(view) : "top") === intent.preset;
  if (intent.type === "toggleLens") return lensOf(view) === "orthographic";
  if (intent.type === "projection") return projection === intent.kind;
  return null;
}

function ViewMenu({
  view,
  in3d,
  projection,
  selectionEmpty,
  onIntent,
  onClose,
  anchor,
}: {
  view: CanvasView;
  in3d: boolean;
  projection: CanvasProjectionKind;
  selectionEmpty: boolean;
  onIntent: (intent: CanvasIntent) => void;
  onClose: (returnFocus: boolean) => void;
  anchor: React.RefObject<HTMLElement | null>;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const items = () => [
    ...(menu.current?.querySelectorAll<HTMLButtonElement>("[role^=menuitem]:not(:disabled)") ?? []),
  ];
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (isOutside(menu.current, e.target) && isOutside(anchor.current, e.target)) onClose(false);
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [anchor, onClose]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const all = items();
    const at = all.findIndex((item) => item === document.activeElement);
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (step !== 0) all[(at + step + all.length) % all.length]?.focus();
    else if (e.key === "Home") all[0]?.focus();
    else if (e.key === "End") all.at(-1)?.focus();
    else if (e.key === "Escape") onClose(true);
    else return;
    // The canvas's own keys (nudge, escape) stay out of an open menu.
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <div
      ref={menu}
      role="menu"
      aria-label="View"
      data-testid="canvas-view-menu"
      className="kb-surface-enter absolute right-0 top-full z-30 mt-1 w-56 rounded-lg border border-foreground/10 bg-popover p-1 text-ui text-popover-foreground shadow-overlay"
      onKeyDown={onKeyDown}
    >
      {CANVAS_VIEW_COMMANDS.map((command, index) => {
        const { intent } = command;
        // A rule between kinds of command: views, lens, projection, framing.
        const prior = CANVAS_VIEW_COMMANDS[index - 1];
        const separated = prior !== undefined && prior.intent.type !== intent.type;
        const checked = checkedOf(command, view, in3d, projection);
        const disabled = intent.type === "frame" && intent.scope === "selection" && selectionEmpty;
        const role =
          checked === null
            ? "menuitem"
            : intent.type === "toggleLens"
              ? "menuitemcheckbox"
              : "menuitemradio";
        return (
          <div key={command.label}>
            {separated && <div role="separator" className="mx-1 my-1 h-px bg-foreground/10" />}
            <button
              type="button"
              role={role}
              aria-checked={checked ?? undefined}
              disabled={disabled}
              // The menu opens with its first command focused, for the arrow keys.
              autoFocus={command === CANVAS_VIEW_COMMANDS[0]}
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left outline-none",
                "hover:bg-foreground/[0.06] focus-visible:bg-foreground/[0.06] disabled:opacity-40",
                checked === true ? "text-foreground" : "text-foreground/70",
              )}
              onClick={() => {
                onIntent(intent);
                onClose(false);
              }}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  checked === true ? "bg-primary" : "bg-transparent",
                )}
                aria-hidden
              />
              <span className="truncate">{command.label}</span>
              {command.hint !== "" && (
                <kbd className="ml-auto font-mono text-label text-foreground/35">
                  {command.hint}
                </kbd>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function CanvasViewWidget({
  rig,
  in3d,
  flatView,
  projection,
  selectionEmpty,
  menuOpen,
  onMenuOpenChange,
  onIntent,
}: CanvasViewWidgetProps) {
  const live = useSyncExternalStore(rig.subscribe, () => rig.view);
  const view = in3d ? live : flatView;
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <div
      className="absolute right-3 top-3 z-20 flex flex-col items-end gap-1"
      data-testid="canvas-view-widget"
    >
      <AxisGizmo view={view} onLook={(preset) => onIntent({ type: "look", preset })} />
      <div className="relative">
        <button
          ref={trigger}
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="View menu (`)"
          className="rounded-md px-1.5 py-0.5 text-label text-foreground/45 hover:bg-foreground/5 hover:text-foreground/75"
          onClick={() => onMenuOpenChange(!menuOpen)}
        >
          {viewName(view, in3d)}
        </button>
        {menuOpen && (
          <ViewMenu
            view={view}
            in3d={in3d}
            projection={projection}
            selectionEmpty={selectionEmpty}
            onIntent={onIntent}
            anchor={trigger}
            onClose={(returnFocus) => {
              onMenuOpenChange(false);
              if (returnFocus) trigger.current?.focus();
            }}
          />
        )}
      </div>
    </div>
  );
}
