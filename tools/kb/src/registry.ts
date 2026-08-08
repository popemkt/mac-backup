import type { z } from "zod";
import {
  type ActionDefinition,
  type ActionInvocation,
  type ActionReceipt,
  actionToManifestEntry,
  failed,
  succeeded,
} from "./shared/contracts.ts";
import type { KbContext } from "./context.ts";
import { ResolveError } from "./foundation/resolve.ts";
import {
  fieldDefine,
  fieldDefineDef,
  graphQuery,
  graphQueryDef,
  nodeAdd,
  nodeAddDef,
  nodeGet,
  nodeGetDef,
  nodeUpdate,
  nodeUpdateDef,
  tagDefine,
  tagDefineDef,
} from "./operations/index.ts";

const definitions = [
  nodeAddDef,
  nodeUpdateDef,
  nodeGetDef,
  fieldDefineDef,
  tagDefineDef,
  graphQueryDef,
] as const satisfies readonly ActionDefinition[];

export function manifest() {
  return definitions.map(actionToManifestEntry);
}

export function listDefinitions(): readonly ActionDefinition[] {
  return definitions;
}

/**
 * Invoke an action. Never throws across this boundary — failures become receipts.
 */
export async function invoke(
  ctx: KbContext,
  invocation: ActionInvocation,
): Promise<ActionReceipt> {
  const { id, input } = invocation;
  try {
    switch (id) {
      case "node.add": {
        const parsed = nodeAddDef.inputSchema.parse(input);
        const output = await nodeAdd(ctx, parsed);
        return succeeded(id, output);
      }
      case "node.update": {
        const parsed = nodeUpdateDef.inputSchema.parse(input);
        const output = await nodeUpdate(ctx, parsed);
        return succeeded(id, output);
      }
      case "node.get": {
        const parsed = nodeGetDef.inputSchema.parse(input);
        const output = await nodeGet(ctx, parsed);
        return succeeded(id, output);
      }
      case "field.define": {
        const parsed = fieldDefineDef.inputSchema.parse(input);
        const output = await fieldDefine(ctx, parsed);
        return succeeded(id, output);
      }
      case "tag.define": {
        const parsed = tagDefineDef.inputSchema.parse(input);
        const output = await tagDefine(ctx, parsed);
        return succeeded(id, output);
      }
      case "graph.query": {
        const parsed = graphQueryDef.inputSchema.parse(input);
        const output = await graphQuery(ctx, parsed);
        return succeeded(id, output);
      }
      default:
        return failed(id, "unknown_action", `unknown action: ${id}`);
    }
  } catch (err) {
    return receiptFromError(id, err);
  }
}

function receiptFromError(id: string, err: unknown): ActionReceipt {
  if (err instanceof ResolveError) {
    return failed(id, err.code, err.message, err.details);
  }
  if (isZodError(err)) {
    return failed(id, "invalid_input", err.message, err.issues);
  }
  const message = err instanceof Error ? err.message : String(err);
  return failed(id, "internal", message);
}

function isZodError(
  err: unknown,
): err is z.ZodError & { issues: unknown } {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: string }).name === "ZodError"
  );
}
