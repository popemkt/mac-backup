import {
  CalendarBlankIcon,
  HashIcon,
  LinkSimpleIcon,
  PaletteIcon,
  TextTIcon,
  CheckSquareIcon,
  type Icon,
} from "@phosphor-icons/react";
import type { FieldType } from "@/lib/field-type";
import { valueKindOf, type ValueKind } from "@/lib/value-kind";
import {
  CheckboxSurface,
  ColorSurface,
  DateSurface,
  NumberSurface,
  OptionSurface,
  RefSurface,
  TextSurface,
  UrlSurface,
  type ValueSurfaceProps,
} from "./field-value";

/**
 * One kind's presentation: the glyph its row wears, and the surface that
 * shows the value and, while the slot edits, edits it in place.
 *
 * Display and edit are one component per kind on purpose — every surface
 * *is* its own display until the slot opens it, which is what makes an inline
 * field feel like text rather than a form control. What a gesture does is not
 * here: the slot (`ValueSlot`) owns every gesture, for every kind.
 */
interface ValueView {
  /** The type glyph `FieldRow` shows in its icon slot. */
  readonly icon: Icon;
  readonly Surface: (props: ValueSurfaceProps) => React.ReactNode;
}

/**
 * The view registry: one row per value kind, keyed by the same union as the
 * kind table (`VALUE_KINDS`). A new kind is a row here and a row there.
 *
 * `url` shares the text glyph, as it always has. That is a cell rather than a
 * fall-through, so giving it its own icon is a one-word change.
 */
export const VALUE_VIEWS: Readonly<Record<ValueKind, ValueView>> = {
  text: { icon: TextTIcon, Surface: TextSurface },
  url: { icon: TextTIcon, Surface: UrlSurface },
  number: { icon: HashIcon, Surface: NumberSurface },
  date: { icon: CalendarBlankIcon, Surface: DateSurface },
  checkbox: { icon: CheckSquareIcon, Surface: CheckboxSurface },
  ref: { icon: LinkSimpleIcon, Surface: RefSurface },
  option: { icon: LinkSimpleIcon, Surface: OptionSurface },
  color: { icon: PaletteIcon, Surface: ColorSurface },
};

/** The glyph a field's row wears. */
export type FieldGlyph = Icon;

/**
 * The type glyph for a field — the icon half of its kind's row.
 *
 * `FieldRow` draws this rather than looking the row up itself, so the glyph
 * and the surface can never come from different rows.
 */
export function fieldGlyphOf(fieldType: FieldType, fieldId?: string): FieldGlyph {
  return VALUE_VIEWS[valueKindOf(fieldType, fieldId)].icon;
}
