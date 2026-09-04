import type { Effect } from "effect";
import type { FileSystem } from "effect/FileSystem";
import { z } from "zod";
import {
  FailureCodeSchema,
  type ActionSchema,
  type ActionSchemaError,
  type CodedError,
  type FailureCode,
  schemaToJsonSchema,
} from "@kb/model";
import type { KbCtx, KbStore } from "./session.ts";
import type { TemplateRegistry } from "./template.ts";

const ActionModeSchema = z.enum(["read", "apply"]);
type ActionMode = z.infer<typeof ActionModeSchema>;

/**
 * Services a native action handler may require. Provided as one merged Layer
 * at the invoke tip (`kbRuntimeLayer`); a handler that needs fewer of them
 * still assigns, because Effect's requirement channel is covariant.
 */
export type ActionHandlerEnv = KbCtx | KbStore | FileSystem | TemplateRegistry;

/**
 * What an action handler may fail with. A closed vocabulary, not `unknown`:
 * every surface turns a failure into an {@link ActionReceipt}, and a receipt
 * needs a {@link FailureCode} — so a handler either fails with a schema
 * failure or with an error that names its code. `DomainError` and a bundled
 * extension's own error class both satisfy `CodedError`. Anything outside the
 * vocabulary is a defect; the one place an untyped handler crosses into this
 * channel is the extension module boundary, and `@kb/runtime`'s registry maps
 * it there.
 */
export type ActionHandlerError = ActionSchemaError | CodedError;

/**
 * Effect-native action handler. Input is already schema-parsed; the services
 * in {@link ActionHandlerEnv} come from Layers at the invoke tip.
 *
 * `input: never` is the standard encoding for "accepts whatever this action's
 * `inputSchema` produces": a handler declaring a concrete input type is
 * assignable, and the registry pairs the two at the one seam that knows both.
 */
export type ActionEffectHandler = (
  input: never,
) => Effect.Effect<unknown, ActionHandlerError, ActionHandlerEnv>;

/**
 * Action contract. Schemas are Standard Schema v1–compatible (zod 4 satisfies
 * this). JSON Schema for manifests is derived when the vendor is zod;
 * otherwise a permissive object schema is emitted.
 *
 * Built-ins / bundled extensions may set {@link ActionDefinition.effect};
 * third-party `.kb/extensions` keep a Promise `handler` (see ExtensionAction).
 * Manifest serialization ignores both handler fields.
 */
export interface ActionDefinition<
  TIn extends ActionSchema = ActionSchema,
  TOut extends ActionSchema = ActionSchema,
> {
  id: string;
  title: string;
  description: string;
  mode: ActionMode;
  inputSchema: TIn;
  outputSchema: TOut;
  /**
   * Effect-native handler. When present, the registry composes it directly
   * (scoped) and never lifts it through `tryPromise`.
   */
  effect?: ActionEffectHandler;
}

export interface ActionInvocation {
  id: string;
  input: unknown;
}

export const ActionReceiptSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("succeeded"),
    id: z.string(),
    output: z.unknown(),
  }),
  z.object({
    status: z.literal("failed"),
    id: z.string(),
    code: FailureCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
  }),
]);
export type ActionReceipt = z.infer<typeof ActionReceiptSchema>;

export function succeeded(id: string, output: unknown): ActionReceipt {
  return { status: "succeeded", id, output };
}

export function failed(
  id: string,
  code: FailureCode,
  message: string,
  details?: unknown,
): ActionReceipt {
  return { status: "failed", id, code, message, details };
}

export function actionToManifestEntry(def: ActionDefinition) {
  return {
    id: def.id,
    title: def.title,
    description: def.description,
    mode: def.mode,
    inputSchema: schemaToJsonSchema(def.inputSchema),
    outputSchema: schemaToJsonSchema(def.outputSchema),
  };
}
