import { useRef, useState } from "react";
import {
  CalendarBlankIcon,
  HashIcon,
  LinkSimpleIcon,
  PaletteIcon,
  TextTIcon,
  CheckSquareIcon,
  type Icon,
} from "@phosphor-icons/react";
import type { FieldContext } from "@/lib/schema";
import type { PropValue } from "@/lib/types";
import type { ParsedValue } from "@kb/model";
import { routePointerClick, type Follow } from "@/lib/follow";
import { emptyValueForType, type FieldType } from "@/lib/field-type";
import {
  EDITOR_MODES,
  toggledValue,
  valueKindOf,
  VALUE_KINDS,
  type ValueKind,
} from "@/lib/value-kind";
import { valueSlotIntent } from "@/lib/value-slot-keymap";
import {
  CaretValue,
  CheckboxSurface,
  ColorSurface,
  DateSurface,
  OptionSurface,
  RefSurface,
  type CaretDisplay,
  type EditHandle,
  type RejectedInput,
  type ValueSurfaceProps,
} from "./field-value";

/**
 * One kind's presentation: the glyph its row wears, and the surface that
 * shows the value and, while the slot edits, edits it in place.
 *
 * Display and edit are one component per kind on purpose — every surface
 * *is* its own display until the slot opens it, which is what makes an inline
 * field feel like text rather than a form control. What a gesture does is not
 * here: the slot below owns every gesture, for every kind.
 */
interface ValueView {
  /** The type glyph `FieldRow` shows in its icon slot. */
  readonly icon: Icon;
  readonly Surface: (props: ValueSurfaceProps) => React.ReactNode;
}

function caretSurface(display: CaretDisplay): ValueView["Surface"] {
  return function CaretSurface(props: ValueSurfaceProps) {
    return <CaretValue {...props} display={display} />;
  };
}

/**
 * The view registry: one row per value kind, keyed by the same union as the
 * kind table (`VALUE_KINDS`). A new kind is a row here and a row there.
 *
 * `url` shares the text glyph, as it always has. That is a cell rather than a
 * fall-through, so giving it its own icon is a one-word change.
 */
