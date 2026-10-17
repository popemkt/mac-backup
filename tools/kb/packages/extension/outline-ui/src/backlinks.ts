import { isSysPrefixed, relationInverseOf } from "@kb/model";
import { queryBacklinks, rowText, type KbIndex, type SchemaIndex, type TagBadge } from "@kb/ui-sdk";

/**
 * A typed relation the referrer holds to the node, worded from the node's
 * side: the field's inverse label when it names one ("influenced by"),
 * else its own label read toward the node ("influences →").
 */
interface BacklinkRelation {
  field: string;
  label: string;
}

export interface BacklinkRow {
  id: string;
  text: string;
  tags: TagBadge[];
  /** The ref fields the referrer points here through; none when it only mentions the node. */
  relations: BacklinkRelation[];
}

/**
 * Nodes that reference `nodeId`, resolved to rows ready to render.
 *
 * The query itself belongs to the query seam (`@kb/ui-sdk`) — one owner for "what references X" — and
 * this is the layer above it that the References section consumes, so the seam
 * keeps one set of callers instead of gaining a component.
 *
 * Text comes from the referring node, read from the schema so a referrer
 * outside the current scope is still named, under the same display rule as an
 * outline row: a referrer whose own text is empty is a contextual reference,
 * and would otherwise render as a blank line.
 */
export function backlinkRows(
  index: KbIndex | null,
  schema: SchemaIndex,
  nodeId: string,
): BacklinkRow[] {
  if (index === null) return [];
  return queryBacklinks(index, nodeId)
    .filter((b) => b.id !== nodeId)
    .map((b) => {
      // The referrer's own text is schema-level too: a referrer outside the
      // scope is still a node, and a contextual one shows its target's text.
      const node = schema.get(b.id);
      return {
        id: b.id,
        text: node ? rowText(node, schema) : b.text,
        tags: node?.tags ?? [],
        relations: node ? relationsTo(node.props, nodeId, schema) : [],
      };
    });
}

/**
 * The typed relations `props` hold to `nodeId`: each non-system field with
 * a ref to it, labelled as {@link BacklinkRelation} says. A system field
 * (a tag, a view) is scaffolding, not a relation a person named.
 */
function relationsTo(
  props: Readonly<Record<string, readonly { t: string; v: unknown }[]>>,
  nodeId: string,
  schema: SchemaIndex,
): BacklinkRelation[] {
  return Object.entries(props).flatMap(([field, values]) => {
    if (isSysPrefixed(field) || !values.some((v) => v.t === "ref" && v.v === nodeId)) return [];
    const fieldNode = schema.get(field);
    const inverse = relationInverseOf(fieldNode);
    return [{ field, label: inverse ?? `${fieldNode?.text ?? field} →` }];
  });
}
