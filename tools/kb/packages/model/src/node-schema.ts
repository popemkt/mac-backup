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

export const KbNodeSchema = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  props: Schema.Record(Schema.String, Schema.Array(PropValueSchema)),
  children: Schema.Array(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

/** Parse options for JSONL node decode (preserve excess own keys). */
export const nodeParseOptions: ParseOptions = {
  onExcessProperty: "preserve",
};
