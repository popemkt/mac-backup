import { Result, Schema } from "effect";
import type { NodeId, PropValue } from "./model.ts";

/**
 * Node-backed configuration: how a node's props become a typed config object.
 *
 * A graph perspective and a view frame are the same kind of thing — a node
 * whose props configure a projection — so they decode through one mechanism
 * rather than one hand-written branch per field. What a config declares is a
 * table of {@link ConfigSlot}s; {@link decodeNodeConfig} folds that table over
 * a props record.
 *
 * Two questions are kept apart, and that separation is the whole design:
 *
 * - **Which stored values does this slot read?** A carrier question, answered
 *   by the slot's reader ({@link firstStr} and friends). kb props are
 *   multi-valued and untyped per value, so "the first `num` value of
 *   `lens.max-nodes`" is a projection, not a validation.
 * - **Is what it read a legal value?** A validity question, answered by an
 *   Effect `Schema`. The schema is the one home of the legal shape, and the
 *   slot names the value used when the store has none — so a default is stated
 *   once, beside the shape it defaults to.
 *
 * A prop the store never carried is *unset*: the fallback applies silently. A
 * prop that is present and unreadable is *malformed*: the fallback applies and
 * the decode reports it, the way `resolveOntology` reports a definition it had
 * to ignore. Nothing throws — a bad prop must never make a view unopenable.
 *
 * Props are multi-valued, so a slot is one of two constructors:
 * {@link oneOf} for a field read as a single value, {@link manyOf} for a field
 * whose every value contributes. A `manyOf` element that decodes to `null`
 * contributes nothing *on purpose* — that is how a documented sentinel (the
 * `none` source option in `lens.edge-kinds`) says "explicitly empty" without
 * being reported as malformed.
 */

/** A node's props as both `KbNode` and the wire node carry them. */
export type NodeProps = Readonly<Record<NodeId, readonly PropValue[]>>;

/** What one slot produced: a value, plus anything it had to ignore. */
interface SlotDecode<A> {
  readonly value: A;
  readonly warnings: readonly string[];
}

/**
 * One decodable slot of a node-backed config. Built by {@link oneOf} or
 * {@link manyOf}; `fields` is public so a caller can ask which field nodes a
 * config reads without decoding one.
 */
export interface ConfigSlot<A> {
  readonly fields: readonly NodeId[];
  readonly decode: (props: NodeProps) => SlotDecode<A>;
}

/**
 * Any schema whose decoded type is `A`. Only the decode direction is used, so
 * what the schema encodes to is deliberately unconstrained — the structural
 * constraint `decodeUnknownResult` itself asks for.
 */
type SlotSchema<A> = Schema.ConstraintDecoder<A>;

/** A schema's decoder, with its failure reduced to the message a warning shows. */
function messageOf<A>(schema: SlotSchema<A>): (candidate: unknown) => Result.Result<A, string> {
  const decode = Schema.decodeUnknownResult(schema);
  return (candidate) => {
    const result = decode(candidate);
    return Result.isSuccess(result)
      ? Result.succeed(result.success)
      : Result.fail(result.failure.message);
  };
}

function anyPresent(props: NodeProps, fields: readonly NodeId[]): boolean {
  return fields.some((field) => props[field] !== undefined);
}

/**
 * A field read as one value.
 *
 * `read` returns `undefined` for "nothing this slot can use", which covers
 * both an absent field and a field carrying only values of another type. The
 * two are told apart by `fields`: absent is silent, present-but-unreadable is
 * reported.
 */
export function oneOf<A>(spec: {
  readonly fields: readonly NodeId[];
  readonly read: (props: NodeProps) => unknown;
  readonly schema: SlotSchema<A>;
  readonly fallback: A;
}): ConfigSlot<A> {
  const decode = messageOf(spec.schema);
  return {
    fields: spec.fields,
    decode: (props) => {
      const candidate = spec.read(props);
      const result = candidate === undefined ? Result.fail("no readable value") : decode(candidate);
      if (Result.isSuccess(result)) return { value: result.success, warnings: [] };
      if (!anyPresent(props, spec.fields)) return { value: spec.fallback, warnings: [] };
      return {
        value: spec.fallback,
        warnings: [`${spec.fields.join(" + ")} ignored: ${result.failure}`],
      };
    },
  };
}

