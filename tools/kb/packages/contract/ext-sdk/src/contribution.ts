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
import { Predicate, Result, Schema } from "effect";
import {
  isActionMode,
  type ActionEffectHandler,
  type ActionMode,
  type ExtensionAction,
  type ExtensionContribution,
  type ExtensionDeclaration,
  type ExtensionPromiseHandler,
  type ExtensionTemplate,
  type TemplateFn,
} from "@kb/contracts";
import { KbNodeSchema, isActionSchema, type ActionSchema, type KbNode } from "@kb/model";

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

/** The contracts' one statement of the mode vocabulary, not a restatement of it. */
const ActionModeField = Schema.declare<ActionMode>(isActionMode, {
  title: "ActionMode",
  message: "must be an ActionMode (kb-ext-sdk)",
});

const ActionFields = {
  id: LocalId,
  title: Schema.String,
  description: Schema.String,
  mode: ActionModeField,
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
  const id = Predicate.hasProperty(value, "id") ? value.id : undefined;
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
    Predicate.hasProperty(value, "template") && Predicate.isFunction(value.template);

  const decoded: Result.Result<ExtensionAction | ExtensionTemplate, { message: string }> =
    isTemplate ? decodeTemplate(value) : decodeAction(value);

  return Result.isFailure(decoded)
    ? Result.fail(
        `${label(isTemplate ? "template" : "action", value)}: ${oneLine(decoded.failure.message)}`,
      )
    : Result.succeed(decoded.success);
}

type SeedFn = (at: string) => readonly KbNode[];

/**
 * A module's declaration, checked exactly: a key the contract does not have
 * (`views`, say, which a repository extension cannot provide) is refused
 * rather than ignored, so an author is never told it worked.
 */
const Declaration = Schema.Struct({
  name: LocalId,
  label: Schema.String,
  optional: Schema.optional(Schema.Struct({ byDefault: Schema.Literals(["on", "off"]) })),
  seed: Schema.optional(contributedFunction<SeedFn>("SeedFn")),
});

const decodeDeclarationFields = Schema.decodeUnknownResult(Declaration, {
  onExcessProperty: "error",
});

/** What a seed returns, checked as a store checks what it loads: the fold writes it to the store. */
const decodeSeedNodes = Schema.decodeUnknownSync(Schema.Array(KbNodeSchema));

/**
 * Decode an extension module's `declaration` export, for the module named
 * `name` (its file's name without `.ts`). Absent, it is the declaration of
 * that name alone. Its name must be the file's, which is its namespace and
 * names its node. Its seed is called by the fold, and each node it returns
 * is checked then, so a seed that returns something other than nodes
 * throws there, where its module is refused.
 */
export function decodeDeclaration(
  value: unknown,
  name: string,
): Result.Result<ExtensionDeclaration, string> {
  if (value === undefined) return Result.succeed({ name, label: name });
  const decoded = decodeDeclarationFields(value);
  if (Result.isFailure(decoded)) {
    return Result.fail(`declaration: ${oneLine(decoded.failure.message)}`);
  }
  const { seed, ...declared } = decoded.success;
  if (declared.name !== name) {
    return Result.fail(`declaration: its name ${declared.name} must be its file's, ${name}`);
  }
  return Result.succeed(
    seed === undefined
      ? declared
      : { ...declared, seed: (at: string) => decodeSeedNodes(seed(at)) },
  );
}