const VALUE_VIEWS: Readonly<Record<ValueKind, ValueView>> = {
  text: { icon: TextTIcon, Surface: caretSurface("markdown") },
  url: { icon: TextTIcon, Surface: caretSurface("link") },
  number: { icon: HashIcon, Surface: caretSurface("number") },
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
 * `FieldRow` renders this rather than looking the row up itself, so the glyph
 * and the surface can never come from different rows.
 */
export function FieldTypeIcon({
  fieldType,
  fieldId,
  size = 13,
}: {
  fieldType: FieldType;
  fieldId?: string;
  size?: number;
}) {
  const { icon: Glyph } = VALUE_VIEWS[valueKindOf(fieldType, fieldId)];
  return <Glyph size={size} />;
}

export interface ValueSlotProps {
  /** The stored value, or null for a slot that holds none yet. */
  value: PropValue | null;
  fieldType: FieldType;
  /** The field this value belongs to; a field may name its own kind. */
  fieldId: string;
  /** What the value resolves against (`fieldContextOf`). */
  context: FieldContext;
  /** Pre-formatted label for a ref value, when the caller already has one. */
  display?: string;
  /**
   * This slot exists because the user asked for it ("+ value"), so the
   * gesture that created it owns the focus and the editor opens straight
   * away. A slot that exists only because the field is unset passes false and
   * renders as a quiet placeholder until it is aimed at.
   */
  autoOpen?: boolean;
  onCommit: (next: PropValue) => void;
  /** Carry out a follow from inside the value (`useFollow`). */
  onFollow: Follow;
}

/**
 * One value of one field — the unit every gesture on a value is written for.
 *
 * The slot owns the gestures and the kind owns only data: whether a click
 * edits or toggles, whether the slot is a Tab stop, which keys commit and
 * revert. A kind's surface (`VALUE_VIEWS`) draws the value and, while
 * `editing`, its editor; it has no click handler of its own. So a gesture
 * reads the same on every type, and a new type is rows in two tables rather
 * than another component deciding its own clicks.
 *
 * **Focus belongs to the gesture that created the slot, not to the slot being
 * empty.** An unset slot renders closed and opens when it receives focus
 * (for the kinds whose mode says so); `autoOpen` opens the ones the user
 * minted. Openness is one state, here.
 */
export function ValueSlot({
  value,
  fieldType,
  fieldId,
  context,
  display = "",
  autoOpen = false,
  onCommit,
  onFollow,
}: ValueSlotProps) {
  const kind = valueKindOf(fieldType, fieldId, context.schema.get(fieldId));
  const spec = VALUE_KINDS[kind];
  const mode = EDITOR_MODES[spec.editor];
  const shown = value ?? emptyValueForType(fieldType);
  const blank = spec.isBlank(shown);
  /** Open, and where a caret editor's caret goes; closed is null. */
  const [entry, setEntry] = useState<{ at: number | "end" } | null>(
    autoOpen && mode.autoOpens ? { at: "end" } : null,
  );
  const editing = entry !== null;
  /** Typed text the kind refused: shown, marked, and where the next edit starts. */
  const [rejected, setRejected] = useState<RejectedInput | null>(null);
  const handle = useRef<EditHandle>(null);
  const composing = useRef(false);
  const { Surface } = VALUE_VIEWS[kind];

  /**
   * Activate the slot: open its editor — with the caret at `at`, for a caret
   * editor — or, for a toggle, flip it.
   */
  const begin = (at: number | "end" = "end") => {
    if (spec.editor === "toggle") onCommit(toggledValue(shown));
    else if (spec.editor !== "swatch") setEntry({ at });
  };

  const end = (parsed?: ParsedValue, text = "") => {
    setEntry(null);
    if (parsed === undefined) setRejected(null);
    else if (parsed.ok) {
      setRejected(null);
      onCommit(parsed.value);
    } else setRejected({ text, reason: parsed.reason });
  };

  const opensOnFocus = mode.opensOnFocusWhenEmpty && blank && !editing;
  const target = spec.follow(shown);

  return (
    <div
      className="min-w-0"
      data-value-slot={kind}
      data-editing={editing ? "true" : undefined}
      tabIndex={opensOnFocus ? 0 : undefined}
      role={opensOnFocus ? "button" : undefined}
      aria-label={opensOnFocus ? "Set value" : undefined}
      onFocus={opensOnFocus ? () => begin() : undefined}
      onClick={(e) => {
        if (editing) return;
        // A pointer segment (a ref label, a link) follows on a plain click, as
        // it does in node text; a modifier click follows from anywhere.
        if (routePointerClick(e, onFollow)) return;
        if (target !== null && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          onFollow(target, "open");
          return;
        }
        if (spec.editor === "toggle") e.stopPropagation();
        // The caret lands where the click did, as it does in node text.
        begin(handle.current?.caretAtPoint(e.clientX, e.clientY) ?? "end");
      }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
      }}
      onKeyDown={(e) => {
        const intent = valueSlotIntent(e, {
          editing,
          keys: mode.keys,
          composing: composing.current || e.nativeEvent.isComposing,
          canFollow: target !== null,
        });
        if (intent === null) return;
        // A key an editing slot receives is its own: the outline behind it
        // must not also act on it.
        e.stopPropagation();
        if (intent === "commit") {
          e.preventDefault();
          handle.current?.commit();
        } else if (intent === "cancel") {
          setRejected(null);
          handle.current?.cancel();
        } else if (intent === "softBreak") {
          e.preventDefault();
          handle.current?.softBreak();
        } else if (intent === "follow" && target !== null) {
          e.preventDefault();
          onFollow(target, "open");
        }
      }}
    >
      <Surface
        value={shown}
        blank={blank}
        editing={editing}
        caretAt={entry?.at ?? "end"}
        rejected={rejected}
        spec={spec}
        display={display}
        fieldId={fieldId}
        context={context}
        onEnd={end}
        handleRef={handle}
        onFollow={onFollow}
      />
    </div>
  );
}
