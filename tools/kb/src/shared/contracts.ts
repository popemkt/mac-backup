import type { Effect } from "effect";
import { z } from "zod";
import type { FailureCode } from "../foundation/failure.ts";
import {
  type ActionSchema,
  schemaToJsonSchema,
} from "../foundation/schema-seam.ts";

export const ActionModeSchema = z.enum(["read", "apply"]);
export type ActionMode = z.infer<typeof ActionModeSchema>;

/**
 * Effect-native action handler. Input is already schema-parsed; services
 * (`KbCtx` / `KbStore` / `FileSystem`) come from Layers at the invoke tip.
 * `R` is intentionally wide so built-ins with narrower requirements assign.
 */
export type ActionEffectHandler = (
  input: never,
) => Effect.Effect<unknown, unknown, any>;

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

export type ActionReceipt =
  | {
      status: "succeeded";
      id: string;
      output: unknown;
    }
  | {
      status: "failed";
      id: string;
      code: FailureCode;
      message: string;
      details?: unknown;
    };

export function succeeded(
  id: string,
  output: unknown,
): ActionReceipt {
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
