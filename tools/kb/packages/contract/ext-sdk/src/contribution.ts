/**
 * What an extension module actually exported, decoded once.
 *
 * A contribution has two parts. The declarative part — ids, titles, mode,
 * schemas, aliases — is fully checkable at runtime, so `Schema` checks it. The
 * behavioural part is a function, and a function's *signature* is not
 * observable at runtime: `typeof x === "function"` is everything any check
 * could ever learn. So the signature is declared, not verified, in
 * {@link contributedFunction} — one place, with the SDK type carrying the shape
 * from there on. Every consumer downstream is statically typed and no call site
 * asserts anything.
 *
 * The decoded types are `@kb/contracts`' own, not a second copy: the registry
 * stores exactly what comes out of here.
 */
import { Result, Schema } from "effect";
import type {
  ActionEffectHandler,
  ExtensionAction,
  ExtensionContribution,
  ExtensionPromiseHandler,
  ExtensionTemplate,
  TemplateFn,
} from "@kb/contracts";
import { isActionSchema, type ActionSchema } from "@kb/model";

/** Local ids the registry namespaces as `ext.<file>.<id>`. */
const LOCAL_ID_RE = /^[\w][\w.-]*$/;

const LocalId = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((id: string) =>
      LOCAL_ID_RE.test(id) ? undefined : "must match /^[\\w][\\w.-]*$/",
    ),
  ),
);

/**
 * Optional *and* undefined-tolerant: a contribution built by spreading a
 * definition can carry `handler: undefined`, and the pre-Schema loader read
 * that as absent. `optionalKey` alone would reject it.
 */
const Aliases = Schema.optional(Schema.Array(Schema.String));

/**
 * The extension module boundary, trusted exactly once.
 *
 * A contributed handler or template is a function whose parameter and return
 * types no runtime check can see. Rather than assert the shape at each call
 * site, the SDK declares it here: the guard verifies what is verifiable, and
 * `T` is the contract the rest of kb compiles against.
 */
function contributedFunction<T extends (...args: never[]) => unknown>(
  title: string,
): Schema.declare<T> {
  return Schema.declare<T>((u): u is T => typeof u === "function", {
    title,
    message: `must be a function (${title})`,
  });
}

const EffectHandler = contributedFunction<ActionEffectHandler>("ActionEffectHandler");
const PromiseHandler = contributedFunction<ExtensionPromiseHandler>("ExtensionPromiseHandler");
const Template = contributedFunction<TemplateFn>("TemplateFn");

const ActionSchemaField = Schema.declare<ActionSchema>(isActionSchema, {
  title: "ActionSchema",
  message: "must be a Standard Schema v1 or zod schema",
});

const ActionFields = {
  id: LocalId,
  title: Schema.String,
  description: Schema.String,
  mode: Schema.Literals(["read", "apply"]),
  inputSchema: ActionSchemaField,
  outputSchema: ActionSchemaField,
  aliases: Aliases,
};

/**
 * An action contributes one handler or the other, which is a union rather than
 * a struct plus a "one of these is set" filter — the type says it, so no
 * consumer re-checks it.
 */
const ActionContribution = Schema.Union([
  Schema.Struct({
    ...ActionFields,
    effect: EffectHandler,
    handler: Schema.optional(PromiseHandler),
  }),
  Schema.Struct({
    ...ActionFields,
    handler: PromiseHandler,
    effect: Schema.optional(EffectHandler),
  }),
]);

const TemplateContribution = Schema.Struct({
  id: LocalId,
  aliases: Aliases,
  template: Template,
});

const decodeAction = Schema.decodeUnknownResult(ActionContribution);
const decodeTemplate = Schema.decodeUnknownResult(TemplateContribution);

/** True for the template arm of a decoded contribution. */
export function isTemplateContribution(
  contribution: ExtensionContribution,
): contribution is ExtensionTemplate {
  return "template" in contribution;
}

function label(kind: string, value: unknown): string {
  const id = typeof value === "object" && value !== null ? Reflect.get(value, "id") : undefined;
  return typeof id === "string" && id !== "" ? `${kind} ${id}` : kind;
}

/**
 * One line, for a warning the loader prints per contribution. A `Schema` issue
 * message is an indented tree, and a union reports the same problem once per
 * member, so the lines are flattened and de-duplicated.
 */
function oneLine(message: string): string {
  return [...new Set(message.split("\n").map((line) => line.trim()))]
    .filter((line) => line.length > 0)
    .join(" ");
}

/**
 * Decode one entry of an extension module's default-exported array.
 *
 * A contribution carrying a `template` function is a render template; anything
 * else is checked as an action. Discriminating here rather than in the loader
 * keeps the failure message about the thing the author was writing.
 */
export function decodeContribution(value: unknown): Result.Result<ExtensionContribution, string> {
  const isTemplate =
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "template") === "function";

  const decoded: Result.Result<ExtensionAction | ExtensionTemplate, { message: string }> =
    isTemplate ? decodeTemplate(value) : decodeAction(value);

  return Result.isFailure(decoded)
    ? Result.fail(
        `${label(isTemplate ? "template" : "action", value)}: ${oneLine(decoded.failure.message)}`,
      )
    : Result.succeed(decoded.success);
}
