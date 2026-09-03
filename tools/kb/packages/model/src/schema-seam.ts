import { z } from "zod";

/**
 * Standard Schema v1 compatibility seam for action input/output schemas.
 * Zod 4 already implements `~standard`; Effect Schema can via
 * `Schema.toStandardSchemaV1`. Core still authors zod schemas — this widens
 * the extension boundary before any internal Schema migration.
 */

export interface StandardSchemaV1Issue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
}

export interface StandardSchemaV1Result<Output> {
  readonly value?: Output;
  readonly issues?: ReadonlyArray<StandardSchemaV1Issue>;
}

export interface StandardSchemaV1Like<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) =>
      | StandardSchemaV1Result<Output>
      | Promise<StandardSchemaV1Result<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output };
  };
}

export interface ParsableSchema {
  readonly parse: (input: unknown) => unknown;
}

/** Accept Standard Schema v1 or any object exposing `.parse` (zod). */
export type ActionSchema = StandardSchemaV1Like | ParsableSchema;

export function isStandardSchemaV1(
  schema: unknown,
): schema is StandardSchemaV1Like {
  if (typeof schema !== "object" || schema === null) return false;
  const standard = (schema as { "~standard"?: unknown })["~standard"] as
    | { version?: unknown; validate?: unknown }
    | undefined;
  return (
    standard !== undefined &&
    standard.version === 1 &&
    typeof standard.validate === "function"
  );
}

export function isParsableSchema(schema: unknown): schema is ParsableSchema {
  return (
    typeof schema === "object" &&
    schema !== null &&
    typeof (schema as { parse?: unknown }).parse === "function"
  );
}

export function isActionSchema(schema: unknown): schema is ActionSchema {
  return isStandardSchemaV1(schema) || isParsableSchema(schema);
}

export class ActionSchemaError extends Error {
  override readonly name = "ActionSchemaError";
  constructor(
    message: string,
    readonly issues: ReadonlyArray<StandardSchemaV1Issue>,
  ) {
    super(message);
  }
}

/**
 * Parse action input via Standard Schema v1 when present, else `.parse`.
 * Throws ActionSchemaError (or the underlying zod ZodError) on failure.
 */
export async function parseActionInput(
  schema: ActionSchema,
  input: unknown,
): Promise<unknown> {
  if (isStandardSchemaV1(schema)) {
    const result = await schema["~standard"].validate(input);
    if (result.issues && result.issues.length > 0) {
      throw new ActionSchemaError(
        result.issues.map((i) => i.message).join("; "),
        result.issues,
      );
    }
    return result.value;
  }
  return schema.parse(input);
}

/** JSON Schema for manifests — zod via z.toJSONSchema; else a permissive object. */
export function schemaToJsonSchema(schema: ActionSchema): unknown {
  if (isZodType(schema)) {
    return z.toJSONSchema(schema);
  }
  return { type: "object" };
}

function isZodType(schema: unknown): schema is z.ZodType {
  return (
    isStandardSchemaV1(schema) &&
    schema["~standard"].vendor === "zod" &&
    isParsableSchema(schema)
  );
}
