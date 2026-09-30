import { Context, Predicate, type Effect } from "effect";
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
import type { KbIndexService } from "@kb/query";
import type { KbCtx, KbStore } from "./session.ts";
import type { TemplateRegistry } from "./template.ts";
import type { Assets, SavedQueries } from "./workspace.ts";

/**
 * What invoking an action does, declared once on its definition and read by
 * every surface: a `read` changes nothing, and a `write` may change the graph
 * or the workspace. A write can also require approval, meaning a person must
 * have approved the call. The invoke core refuses an unapproved call to such
 * an action ({@link requiresApproval}), so no surface can skip the check.
 * Approval exists only on a write, so it is part of the write arm and not a
 * flag beside the mode.
 *
 * The extension loader decodes a contribution's mode through
 * {@link isActionMode}. The SDK's `ActionMode` restates it for authors, and a
 * type-level test keeps the two equal.
 */
const ActionModeSchema = z.discriminatedUnion("kind", [
  // Strict, so a read that claims an approval is rejected, not stripped.
  z.strictObject({ kind: z.literal("read") }),
  z.strictObject({ kind: z.literal("write"), approval: z.literal("required").optional() }),
]);
export type ActionMode = z.infer<typeof ActionModeSchema>;

export function isActionMode(value: unknown): value is ActionMode {
  return ActionModeSchema.safeParse(value).success;
}

/** True when invoking an action with this mode needs a person's approval. */
export function requiresApproval(mode: ActionMode): boolean {
  return mode.kind === "write" && mode.approval === "required";
}

/**
 * What a surface's wire format can carry, declared once by each surface that
 * projects the registry (the CLI's `action-invoke`, HTTP, MCP, WebMCP). The
 * surface contract proves each declaration by behaviour.
 */
export interface SurfaceWire {
  /** Whether a call on this wire has an envelope that can carry `approved`. */
  readonly carriesApproval: boolean;
}

/**
 * Whether a surface lists an action. The one rule is this: a surface whose
 * wire cannot carry approval leaves approval-required actions out, because a
 * call to one of them could never succeed there. A call by id still reaches
 * the invoke core, which refuses it with `approval_required`.
 */
export function listedOn(wire: SurfaceWire, mode: ActionMode): boolean {
  return wire.carriesApproval || !requiresApproval(mode);
}

/**
 * The input schema a surface publishes for a tool. MCP and WebMCP both need a
 * JSON Schema whose root is an object, so an action whose schema is anything
 * else is published as an object that takes no properties. One rule, so every
 * surface shows an agent the same schema for the same action.
 */
export function asObjectSchema(
  schema: unknown,
): { readonly type: "object" } & Record<string, unknown> {
  if (Predicate.isObject(schema) && schema.type === "object") {
    return { ...schema, type: "object" as const };
  }
  return { type: "object" as const, properties: {} };
}

/**
 * Services a native action handler may require. Provided as one merged Layer
 * at the invoke tip (`kbRuntimeLayer`); a handler that needs fewer of them
 * still assigns, because Effect's requirement channel is covariant.
 */
export type ActionHandlerEnv =
  | KbCtx
  | KbStore
  | KbIndexService
  | FileSystem
  | TemplateRegistry
  | ActionCatalog
  | SavedQueries
  | Assets;

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
export type ActionEffectHandler<R = ActionHandlerEnv> = (
  input: never,
) => Effect.Effect<unknown, ActionHandlerError, R>;

/**
 * The services every runtime can supply from its own store and index — no
 * filesystem, no workspace ports. An action whose handler requires only these
 * runs identically in the browser and on the server; the list of such actions
 * is `isomorphicActions` in `@kb/operations`, typed with this env so a
 * composition root that has nothing more can provide it without lying.
 */
export type IsomorphicActionEnv = KbCtx | KbStore | KbIndexService;

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

/**
 * The invocation envelope every surface that receives one as data decodes
 * through: the HTTP body of `POST /api/action` and the JSON of
 * `kb action-invoke`. A surface that builds invocations itself (MCP maps a
 * tool call, the CLI's verbs plan one) constructs this same shape. An absent
 * or `null` input is the empty input.
 *
 * `approved` is the caller's statement that a person approved this call. It
 * sits on the envelope, not in the input, because it is about the call and
 * not an argument to the action. A surface can pass approval only if its wire
 * format has an envelope around the input. HTTP and `action-invoke` do. An
 * MCP tool call does not: its arguments are the input. So through MCP, an
 * action whose mode requires approval gets an `approval_required` receipt.
 */
export const ActionInvocationSchema = z.object({
  id: z.string().min(1),
  input: z
    .unknown()
    .optional()
    .transform((input): unknown => input ?? {}),
  approved: z.boolean().optional(),
});
export type ActionInvocation = z.output<typeof ActionInvocationSchema>;

export const SucceededReceiptSchema = z.object({
  status: z.literal("succeeded"),
  id: z.string(),
  output: z.unknown(),
});

export const FailedReceiptSchema = z.object({
  status: z.literal("failed"),
  id: z.string(),
  code: FailureCodeSchema,
  message: z.string(),
  details: z.unknown().optional(),
});

export const ActionReceiptSchema = z.discriminatedUnion("status", [
  SucceededReceiptSchema,
  FailedReceiptSchema,
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

/**
 * One published action: its definition without the handlers, with both
 * schemas as JSON Schema. Every surface lists actions as these entries.
 */
export const ManifestEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  mode: ActionModeSchema,
  inputSchema: z.unknown(),
  outputSchema: z.unknown(),
  /** Present when this id is a compat alias for another registered id. */
  aliasOf: z.string().optional(),
});
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

export function actionToManifestEntry(def: ActionDefinition): ManifestEntry {
  return {
    id: def.id,
    title: def.title,
    description: def.description,
    mode: def.mode,
    inputSchema: schemaToJsonSchema(def.inputSchema, "input"),
    outputSchema: schemaToJsonSchema(def.outputSchema, "output"),
  };
}

/**
 * The manifest of the registry an invocation runs in, provided at the invoke
 * tip like the templates are. It is how `kb.manifest` lists the registry it is
 * itself a member of, without an action reaching the registry.
 */
export class ActionCatalog extends Context.Service<ActionCatalog, readonly ManifestEntry[]>()(
  "kb/ActionCatalog",
) {}