/**
 * A field whose every value contributes one element.
 *
 * A present-but-empty field is a legal empty result, not an unset one: the
 * graph panel writes exactly that to mean "no edge kinds". `read` therefore
 * returns `undefined` only when the field is absent. An element decoding to
 * `null` is dropped without a warning — the sentinel case.
 */
export function manyOf<E>(spec: {
  readonly fields: readonly NodeId[];
  readonly read: (props: NodeProps) => readonly unknown[] | undefined;
  readonly schema: SlotSchema<E | null>;
  readonly fallback: readonly E[];
}): ConfigSlot<E[]> {
  const decode = messageOf(spec.schema);
  return {
    fields: spec.fields,
    decode: (props) => {
      const candidates = spec.read(props);
      if (candidates === undefined) return { value: [...spec.fallback], warnings: [] };
      const value: E[] = [];
      const warnings: string[] = [];
      candidates.forEach((candidate, index) => {
        const result = decode(candidate);
        if (Result.isFailure(result)) {
          warnings.push(`${spec.fields.join(" + ")}[${index}] ignored: ${result.failure}`);
          return;
        }
        if (result.success !== null) value.push(result.success);
      });
      return { value, warnings };
    },
  };
}

/** A config's slot table: one slot per output key. */
export type ConfigSlots<T> = { readonly [K in keyof T]-?: ConfigSlot<T[K]> };

/**
 * A decoded node config: a typed reader over the slot table, plus every
 * present prop the decode had to ignore.
 *
 * `slot` rather than a finished object, because a mapped-type product cannot
 * be assembled from `Object.entries` without an unchecked assertion — and the
 * caller listing its keys is what makes TypeScript prove the config is
 * complete. Each call decodes that slot; slots are pure, and a slot decode is
 * one scalar schema decode.
 */
export interface DecodedConfig<T> {
  readonly slot: <K extends keyof T>(key: K) => T[K];
  /** Non-fatal, and complete: collected over every slot, not only those read. */
  readonly warnings: readonly string[];
}

/**
 * Decode a node-backed config from a props record.
 *
 * Total: every slot yields either its decoded value or its declared fallback,
 * and every fallback taken over a prop that *is* present is reported.
 */
export function decodeNodeConfig<T extends object>(
  slots: ConfigSlots<T>,
  props: NodeProps | undefined,
): DecodedConfig<T> {
  const from = props ?? {};
  return {
    slot: (key) => slots[key].decode(from).value,
    warnings: Object.values<ConfigSlot<unknown>>(slots).flatMap(
      (slot) => slot.decode(from).warnings,
    ),
  };
}

/*
 * Carrier readers.
 *
 * Each answers "which stored value does this slot read", never "is it legal".
 * `firstStr` trims: whitespace around a stored string is carrier noise, and an
 * all-whitespace value reads as the empty string, which several slots treat as
 * a legitimate value (an empty `lens.query` means "all nodes").
 */

export const firstStr =
  (field: NodeId) =>
  (props: NodeProps): string | undefined =>
    props[field]?.find((p) => p.t === "str")?.v.trim();

export const firstNum =
  (field: NodeId) =>
  (props: NodeProps): number | undefined =>
    props[field]?.find((p) => p.t === "num")?.v;

export const firstBool =
  (field: NodeId) =>
  (props: NodeProps): boolean | undefined =>
    props[field]?.find((p) => p.t === "bool")?.v;

export const firstRef =
  (field: NodeId) =>
  (props: NodeProps): NodeId | undefined =>
    props[field]?.find((p) => p.t === "ref")?.v;

/** Every stored value of a field, or `undefined` when the field is absent. */
export const allValues =
  (field: NodeId) =>
  (props: NodeProps): readonly PropValue[] | undefined =>
    props[field];
