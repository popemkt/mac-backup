import {
  canvasDepth,
  canvasElevation,
  canvasRotation,
  drawsGround,
  facesCamera,
  isFileNode,
  isGroupNode,
  isKbNode,
  isLinkNode,
  isShapeNode,
  isTextNode,
  styleOf,
  withFlag,
  withDepth,
  withElevation,
  withRotation,
  withStyle,
  type CanvasItemFlag,
  type CanvasItemLink,
  type CanvasNode,
  type CanvasWorld,
} from "@kb/canvas";
import { PopoverShell } from "@kb/ui-sdk";
import { CanvasPopover } from "./canvas-popover";
import { LinkRow } from "./item-link-row";
import type { CanvasPageTab } from "./canvas-page-strip";
import { textOfLink } from "./item-link-text";
import { ColorRow, LookRows } from "./item-style-rows";
import { NumberField } from "./number-field";

export interface ItemInspectorProps {
  item: CanvasNode;
  anchor: { x: number; y: number };
  onClose: () => void;
  onChange: (item: CanvasNode) => void;
  /** What the canvas reads of kb: where the item's link leads, in words. */
  world: CanvasWorld;
  /** The board's other pages, which the item's link may lead to. */
  pages: readonly CanvasPageTab[];
  /** Go where a link leads. */
  onFollow: (link: CanvasItemLink) => void;
}

/** How deep Extrude makes a flat item: a block, not a tower; the field takes it from there. */
const EXTRUDE_DEPTH = 40;

/**
 * Where the item stands and how far it rises: its elevation (`z`) and its
 * depth. Extrude lifts a flat item into a block — a sticky into a block, a
 * rectangle into a box — and Flatten lays it back on its plane.
 */
function HeightRow({ item, onChange }: Pick<ItemInspectorProps, "item" | "onChange">) {
  const depth = canvasDepth(item);
  return (
    <div className="flex flex-col gap-1.5 px-1.5 pb-1.5">
      <div className="flex items-center justify-between">
        <span className="text-meta text-foreground/50">Height</span>
        <button
          type="button"
          className="rounded-md px-1.5 py-0.5 text-label text-foreground/55 hover:bg-foreground/5 hover:text-foreground/85"
          onClick={() => onChange(withDepth(item, depth > 0 ? 0 : EXTRUDE_DEPTH))}
        >
          {depth > 0 ? "Flatten" : "Extrude"}
        </button>
      </div>
      <div className="flex gap-2">
        <NumberField
          key={`lift:${canvasElevation(item)}`}
          label="Lift"
          hint="How high its base stands off the floor"
          value={canvasElevation(item)}
          unit="length"
          onCommit={(z) => onChange(withElevation(item, z))}
        />
        <NumberField
          key={`depth:${depth}`}
          label="Depth"
          hint="How far it rises from its base; 0 is flat"
          value={depth}
          unit="length"
          min={0}
          onCommit={(d) => onChange(withDepth(item, d))}
        />
      </div>
    </div>
  );
}

/** How the inspector names an item's switch, and what it says it does. */
const FLAG_ROWS: { readonly [F in CanvasItemFlag]: { label: string; hint: string } } = {
  billboard: {
    label: "Face the camera",
    hint: "In 3D its face turns to you from any side, as a label does",
  },
  locked: {
    label: "Locked",
    hint: "Held where it is: nothing drags, turns, arranges or deletes it, and its height and turn are read-only (⇧L)",
  },
};

/** One of the item's switches (`withFlag`), as a checkbox. */
function FlagRow({
  item,
  flag,
  onChange,
}: Pick<ItemInspectorProps, "item" | "onChange"> & { flag: CanvasItemFlag }) {
  const { label, hint } = FLAG_ROWS[flag];
  return (
    <label className="flex items-center justify-between px-1.5 pb-1.5" title={hint}>
      <span className="text-meta text-foreground/50">{label}</span>
      <input
        type="checkbox"
        aria-label={label}
        className="h-3.5 w-3.5 accent-primary"
        checked={item[flag] === true}
        onChange={(e) => onChange(withFlag(item, flag, e.target.checked))}
      />
    </label>
  );
}

