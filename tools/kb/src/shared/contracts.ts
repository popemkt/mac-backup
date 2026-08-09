import { z } from "zod";
import {
  type ActionSchema,
  schemaToJsonSchema,
} from "../foundation/schema-seam.ts";

export const ActionModeSchema = z.enum(["read", "apply"]);
export type ActionMode = z.infer<typeof ActionModeSchema>;

export const FailureCodeSchema = z.enum([
  "not_found",
  "invalid_input",
  "ambiguous",
  "conflict",
  "invalid_move",
  "forbidden",
  "internal",
  "unknown_action",
]);
export type FailureCode = z.infer<typeof FailureCodeSchema>;

/**
 * Action contract. Schemas are Standard Schema v1–compatible (zod 4 satisfies
 * this). JSON Schema for manifests is derived when the vendor is zod;
 * otherwise a permissive object schema is emitted.
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
