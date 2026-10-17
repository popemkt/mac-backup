/**
 * The inspector rows that set a look (`styleOf`): the palette's swatches,
 * which the item and the edge inspectors share, one picker per look an
 * item draws — its fill and outline when it draws a ground of its own, and
 * the size, face and alignment of its words when they are its own — and an
 * edge's route, bend, heads and line. Each pick is one change (one history
 * step), written through `withStyle`, `withRoute` or `withHead`.
 */
import {
  CANVAS_ALIGNS,
  CANVAS_DASHES,
  CANVAS_FILLS,
  CANVAS_FONTS,
  CANVAS_HEADS,
  CANVAS_ROUTES,
  CANVAS_SIZES,
  CANVAS_VALIGNS,
  drawsGround,
  headOf,
  routeBends,
  ownsWords,
  styleOf,
  withHead,
  withRoute,
  withStyle,
  type CanvasEdge,
  type CanvasNode,
  type CanvasPaint,
  type EdgeEnd,
} from "@kb/canvas";
import { cn, EnumSelect, type EnumOption } from "@kb/ui-sdk";
import { CANVAS_SWATCHES } from "./canvas-color";
import { NumberField } from "./number-field";

/** The swatches: none, then each palette entry; the one `value` paints is marked. */
export function ColorSwatches({
  value,
  onChange,
  small = false,
}: {
  value: CanvasPaint | undefined;
  onChange: (color: string | undefined) => void;
  small?: boolean;
}) {
  const size = small ? "h-5 w-5" : "h-6 w-6";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        aria-label="No color"
        title="None"
        className={cn(
          size,
          "rounded-full border border-foreground/15 bg-background",
          value === undefined && "ring-2 ring-primary/50",
        )}
        onClick={() => onChange(undefined)}
      />
      {CANVAS_SWATCHES.map((p) => (
        <button
          key={p.id}
          type="button"
          aria-label={p.label}
          title={p.label}
          className={cn(
            size,
            "rounded-full border border-foreground/10",
            value?.kind === "palette" && value.id === p.id && "ring-2 ring-primary/50",
          )}
          style={{ backgroundColor: p.css }}
          onClick={() => onChange(p.id)}
        />
      ))}
    </div>
  );
}

/** Each look's options, named as the inspector shows them. */
const options = <T extends string>(values: readonly T[], labels: Record<T, string>) =>
  values.map((value): EnumOption<T> => ({ value, label: labels[value] }));

const FILLS = options(CANVAS_FILLS, { none: "None", semi: "Wash", solid: "Solid" });
const DASHES = options(CANVAS_DASHES, {
  solid: "Solid",
  dashed: "Dashed",
  dotted: "Dotted",
  none: "None",
});
const SIZES = options(CANVAS_SIZES, { s: "S", m: "M", l: "L", xl: "XL" });
const FONTS = options(CANVAS_FONTS, { sans: "Sans", serif: "Serif", mono: "Mono" });
const ALIGNS = options(CANVAS_ALIGNS, { start: "Left", middle: "Centre", end: "Right" });
const VALIGNS = options(CANVAS_VALIGNS, { top: "Top", middle: "Middle", bottom: "Bottom" });
const ROUTES = options(CANVAS_ROUTES, {
  curve: "Curve",
  straight: "Straight",
  arc: "Arc",
  elbow: "Elbow",
});
const HEADS = options([...CANVAS_HEADS, "none"] as const, {
  arrow: "Arrow",
  open: "Open",
  dot: "Dot",
  diamond: "Diamond",
  bar: "Bar",
  none: "None",
});

const SELECT =
  "h-7 w-full rounded-md border border-foreground/10 bg-background px-1.5 text-ui text-foreground/85";

/** One look's picker, labelled. */
function LookPicker<T extends string>({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: T;
  choices: readonly EnumOption<T>[];
  onChange: (next: T) => void;
}) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="text-label text-foreground/45">{label}</span>
      <EnumSelect
        className={SELECT}
        value={value}
        options={choices}
        onChange={onChange}
        testId={`look-${label.toLowerCase()}`}
      />
    </label>
  );
}

/**
 * How an edge runs and what it wears: its route, bent for an arc or an
 * elbow; the head each end wears; how its line is drawn and how heavy.
 */
