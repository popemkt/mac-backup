import { Effect, Predicate } from "effect";
import { z } from "zod";
import { type DomainError, domainFromResolve, isDomainError } from "./errors.ts";
import { ResolveError } from "./resolve.ts";

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

interface StandardSchemaV1Result<Output> {
  readonly value?: Output;
  readonly issues?: ReadonlyArray<StandardSchemaV1Issue>;
}

export interface StandardSchemaV1Like<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => StandardSchemaV1Result<Output> | Promise<StandardSchemaV1Result<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output };
  };
}

interface ParsableSchema {
  readonly parse: (input: unknown) => unknown;
}

/** Accept Standard Schema v1 or any object exposing `.parse` (zod). */
export type ActionSchema = StandardSchemaV1Like | ParsableSchema;

export function isStandardSchemaV1(schema: unknown): schema is StandardSchemaV1Like {
  if (!Predicate.hasProperty(schema, "~standard")) return false;
  const standard = schema["~standard"];
  return (
    Predicate.isObject(standard) &&
    standard.version === 1 &&
    typeof standard.validate === "function"
  );
}

function isParsableSchema(schema: unknown): schema is ParsableSchema {
  return Predicate.hasProperty(schema, "parse") && typeof schema.parse === "function";
}

export function isActionSchema(schema: unknown): schema is ActionSchema {
  return isStandardSchemaV1(schema) || isParsableSchema(schema);
}

export class ActionSchemaError extends Error {
  override readonly name = "ActionSchemaError";
  readonly issues: ReadonlyArray<StandardSchemaV1Issue>;

  constructor(message: string, issues: ReadonlyArray<StandardSchemaV1Issue>) {
    super(message);
    this.issues = issues;
  }
}

/** A thrown zod failure, recognised structurally so zod stays one import. */
export function isZodError(err: unknown): err is Error & { issues: unknown } {
  return typeof err === "object" && err !== null && (err as { name?: string }).name === "ZodError";
}

/** Name a schema failure: the one mapping from a thrown value to a typed one. */
export function schemaFailure(err: unknown): ActionSchemaError | DomainError {
  if (err instanceof ActionSchemaError) return err;
  if (isZodError(err)) return new ActionSchemaError(err.message, [{ message: err.message }]);
  if (err instanceof ResolveError) return domainFromResolve(err);
  if (isDomainError(err)) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new ActionSchemaError(message, [{ message }]);
}

/**
 * Parse action input via Standard Schema v1 when present, else `.parse`.
 * Fails with the typed {@link schemaFailure} of whatever the schema raised.
 */
export const parseActionInput = Effect.fn("kb.parseActionInput")(function* (
  schema: ActionSchema,
  input: unknown,
): Effect.fn.Return<unknown, ActionSchemaError | DomainError> {
  if (isStandardSchemaV1(schema)) {
    const result = yield* Effect.promise(() =>
      Promise.resolve(schema["~standard"].validate(input)),
    );
    if (result.issues && result.issues.length > 0) {
      return yield* Effect.fail(
        new ActionSchemaError(result.issues.map((i) => i.message).join("; "), result.issues),
      );
    }
    return result.value;
  }
  return yield* Effect.try({ try: () => schema.parse(input), catch: schemaFailure });
});

/** JSON Schema for manifests — zod via z.toJSONSchema; else a permissive object. */
export function schemaToJsonSchema(schema: ActionSchema): unknown {
  if (isZodType(schema)) {
    return z.toJSONSchema(schema);
  }
  return { type: "object" };
}

function isZodType(schema: unknown): schema is z.ZodType {
  return (
    isStandardSchemaV1(schema) && schema["~standard"].vendor === "zod" && isParsableSchema(schema)
  );
}