/** How opaque the item is drawn (its style's opacity), in percent. */
function OpacityRow({ item, onChange }: Pick<ItemInspectorProps, "item" | "onChange">) {
  const percent = Math.round(styleOf(item).opacity * 100);
  return (
    <div className="flex px-1.5 pb-1.5">
      <NumberField
        key={`opacity:${percent}`}
        label="Opacity"
        hint="How opaque it is drawn, in percent; 100 is fully"
        value={percent}
        unit="percent"
        min={0}
        onCommit={(p) => onChange(withStyle(item, { opacity: p / 100 }))}
      />
    </div>
  );
}

/** What each rotation field turns the item about. */
const TURN_HINTS = {
  x: "Degrees about its own width axis, applied first",
  y: "Degrees about its depth-wise axis, applied second",
  z: "Degrees about the vertical, applied last; clockwise from the top",
} as const;

/**
 * How the item is turned about its centre: degrees about x, then y, then z
 * (Blender's XYZ Euler), each committed as one change.
 */
function RotationRow({ item, onChange }: Pick<ItemInspectorProps, "item" | "onChange">) {
  const rotation = canvasRotation(item);
  return (
    <div className="flex flex-col gap-1.5 px-1.5 pb-1.5">
      <span className="text-meta text-foreground/50">Rotation</span>
      <div className="flex gap-2">
        {(["x", "y", "z"] as const).map((axis) => (
          <NumberField
            key={`turn:${axis}:${rotation[axis]}`}
            label={axis.toUpperCase()}
            hint={TURN_HINTS[axis]}
            value={rotation[axis]}
            unit="angle"
            onCommit={(angle) => onChange(withRotation(item, { ...rotation, [axis]: angle }))}
          />
        ))}
      </div>
    </div>
  );
}

/** What the inspector calls the item: by what it is, not how it is stored. */
function titleOf(item: CanvasNode): string {
  if (isShapeNode(item)) return canvasDepth(item) > 0 ? "Solid" : "Shape";
  if (isTextNode(item))
    return canvasDepth(item) > 0 ? "Block" : facesCamera(item) ? "Label" : "Text";
  if (isFileNode(item)) return "Image";
  if (isKbNode(item)) return "Card";
  if (isGroupNode(item)) return "Frame";
  if (isLinkNode(item)) return "Link";
  return "Item";
}

/**
 * The selected item's inspector: a canvas widget, not kb's node inspector,
 * because canvas items are not nodes yet (plan 2026-10-02, owner answer 2).
 */
export function ItemInspector({
  item,
  anchor,
  onClose,
  onChange,
  world,
  pages,
  onFollow,
}: ItemInspectorProps) {
  return (
    <CanvasPopover anchor={anchor} onClose={onClose}>
      <PopoverShell title={titleOf(item)} className="w-72" data-testid="item-inspector">
        {drawsGround(item) && <ColorRow item={item} onChange={onChange} />}
        <LookRows item={item} onChange={onChange} />
        <OpacityRow item={item} onChange={onChange} />
        <FlagRow item={item} flag="billboard" onChange={onChange} />
        <FlagRow item={item} flag="locked" onChange={onChange} />
        <LinkRow
          key={`link:${textOfLink(item.link)}`}
          item={item}
          world={world}
          pages={pages}
          onChange={onChange}
          onFollow={onFollow}
        />
        {/* Where it stands is what a lock holds: its height and turn are read-only while locked. */}
        <fieldset
          disabled={item.locked === true}
          aria-label="Place"
          className="m-0 min-w-0 border-0 p-0 disabled:opacity-50"
        >
          <HeightRow item={item} onChange={onChange} />
          {/* A flat billboard faces the camera whatever way it is turned. */}
          {!facesCamera(item) && <RotationRow item={item} onChange={onChange} />}
        </fieldset>
      </PopoverShell>
    </CanvasPopover>
  );
}
