import { Schema } from "effect";
import type { ParseOptions } from "effect/SchemaAST";

/**
 * Internal Effect Schema for JSONL node rows.
 * Surfaces/extensions keep zod + Standard Schema; this validates persistence only.
 *
 * Decode with {@link nodeParseOptions}: unknown own properties are preserved so a
 * load→commit round-trip cannot silently drop fields the pre-Schema loader kept.
 * Known KbNode fields stay typed; extras exist only at runtime.
 *
 * PropValue `t`/`v` are correlated (discriminated by `t`) to match the wire
 * contract in `surface/protocol.ts` — uncorrelated pairs that would later 500
 * at WireNodeSchema are rejected at the persistence boundary.
 */

const StrPropValue = Schema.Struct({
  t: Schema.Literal("str"),
  v: Schema.String,
});

const NumPropValue = Schema.Struct({
  t: Schema.Literal("num"),
  // A stored number must survive a JSONL round-trip: NaN and ±Infinity
  // serialise to `null`, so a `num` prop means a finite number.
  v: Schema.Finite,
});

const BoolPropValue = Schema.Struct({
  t: Schema.Literal("bool"),
  v: Schema.Boolean,
});

const DatePropValue = Schema.Struct({
  t: Schema.Literal("date"),
  v: Schema.String,
});

const RefPropValue = Schema.Struct({
  t: Schema.Literal("ref"),
  v: Schema.String,
});

/** Correlated prop value — same variants as wire `PropValueSchema`. */
export const PropValueSchema = Schema.Union([
  StrPropValue,
  NumPropValue,
  BoolPropValue,
  DatePropValue,
  RefPropValue,
]);

/**
 * Mutable on purpose: `KbNode` is the in-memory node the session mutates, and
 * a decode that produced its deep-readonly twin would only be castable back.
 */
export const KbNodeSchema = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  props: Schema.Record(Schema.String, Schema.mutable(Schema.Array(PropValueSchema))),
  children: Schema.mutable(Schema.Array(Schema.String)),
  order: Schema.optionalKey(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

/** Parse options for JSONL node decode (preserve excess own keys). */
export const nodeParseOptions: ParseOptions = {
  onExcessProperty: "preserve",
};

/**
 * Decode one stored node. Every adapter's load path goes through this, so
 * unknown-key preservation and correlated `PropValue` validation cannot drift
 * between backends: JSONL calls it per line and adds the line number, sqlite
 * calls it per row and adds the row id. Sync and throwing on purpose — the
 * callers already wrap their whole load in one `Effect.try` so they can attach
 * the location the failure came from.
 */
export const decodeStoredNode = Schema.decodeUnknownSync(KbNodeSchema, nodeParseOptions);

/**
 * The stored form of one recorded transaction — `KbTx` as a store's tx tail
 * writes it. Here rather than in `tx.ts` because this file is where the
 * persistence decoders live, and both tails read it: the JSONL tail per line,
 * the SQLite tail per row.
 */
const KbTxSchema = Schema.Struct({
  // Finite for the same reason a `num` prop is: a rev that serialised to
  // `null` would be a position in the sequence nothing could read back.
  rev: Schema.Finite,
  at: Schema.String,
  origin: Schema.optionalKey(Schema.String),
  ops: Schema.Struct({
    upserts: Schema.mutable(Schema.Array(KbNodeSchema)),
    deletes: Schema.mutable(Schema.Array(Schema.String)),
  }),
});

/**
 * Decode one recorded transaction.
 *
 * Excess keys are dropped rather than preserved, the opposite of
 * {@link decodeStoredNode}: a tail record's extra keys are the *adapter's* own
 * bookkeeping (the store mark it was written at), and a `KbTx` that carried
 * them would put them on the wire in every `tx` frame. The nodes inside `ops`
 * still decode through {@link KbNodeSchema}, so an upsert in the tail is the
 * same node an upsert in the store is.
 */
export const decodeStoredTx = Schema.decodeUnknownSync(KbTxSchema, {
  onExcessProperty: "ignore",
});
