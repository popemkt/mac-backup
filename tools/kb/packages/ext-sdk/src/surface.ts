/**
 * Public type surface for external `.kb/extensions/*.ts` authors.
 *
 * Self-contained (no Effect/zod imports) so `scripts/gen-ext-sdk.ts` can emit
 * a standalone ambient `declare module "kb-ext-sdk"` that travels inside the
 * CLI bundle. Internal runtime types must stay assignable to these shapes —
 * see `tests/ext-sdk-fresh.test.ts`.
 *
 * Authors: `kb ext sdk --write`, then
 * `import type { ExtensionAction, ExtensionTemplate } from "kb-ext-sdk"`.
 * Prefer Promise `handler`s; the `effect` branch is typed for completeness
 * but Effect v4 remains an internal/bundled concern.
 */

export type ActionMode = "read" | "apply";

export type FailureCode =
  | "not_found"
  | "invalid_input"
  | "ambiguous"
  | "conflict"
  | "invalid_move"
  | "forbidden"
  | "internal"
  | "unknown_action";

/** Node identity: ULID, or reserved `sys.*` system ids. */
export type NodeId = string;

export type PropValue =
  | { t: "str"; v: string }
  | { t: "num"; v: number }
  | { t: "bool"; v: boolean }
  | { t: "date"; v: string }
  | { t: "ref"; v: NodeId };

export interface KbNode {
  id: NodeId;
  text: string;
  props: Record<NodeId, PropValue[]>;
  children: NodeId[];
  createdAt: string;
  updatedAt: string;
}

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
    ) => StandardSchemaV1Result<Output> | Promise<StandardSchemaV1Result<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output };
  };
}

export interface ParsableSchema {
  readonly parse: (input: unknown) => unknown;
}

/** Accept Standard Schema v1 or any object exposing `.parse` (zod). */
export type ActionSchema = StandardSchemaV1Like | ParsableSchema;

/**
 * Opaque Effect-shaped handler. External authors should use Promise
 * {@link ExtensionPromiseHandler} instead.
 */
export type ActionEffectHandler = (input: never) => unknown;

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
  effect?: ActionEffectHandler;
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

/**
 * Promise-handler session view. Structural subset of the live KbContext —
 * enough for authors to read `root` / `nodes` without importing core.
 */
export interface KbContext {
  root: string;
  nodes: KbNode[];
}

export type ExtensionPromiseHandler = (ctx: KbContext, input: never) => Promise<unknown>;

export type ExtensionAction = ActionDefinition & {
  /** Extra top-level ids this action also answers to (compat shims). */
  aliases?: readonly string[];
} & (
    | {
        effect: ActionEffectHandler;
        handler?: ExtensionPromiseHandler;
      }
    | {
        handler: ExtensionPromiseHandler;
        effect?: ActionEffectHandler;
      }
  );

/**
 * Render templates: named functions (query rows -> markdown) that a view
 * spec (`.kb/views/<name>.json`) references by id. Contributed exactly like
 * an action — same default-exported array, same `ext.<file>.<id>`
 * namespacing, same optional bare-id `aliases`. Must be deterministic.
 */
export interface TemplateContext {
  nodes: Map<NodeId, KbNode>;
  /** Unique-text lookup among sys.field nodes; undefined if absent or ambiguous. */
  fieldIdByName(name: string): NodeId | undefined;
}

export type TemplateFn = (rows: unknown[][], ctx: TemplateContext) => string;

export interface ExtensionTemplate {
  /** Local id; the registry namespaces it as `ext.<file>.<id>`. */
  id: string;
  /** Extra top-level ids this template also answers to (compat shims). */
  aliases?: readonly string[];
  template: TemplateFn;
}

/** One entry of an extension module's default-exported array. */
export type ExtensionContribution = ExtensionAction | ExtensionTemplate;

export interface LoadedExtension {
  /** File basename without `.ts`; becomes the `ext.<name>.` namespace. */
  name: string;
  /** "bundled" or the absolute path of the source module. */
  source: string;
  /** Actions as authored (ids still local, un-namespaced). */
  actions: readonly ExtensionAction[];
  /** Templates as authored (ids still local, un-namespaced). */
  templates: readonly ExtensionTemplate[];
}

export interface ExtensionFailure {
  file: string;
  error: string;
}
