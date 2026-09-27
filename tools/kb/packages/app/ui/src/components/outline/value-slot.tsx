import { useLayoutEffect, useRef, useState } from "react";
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
  type ValueKindSpec,
} from "@/lib/value-kind";
import { valueSlotIntent, type ValueSlotIntent } from "@/lib/value-slot-keymap";
import { arriveAt, neighbourSlot, registerSlot, slotIndex } from "@/lib/value-slot-nav";
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
import type { FieldHandle } from "./field-picker";

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
   * This slot exists because the user asked for it (Enter at the end of a value, the inline "+"), so the
   * gesture that created it owns the focus and the editor opens straight
   * away. A slot that exists only because the field is unset passes false and
   * renders as a quiet placeholder until it is aimed at.
   */
  autoOpen?: boolean;
  onCommit: (next: PropValue) => void;
  /** Carry out a follow from inside the value (`useFollow`). */
  onFollow: Follow;
  /**
   * The field as a whole, from the stack that holds its values. A slot on its
   * own (a story, a test) is a lone single-valued field.
   */
  field?: FieldHandle;
  /**
   * Take this value out of the field: a stored one is removed, a new one not
   * yet written is dropped. A typed value left empty is taken out this way.
   */
  onRemove?: () => void;
  /** What an empty slot says while it waits for a value; the default is "Empty". */
  placeholder?: string;
}

/** A slot with no stack around it has nothing to remove itself from. */
const noRemove = (): void => undefined;

/** A slot with no stack around it: one value, replaced by what is picked. */
function loneField(value: PropValue | null, onCommit: (next: PropValue) => void): FieldHandle {
  return {
    values: value === null ? [] : [value],
    many: false,
    add: onCommit,
    remove: () => undefined,
    create: () => Promise.resolve(null),
    openPicker: () => undefined,
    addSlot: () => undefined,
    leave: () => undefined,
    claimKeyboard: () => undefined,
    focusSlot: () => undefined,
  };
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
  field = loneField(value, onCommit),
  onRemove = noRemove,
  placeholder,
}: ValueSlotProps) {
  const kind = valueKindOf(fieldType, fieldId, context.schema.get(fieldId));
  const spec = VALUE_KINDS[kind];
  const shown = value ?? emptyValueForType(fieldType);
  const slot = useSlotGestures({
    spec,
    shown,
    isNew: value === null,
    autoOpen,
    field,
    onCommit,
    onRemove,
    onFollow,
  });
  const { Surface } = VALUE_VIEWS[kind];

  return (
    <div
      // A value the keyboard is on reads as selected, the way a row does.
      className="min-w-0 rounded-sm outline-none focus:bg-primary/8"
      data-value-slot={kind}
      data-editing={slot.editing ? "true" : undefined}
      {...slot.props}
    >
      <Surface
        value={shown}
        blank={slot.blank}
        editing={slot.editing}
        caretAt={slot.caretAt}
        seed={slot.seed}
        rejected={slot.rejected}
        spec={spec}
        display={display}
        fieldId={fieldId}
        context={context}
        onEnd={slot.end}
        handleRef={slot.handle}
        field={field}
        placeholder={placeholder}
        onFollow={onFollow}
      />
    </div>
  );
}

interface SlotArgs {
  spec: ValueKindSpec;
  shown: PropValue;
  /** The slot holds no stored value yet. */
  isNew: boolean;
  autoOpen: boolean;
  field: FieldHandle;
  onCommit: (next: PropValue) => void;
  onRemove: () => void;
  onFollow: Follow;
}

/**
 * A slot's editing state: open or closed (and where a caret editor opens),
 * refused input, and the two transitions — `begin` and `end` — every gesture
 * goes through.
 */
