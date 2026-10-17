/**
 * Typing a relation: saying what a connection between two nodes means, by
 * adding one ref prop of a chosen field from the source to the target. The
 * field node is the label, so a typed relation is an ordinary ref field and
 * nothing new is stored; the source's text, mention and all, is untouched.
 */
import { Result } from "effect";
import {
  cardinalityOf,
  relationFieldFit,
  relationMisfit,
  type DomainError,
  type KbNode,
  type NodeId,
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
 * target one it allows, and a person's own field, by the one rule every
 * relation reads (`relationFieldFit`, `@kb/model`); a single-valued field that already points elsewhere
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
  const fit = relationFieldFit(fieldNode, typing.target, nodes, runQuery);
  if (fit !== "fits")
    return refuse("invalid_input", relationMisfit(fit, typing.field, typing.target));
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
