import { z } from "zod";

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
 * Action contract. Schemas are Zod; JSON Schema is derived via z.toJSONSchema
 * at manifest time — never hand-written.
 */
export interface ActionDefinition<
  TIn extends z.ZodType = z.ZodType,
  TOut extends z.ZodType = z.ZodType,
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
    inputSchema: z.toJSONSchema(def.inputSchema),
    outputSchema: z.toJSONSchema(def.outputSchema),
  };
}