function useSlotEditing({ spec, shown, isNew, autoOpen, field, onCommit, onRemove }: SlotArgs) {
  const mode = EDITOR_MODES[spec.editor];
  /** Open (where a caret editor's caret goes, and a key typed to open it); closed is null. */
  const [entry, setEntry] = useState<{ at: number | "end"; seed?: string } | null>(
    autoOpen && mode.autoOpens ? { at: "end" } : null,
  );
  /** Typed text the kind refused: shown, marked, and where the next edit starts. */
  const [rejected, setRejected] = useState<RejectedInput | null>(null);
  const handle = useRef<EditHandle>(null);
  /**
   * Where the keyboard goes once the edit lands: the next value's new slot,
   * a neighbour, this value again. `changed` says whether a value was written
   * (then this slot is drawn anew, so it is found by place, not held).
   */
  const then = useRef<((changed: boolean) => void) | null>(null);

  /**
   * Activate the slot: open its editor — with the caret at `at`, for a caret
   * editor, and `seed` as the text when a key opened it — or, for a toggle,
   * flip it.
   */
  const begin = (at: number | "end" = "end", seed?: string) => {
    if (spec.editor === "toggle") onCommit(toggledValue(shown));
    // A many-valued field is picked as a whole: its stack draws one picker
    // over every value, so toggling this value off cannot close it.
    else if (spec.editor === "picker" && field.many) field.openPicker(seed);
    else if (spec.editor !== "swatch") setEntry(seed === undefined ? { at } : { at, seed });
  };

  const end = (parsed?: ParsedValue, text = "") => {
    const next = then.current;
    then.current = null;
    setEntry(null);
    if (parsed === undefined) {
      setRejected(null);
      // Nothing typed into a new value's slot: there is no value to keep.
      if (spec.editor === "caret" && isNew) onRemove();
      else next?.(false);
    } else if (spec.editor === "caret" && text.trim() === "") {
      // A typed value emptied is a value taken out, not a blank one kept.
      setRejected(null);
      onRemove();
    } else if (parsed.ok) {
      setRejected(null);
      onCommit(parsed.value);
      next?.(true);
    } else setRejected({ text, reason: parsed.reason });
  };

  /** Commit what is typed, and carry on to `after` once the commit lands. */
  const commitThen = (after: (changed: boolean) => void) => {
    then.current = after;
    handle.current?.commit();
  };

  return { mode, entry, rejected, setRejected, handle, begin, end, commitThen };
}

/** What each keymap intent does to a slot, and where the keyboard goes after. */
function useSlotIntents({
  element,
  handle,
  field,
  onRemove,
  begin,
  commitThen,
  setRejected,
  follow,
}: {
  element: React.RefObject<HTMLDivElement | null>;
  handle: React.RefObject<EditHandle | null>;
  field: FieldHandle;
  onRemove: () => void;
  begin: (at?: number | "end", seed?: string) => void;
  commitThen: (after: (changed: boolean) => void) => void;
  setRejected: (next: RejectedInput | null) => void;
  follow: () => void;
}): Readonly<Record<ValueSlotIntent, (e: React.KeyboardEvent) => void>> {
  /** On from this value: the neighbour at rest, or out of the field to the row. */
  const moveOn = (delta: -1 | 1, from: Element | null) => {
    const neighbour = from === null ? null : neighbourSlot(from, delta);
    if (neighbour !== null) arriveAt(neighbour, "rest");
    else field.leave(delta === -1 ? "up" : "down");
  };

  /** This value again, at rest, once an edit has landed. */
  const stay = () => {
    const el = element.current;
    const index = el === null ? -1 : slotIndex(el);
    return (changed: boolean) => {
      if (changed && index >= 0) field.focusSlot(index);
      else el?.focus();
    };
  };

  /** `contain` only keeps the key in. */
  return {
    edit: () => begin("end"),
    type: (e) => begin("end", e.key),
    remove: () => {
      const el = element.current;
      const before = el === null ? null : (neighbourSlot(el, -1) ?? neighbourSlot(el, 1));
      onRemove();
      if (before !== null) arriveAt(before, "rest");
      else field.leave("back");
    },
    leave: () => field.leave("back"),
    previous: () => moveOn(-1, element.current),
    next: () => moveOn(1, element.current),
    commit: () => commitThen(stay()),
    commitAndAdd: () => commitThen(() => field.addSlot()),
    commitAndPrevious: () => {
      const from = element.current;
      commitThen(() => moveOn(-1, from));
    },
    commitAndNext: () => {
      const from = element.current;
      commitThen(() => moveOn(1, from));
    },
    cancel: () => {
      setRejected(null);
      const back = stay();
      handle.current?.cancel();
      back(false);
    },
    removeEmpty: () => {
      const el = element.current;
      const before = el === null ? null : neighbourSlot(el, -1);
      onRemove();
      if (before !== null) arriveAt(before, "edit");
      else field.leave("up");
    },
    softBreak: () => handle.current?.softBreak(),
    follow,
    contain: () => undefined,
  };
}

