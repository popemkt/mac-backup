/**
 * Typing a relation: saying what a connection between two nodes means, by
 * adding one ref prop of a chosen field from the source to the target. The
 * field node is the label, so a typed relation is an ordinary ref field and
 * nothing new is stored; the source's text, mention and all, is untouched.
 */
import { Result } from "effect";
import {
  allowedRefIdsOf,
  cardinalityOf,
  fieldTypeOf,
  isSysPrefixed,
  SYSTEM_IDS,
  type DomainError,
  type KbNode,
  type NodeId,
  type NodeLike,
} from "@kb/model";

export interface RelationTyping {
  readonly source: NodeId;
  readonly target: NodeId;
  readonly field: NodeId;
}

/** Why a relation cannot be typed. */
export interface RelationRefusal {
  readonly code: Extract<DomainError["code"], "not_found" | "invalid_input" | "conflict">;
  readonly message: string;
}

function refuse(
  code: RelationRefusal["code"],
  message: string,
): Result.Result<never, RelationRefusal> {
  return Result.fail({ code, message });
}

/**
 * The source as typing the relation leaves it, or null when it already
 * holds it (typing is idempotent). The field must be a ref field, and the
 * target one it allows, by the one resolver every ref slot reads
 * (`allowedRefIdsOf`); a single-valued field that already points elsewhere
 * is a conflict, never silently replaced.
 */
export function typedRelation(
  nodes: ReadonlyMap<NodeId, KbNode>,
  typing: RelationTyping,
  runQuery: (edn: string) => unknown[][],
  at: string,
): Result.Result<KbNode | null, RelationRefusal> {
  const source = nodes.get(typing.source);
  if (source === undefined) return refuse("not_found", `node not found: ${typing.source}`);
  if (!nodes.has(typing.target)) return refuse("not_found", `node not found: ${typing.target}`);
  const fieldNode = nodes.get(typing.field);
  if (fieldNode === undefined) return refuse("not_found", `field not found: ${typing.field}`);
  const fit = fieldFit(fieldNode, typing.target, nodes, runQuery);
  if (fit === "not-ref")
    return refuse("invalid_input", `${typing.field} is not a ref field, so it types no relation`);
  if (fit === "not-allowed")
    return refuse("invalid_input", `${typing.field} does not allow ${typing.target} as a target`);
  const held = source.props[typing.field] ?? [];
  if (held.some((value) => value.t === "ref" && value.v === typing.target))
    return Result.succeed(null);
  if (cardinalityOf(fieldNode.props) === "one" && held.length > 0)
    return refuse(
      "conflict",
      `${typing.field} holds one value, and ${typing.source} already has it`,
    );
  return Result.succeed({
    ...source,
    props: { ...source.props, [typing.field]: [...held, { t: "ref", v: typing.target }] },
    updatedAt: at,
  });
}

/**
 * Whether `fieldNode` can type a relation to `target`: it must be a ref
 * field, and allow the target by the one resolver every ref slot reads.
 */
function fieldFit(
  fieldNode: NodeLike,
  target: NodeId,
  nodes: ReadonlyMap<NodeId, NodeLike>,
  runQuery: (edn: string) => unknown[][],
): "fits" | "not-ref" | "not-allowed" {
  if (fieldTypeOf(fieldNode.props) !== "ref") return "not-ref";
  const allowed = allowedRefIdsOf(fieldNode, nodes, runQuery);
  return allowed === null || allowed.has(target) ? "fits" : "not-allowed";
}

// GAP [[01M545DD34TP58TEN1Z6MC7ASJ]] canvas and graph each read which ref fields a relation can be typed as
/**
 * The fields a person may type a relation to `target` as: every ref field
 * of theirs (not a system one) that allows it, by text. What a "Link as…"
 * picker offers, held to the rules `typedRelation` writes by.
 */
export function relationFieldsFor<N extends NodeLike>(
  nodes: ReadonlyMap<NodeId, N>,
  target: NodeId,
  runQuery: (edn: string) => unknown[][],
): N[] {
  return [...nodes.values()]
    .filter(
      (node) =>
        !isSysPrefixed(node.id) &&
        (node.props[SYSTEM_IDS.typeField] ?? []).some(
          (value) => value.t === "ref" && value.v === SYSTEM_IDS.field,
        ) &&
        fieldFit(node, target, nodes, runQuery) === "fits",
    )
    .toSorted((a, b) => a.text.localeCompare(b.text) || a.id.localeCompare(b.id));
}
