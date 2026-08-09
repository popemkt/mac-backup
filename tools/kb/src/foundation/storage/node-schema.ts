import { Schema } from "effect";

/**
 * Internal Effect Schema for JSONL node rows.
 * Surfaces/extensions keep zod + Standard Schema; this validates persistence only.
 */

const ScalarPropValue = Schema.Struct({
  t: Schema.Literals(["str", "num", "bool", "date"]),
  v: Schema.Union([Schema.String, Schema.Number, Schema.Boolean]),
});

const RefPropValue = Schema.Struct({
  t: Schema.Literal("ref"),
  v: Schema.String,
});

export const PropValueSchema = Schema.Union([ScalarPropValue, RefPropValue]);

export const KbNodeSchema = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  props: Schema.Record(Schema.String, Schema.Array(PropValueSchema)),
  children: Schema.Array(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