/**
 * A slot's gestures: the focus, click, composition and key handlers its
 * element takes, over its editing state. Every gesture on a value is here.
 */
function useSlotGestures(args: SlotArgs) {
  const { spec, shown, field, onRemove, onFollow } = args;
  const { mode, entry, rejected, setRejected, handle, begin, end, commitThen } =
    useSlotEditing(args);
  const editing = entry !== null;
  const blank = spec.isBlank(shown);
  const composing = useRef(false);
  const element = useRef<HTMLDivElement>(null);
  /** The next focus is the keyboard's own arrival, not an aim to open. */
  const quiet = useRef(false);
  const target = spec.follow(shown);

  useLayoutEffect(() => {
    const el = element.current;
    if (el === null) return undefined;
    return registerSlot(el, {
      focus: () => {
        quiet.current = true;
        el.focus({ preventScroll: false });
        quiet.current = false;
      },
      editAtEnd: () => begin("end"),
    });
  });

  const follow = () => {
    if (target !== null) onFollow(target, "open");
  };

  const caret = () => handle.current?.caret() ?? null;
  const apply = useSlotIntents({
    element,
    handle,
    field,
    onRemove,
    begin,
    commitThen,
    setRejected,
    follow,
  });

  const opensOnFocus = mode.opensOnFocusWhenEmpty && blank && !editing;

  const props = {
    ref: element,
    // Every value is a keyboard stop (the outline's arrows arrive on it); an
    // unset slot that opens when aimed at is a Tab stop too.
    tabIndex: opensOnFocus ? 0 : -1,
    role: opensOnFocus ? "button" : undefined,
    "aria-label": opensOnFocus ? "Set value" : undefined,
    onFocus: () => {
      field.claimKeyboard();
      if (opensOnFocus && !quiet.current) begin();
    },
    onClick: (e: React.MouseEvent) => {
      if (editing) return;
      // A pointer segment (a ref label, a link) follows on a plain click, as
      // it does in node text; a modifier click follows from anywhere.
      if (routePointerClick(e, onFollow)) return;
      if (target !== null && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        follow();
        return;
      }
      if (spec.editor === "toggle") e.stopPropagation();
      // The caret lands where the click did, as it does in node text.
      begin(handle.current?.caretAtPoint(e.clientX, e.clientY) ?? "end");
    },
    onCompositionStart: () => {
      composing.current = true;
    },
    onCompositionEnd: () => {
      composing.current = false;
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      // A key inside an open picker or the date editor is theirs; it only
      // reaches here if they let it.
      const intent = valueSlotIntent(e, {
        editing,
        keys: mode.keys,
        composing: composing.current || e.nativeEvent.isComposing,
        canFollow: target !== null,
        toggles: spec.editor === "toggle",
        addsOnEnter: () => field.many && handle.current?.atEnd() === true,
        caretAtStart: () => caret()?.at === 0,
        caretAtEnd: () => {
          const c = caret();
          return c !== null && c.at >= c.length;
        },
        textEmpty: () => caret()?.length === 0,
      });
      if (intent === null) return;
      // A key the slot takes is its own: the outline behind it must not also
      // act on it.
      e.stopPropagation();
      if (intent !== "contain" && intent !== "cancel") e.preventDefault();
      apply[intent](e);
    },
  };

  return {
    blank,
    editing,
    caretAt: entry?.at ?? "end",
    seed: entry?.seed,
    rejected,
    handle,
    end,
    props,
  };
}
