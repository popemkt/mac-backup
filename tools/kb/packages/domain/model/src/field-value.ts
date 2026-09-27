/**
 * A field value's form: how raw input becomes a value of a declared type, and
 * which values of the right kind are still not in that type's form.
 *
 * One statement for every surface. The CLI parses `--prop due=…` through
 * {@link parseTypedValue}, the UI's value slots parse what was typed through
 * it, and the write check (`txIntegrityError`) refuses — through
 * {@link valueConformanceError} — a value in no type's form, whoever wrote it
 * (MCP and HTTP hand over `PropValue`s directly). So a url the CLI accepts is
 * the url the UI accepts is the url the store accepts.
 *
 * Pure and isomorphic: no DOM, no `URL` global (the iso preset has no DOM
 * types), no locale lookup — a surface that has a locale passes it in.
 */
import { acceptsValueKind, fieldTypeOf, type FieldType } from "./field-type.ts";
import type { NodeLike } from "./ontology.ts";
import type { NodeId, PropValue } from "./model.ts";
import { parseDateInput, parseDay, type LocalDate } from "./local-date.ts";

/** The schemes a url value may carry: the ones a link in kb may open. */
const LINK_SCHEME = /^(https?:\/\/|mailto:)/i;
/** Any `scheme:` prefix, so an unsafe one is refused rather than prefixed. */
const ANY_SCHEME = /^[a-z][a-z\d+.-]*:/i;
/** `host:port` reads like a scheme to the pattern above, and is not one. */
const HOST_PORT = /^[a-z\d-]+(\.[a-z\d-]+)*:\d+(\/|$)/i;
/** A bare host: labels separated by dots (or `localhost`), then anything. */
const BARE_HOST = /^(localhost|[a-z\d-]+(\.[a-z\d-]+)+)(:\d+)?([/?#]|$)/i;

/**
 * A url value's canonical form, or null when the input is not a link.
 *
 * Trims; keeps an `http(s)://` or `mailto:` link as written; makes a bare
 * host (`example.com/x`, `localhost:3000`) and a protocol-relative `//host`
 * an `https://` link; and refuses every other scheme (`javascript:`,
 * `data:`, …) and anything with whitespace in it. Empty stays empty: an unset
 * url is not an invalid one. Idempotent: a canonical url normalizes to itself.
 */
export function normalizeUrl(raw: string): string | null {
  const text = raw.trim();
  if (text === "") return "";
  if (/\s/.test(text)) return null;
  if (LINK_SCHEME.test(text)) return text;
  if (text.startsWith("//")) return BARE_HOST.test(text.slice(2)) ? `https:${text}` : null;
  if (ANY_SCHEME.test(text) && !HOST_PORT.test(text)) return null;
  return BARE_HOST.test(text) ? `https://${text}` : null;
}

/** Raw input read as a value, or why it cannot be one. */
export type ParsedValue = { ok: true; value: PropValue } | { ok: false; reason: string };

const CHECKBOX_VALUES: Readonly<Record<string, boolean>> = { true: true, false: false };

const ok = (value: PropValue): ParsedValue => ({ ok: true, value });
const refuse = (reason: string): ParsedValue => ({ ok: false, reason });

/**
 * How a surface writes numbers: its decimal and grouping separators. The UI
 * passes its locale's; the CLI passes none and reads JavaScript's own form.
 */
export interface NumberSeparators {
  readonly decimal: string;
  readonly group: string;
}

const JS_NUMBERS: NumberSeparators = { decimal: ".", group: "" };

/** Spaces a locale may group with (plain, no-break, narrow no-break, thin). */
const NUMBER_SPACES = /[\s\u00a0\u202f\u2009]/g;

/** A number as a surface writes it, in JavaScript's form, or NaN. */
function readNumber(raw: string, { decimal, group }: NumberSeparators): number {
  let text = raw.replace(NUMBER_SPACES, "");
  if (group !== "" && group !== decimal) text = text.replaceAll(group, "");
  if (decimal !== ".") text = text.replaceAll(decimal, ".");
  return text === "" ? Number.NaN : Number(text);
}

/** What a surface knows that raw input may be read against. */
export interface ParseContext {
  /** How the writer writes numbers; JavaScript's own form when absent. */
  readonly numbers?: NumberSeparators;
  /** The writer's today, so relative dates (`tomorrow`, `fri`) read; absolute ones only when absent. */
  readonly today?: LocalDate;
}

/**
 * Raw input read as a value of `type`. The type decides the value kind; the
 * input's shape never does, so `42` for a text field is the string "42".
 * Input the type cannot read is refused, never coerced. A number is read in
 * the writer's own separators, grouping and spaces ignored; a date is any
 * phrase `parseDateInput` reads, stored as its local `YYYY-MM-DD`.
 */
export function parseTypedValue(
  raw: string,
  type: FieldType,
  { numbers = JS_NUMBERS, today }: ParseContext = {},
): ParsedValue {
  switch (type) {
    case "number": {
      const n = readNumber(raw, numbers);
      return Number.isFinite(n) ? ok({ t: "num", v: n }) : refuse(`not a number: ${raw}`);
    }
    case "checkbox": {
      const v = CHECKBOX_VALUES[raw];
      return v === undefined ? refuse(`expected true|false: ${raw}`) : ok({ t: "bool", v });
    }
    case "url": {
      const href = normalizeUrl(raw);
      return href === null ? refuse(`not a link: ${raw}`) : ok({ t: "str", v: href });
    }
    case "ref":
      return ok({ t: "ref", v: raw });
    case "date": {
      if (raw.trim() === "") return ok({ t: "str", v: "" });
      const date = parseDateInput(raw, today);
      return date === null ? refuse(`not a date: ${raw}`) : ok({ t: "str", v: date });
    }
    case "text":
      return ok({ t: "str", v: raw });
    default: {
      const unhandled: never = type;
      throw new Error(`unhandled field type: ${String(unhandled)}`);
    }
  }
}

/**
 * Why a value of an accepted kind is still not in its type's form, or null.
 * A url must be a link in canonical form (`normalizeUrl` of itself), a date a
 * real local `YYYY-MM-DD`; either may be unset.
 */
function valueFormError(type: FieldType, value: PropValue): string | null {
  if (type === "date" && value.t === "str" && value.v !== "" && parseDay(value.v) === null) {
    const date = parseDateInput(value.v);
    return date === null ? "is not a date" : `is not in date form (${date})`;
  }
  if (type === "url" && value.t === "str" && normalizeUrl(value.v) !== value.v) {
    const href = normalizeUrl(value.v);
    return href === null ? "is not a link" : `is not in link form (${href})`;
  }
  return null;
}

/** Whether `value` is a value a field of `type` may hold: its kind and its form. */
export function conformsToType(type: FieldType, value: PropValue): boolean {
  return acceptsValueKind(type, value) && valueFormError(type, value) === null;
}

/**
 * Why the field `fieldId` cannot hold `value`, or null when it can.
 *
 * Conformance is three facts about the graph: the value's kind is one the
 * field's declared type accepts, the value is in that type's form, and a ref
 * names a node the graph holds. `nodes` is the graph the value would land in,
 * so the field node and the ref target are both read from it — a field
 * declared, or a target created, in the same transaction counts. A key with
 * no field node behind it declares nothing, which `fieldTypeOf` reads as text
 * like any other undeclared type.
 *
 * GAP [[01M39YM7FQ9S231XW8JBA5MG0E]] — a ref field's target constraint
 * (`allowedRefIdsOf`) is not checked here; only the UI picker applies it.
 */
export function valueConformanceError(
  fieldId: NodeId,
  value: PropValue,
  nodes: ReadonlyMap<NodeId, Pick<NodeLike, "props">>,
): string | null {
  const type = fieldTypeOf(nodes.get(fieldId)?.props);
  if (!acceptsValueKind(type, value)) {
    return `field ${fieldId} is ${type} and cannot hold ${JSON.stringify(value)}`;
  }
  const form = valueFormError(type, value);
  if (form !== null) return `field ${fieldId} is ${type}: ${JSON.stringify(value.v)} ${form}`;
  if (value.t === "ref" && !nodes.has(value.v)) {
    return `field ${fieldId} refs missing node ${value.v}`;
  }
  return null;
}

/**
 * Rewrite the legacy date carrier, `{t:"date"}`, to the one date values have:
 * `{t:"str"}`. Run on open beside `migrateFieldTypeValues`, for the same
 * reason — one representation in the store, so a sort, a filter or an
 * editor never has to match two. Idempotent, and a node with no legacy value
 * is returned as it was.
 */
export function migrateDateValues<T extends { props: Record<string, PropValue[]> }>(
  nodes: T[],
): { nodes: T[]; changed: boolean } {
  const out = nodes.map((node) => {
    if (!Object.values(node.props).some((values) => values.some((v) => v.t === "date"))) {
      return node;
    }
    const props = Object.fromEntries(
      Object.entries(node.props).map(([field, values]) => [
        field,
        values.map((v): PropValue => (v.t === "date" ? { t: "str", v: v.v } : v)),
      ]),
    );
    return { ...node, props };
  });
  const changed = out.some((node, i) => node !== nodes[i]);
  return { nodes: changed ? out : nodes, changed };
}