export function EdgeLookRows({
  edge,
  onChange,
}: {
  edge: CanvasEdge;
  onChange: (edge: CanvasEdge) => void;
}) {
  const style = styleOf(edge);
  const route = edge.route ?? "curve";
  const head = (end: EdgeEnd) => headOf(edge, end) ?? "none";
  const wear = (end: EdgeEnd) => (next: (typeof HEADS)[number]["value"]) =>
    onChange(withHead(edge, end, next === "none" ? null : next));
  return (
    <div className="mb-2 flex flex-col gap-1.5" data-testid="edge-look-rows">
      <div className="flex gap-2">
        <LookPicker
          label="Route"
          value={route}
          choices={ROUTES}
          onChange={(next) => onChange(withRoute(edge, { route: next }))}
        />
        <LookPicker label="Start" value={head("from")} choices={HEADS} onChange={wear("from")} />
        <LookPicker label="End" value={head("to")} choices={HEADS} onChange={wear("to")} />
      </div>
      <div className="flex gap-2">
        <LookPicker
          label="Line"
          value={style.dash}
          choices={DASHES}
          onChange={(dash) => onChange(withStyle(edge, { dash }))}
        />
        <LookPicker
          label="Size"
          value={style.size}
          choices={SIZES}
          onChange={(size) => onChange(withStyle(edge, { size }))}
        />
        {routeBends(route) && (
          <NumberField
            key={`bend:${edge.bend ?? ""}`}
            label="Bend"
            hint={
              route === "arc"
                ? "How far its middle bows off the straight line, left of its way; unset, a fifth of the way across"
                : "How far its middle run is moved off centre"
            }
            value={edge.bend ?? 0}
            unit="length"
            onCommit={(bend) => onChange(withRoute(edge, { bend }))}
          />
        )}
      </div>
    </div>
  );
}

/** The colour row: the item's colour among the palette's swatches. */
export function ColorRow({
  item,
  onChange,
}: {
  item: CanvasNode;
  onChange: (item: CanvasNode) => void;
}) {
  const setColor = (color: string | undefined) => {
    const updated = { ...item };
    if (color === undefined) delete updated.color;
    else updated.color = color;
    onChange(updated);
  };
  return (
    <div className="flex flex-col gap-1 px-1.5 pb-1.5">
      <span className="text-meta text-foreground/50">Color</span>
      <ColorSwatches value={styleOf(item).color} onChange={setColor} />
    </div>
  );
}

/**
 * The look rows that apply to `item`: fill and outline for one that draws
 * its own ground, size for both, and the face and alignment of words that
 * are its own.
 */
export function LookRows({
  item,
  onChange,
}: {
  item: CanvasNode;
  onChange: (item: CanvasNode) => void;
}) {
  const style = styleOf(item);
  const ground = drawsGround(item);
  const words = ownsWords(item);
  if (!ground && !words) return null;
  return (
    <div className="flex flex-col gap-1.5 px-1.5 pb-1.5" data-testid="look-rows">
      <span className="text-meta text-foreground/50">Look</span>
      <div className="flex gap-2">
        {ground && (
          <LookPicker
            label="Fill"
            value={style.fill}
            choices={FILLS}
            onChange={(fill) => onChange(withStyle(item, { fill }))}
          />
        )}
        {ground && (
          <LookPicker
            label="Outline"
            value={style.dash}
            choices={DASHES}
            onChange={(dash) => onChange(withStyle(item, { dash }))}
          />
        )}
        <LookPicker
          label="Size"
          value={style.size}
          choices={SIZES}
          onChange={(size) => onChange(withStyle(item, { size }))}
        />
      </div>
      {words && (
        <div className="flex gap-2">
          <LookPicker
            label="Font"
            value={style.font}
            choices={FONTS}
            onChange={(font) => onChange(withStyle(item, { font }))}
          />
          <LookPicker
            label="Align"
            value={style.align}
            choices={ALIGNS}
            onChange={(align) => onChange(withStyle(item, { align }))}
          />
          <LookPicker
            label="Place"
            value={style.valign}
            choices={VALIGNS}
            onChange={(valign) => onChange(withStyle(item, { valign }))}
          />
        </div>
      )}
    </div>
  );
}
