/**
 * How the canvas format's optional fields are read and written, in one
 * place for every record that has them — an item, an edge, an item's
 * `style`, the document and its camera (DESIGN.md → Canvas documents).
 *
 * A record's fields are a table (`FieldCodecs`): for each, how it is read
 * from what is written and how it is written back. A field read is typed on
 * the record; one present that holds a value kb cannot read — another
 * writer's, or a newer kb's — stays an unknown field (`extra`), untouched,
 * until kb writes that field itself. That is the format's round-trip rule,
 * and this module is the only place that applies it: a record's own value
 * wins over an unread one of the same name (`writeUnread`), however it was
 * set.
 */

/** How one field is read (undefined: nothing kb can read) and written back. */
interface FieldCodec<T> {
  readonly read: (raw: unknown) => T | undefined;
  /** The field as written; absent, the value itself. */
  readonly write?: (value: T) => unknown;
}

/** A record's optional fields `K`, each with its codec, in the order they are written. */
export type FieldCodecs<R, K extends keyof R & string> = {
  readonly [P in K]-?: FieldCodec<NonNullable<R[P]>>;
};

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A finite number, or undefined. */
export function finite(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** A string, or undefined. */
export function text(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** A boolean, or undefined. */
export function bool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

/** A value from `allowed`, or undefined: membership that narrows to the type. */
export function oneOf<T extends string>(allowed: readonly T[], raw: unknown): T | undefined {
  return allowed.find((value) => value === raw);
}

/** The fields of a table, in the order they are written. */
export function fieldKeys<R, K extends keyof R & string>(codecs: FieldCodecs<R, K>): readonly K[] {
  return Object.keys(codecs).filter((key): key is K => key in codecs);
}

/** Field `key` read from `raw` into `into`; false when it holds nothing kb can read. */
function readField<R, K extends keyof R & string>(
  codecs: FieldCodecs<R, K>,
  into: Partial<Pick<R, K>>,
  key: K,
  raw: unknown,
): boolean {
  const value = codecs[key].read(raw);
  if (value === undefined) return false;
  into[key] = value;
  return true;
}

/**
 * The fields of `codecs` that `raw` holds, read into `into`, and what else
 * `raw` holds: every key the table does not name (`also` names the ones the
 * caller reads itself), and every field whose value could not be read.
 */
export function readFields<R, K extends keyof R & string>(
  codecs: FieldCodecs<R, K>,
  raw: Record<string, unknown>,
  into: Partial<Pick<R, K>>,
  also: ReadonlySet<string> = new Set(),
): Record<string, unknown> | undefined {
  const keys = fieldKeys(codecs);
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (also.has(key) || value === undefined) continue;
    const field = keys.find((k) => k === key);
    if (field === undefined || !readField(codecs, into, field, value)) extra[key] = value;
  }
  return Object.keys(extra).length > 0 ? extra : undefined;
}

/** Field `key` of `record` as the format writes it into `out`, when it has one. */
function writeField<R, K extends keyof R & string>(
  codecs: FieldCodecs<R, K>,
  record: Partial<Pick<R, K>>,
  key: K,
  out: Record<string, unknown>,
): void {
  const value = record[key];
  if (value === undefined || value === null) return;
  const { write } = codecs[key];
  out[key] = write === undefined ? value : write(value);
}

/**
 * What kb could not read, written after the record's own fields: each key
 * the record did not write itself. A value kb holds wins over a stale one it
 * kept, however the record came to hold it.
 */
export function writeUnread(
  out: Record<string, unknown>,
  extra: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
  for (const [key, value] of Object.entries(extra ?? {}))
    if (!Object.hasOwn(out, key)) out[key] = value;
  return out;
}

/** The fields of `codecs` that `record` holds, written into `out` in the table's order. */
export function writeFields<R, K extends keyof R & string>(
  codecs: FieldCodecs<R, K>,
  record: Partial<Pick<R, K>>,
  out: Record<string, unknown>,
): Record<string, unknown> {
  for (const key of fieldKeys(codecs)) writeField(codecs, record, key, out);
  return out;
}
