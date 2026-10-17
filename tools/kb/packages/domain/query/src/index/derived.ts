import { extractMentions, type KbNode, type NodeId, type PropValue } from "@kb/model";

/**
 * The ref attributes the datom build derives from a node, beside the ones a
 * node states (its id, text, children and props): each is one entry of one
 * table (`CORE_DERIVED`), named once with its cardinality and fed by the
 * carriers declared for it. The build reads only the table, so a new way of
 * pointing at a node is a carrier added to an entry, and a new derived
 * relation is an entry — never a second pass beside the build.
 *
 * `:node/mentions` is THE reference relation — "this node references that
 * one" — and it is carrier-independent by design. A question about the
 * relation ("what references X?" — `kb backlinks`, the UI's References
 * section) never has to remember which carrier was used; asking twice and
 * unioning at every call site is the second `if` on one distinction that
 * Rule 1 forbids. The carrier distinction survives only where it is
 * genuinely a lens: the graph's `mention` / `ref-prop` edge kinds, which
 * label provenance and scan text and props separately for exactly that
 * reason.
 */

/** One way a node points at other nodes: the ids it names, resolvable or not, in order. */
interface RefCarrier {
  /** What the carrier is, for a reader of the table: `text-tokens`, `ref-props`, … */
  readonly id: string;
  readonly refsOf: (node: KbNode) => Iterable<NodeId>;
}

/**
 * A ref attribute derived at build: one datom per (node, target that
 * exists) from every carrier feeding it, deduplicated, so the attribute
 * reads the same whichever carrier produced a reference.
 */
export interface DerivedRef {
  readonly attr: `:node/${string}`;
  readonly cardinality: "one" | "many";
  readonly carriers: readonly RefCarrier[];
}

/**
 * Every id a node mentions in text: `[[id]]` tokens in its own text and in
 * each text (`{t:"str"}`) value it holds. A token is a mention wherever the
 * text lives — a text field's value is written, rendered and followed exactly
 * like node text, so it references exactly like node text. In order, with
 * repeats (a caller that wants a set dedupes).
 */
export function nodeMentions(node: Pick<KbNode, "text" | "props">): NodeId[] {
  const out = extractMentions(node.text);
  for (const values of Object.values(node.props)) {
    for (const pv of values) if (pv.t === "str") out.push(...extractMentions(pv.v));
  }
  return out;
}

/** A `[[id]]` token in text, the node's own or a text value's (`nodeMentions`). */
const TEXT_TOKENS: RefCarrier = { id: "text-tokens", refsOf: nodeMentions };

/** A `{t:"ref"}` prop value, in any field. */
const REF_PROPS: RefCarrier = {
  id: "ref-props",
  refsOf: (node) =>
    Object.values(node.props).flatMap((values) =>
      values.flatMap((pv) => (pv.t === "ref" ? [pv.v] : [])),
    ),
};

/** The derived ref attributes every index builds: the reference relation, fed by text and ref props. */
export const CORE_DERIVED: readonly DerivedRef[] = [
  { attr: ":node/mentions", cardinality: "many", carriers: [TEXT_TOKENS, REF_PROPS] },
];

/**
 * A field whose values carry references a family knows how to read, beyond
 * `[[id]]` tokens and ref values: a canvas document's cards, say. A family
 * declares it (`ExtensionDeclaration.refCarriers`), and the reference
 * relation reads it as one more carrier.
 */
export interface FieldRefCarrier {
  readonly field: NodeId;
  /** The node ids one of the field's values points at; none for a value it cannot read. */
  readonly refsOf: (value: PropValue) => Iterable<NodeId>;
}

/** `carrier` as a node's carrier: what each of its values in the field points at. */
function fieldCarrier({ field, refsOf }: FieldRefCarrier): RefCarrier {
  return {
    id: `field:${field}`,
    refsOf: (node) => (node.props[field] ?? []).flatMap((value) => [...refsOf(value)]),
  };
}

/** `CORE_DERIVED` with the reference relation also fed by each of `fields` (`FieldRefCarrier`). */
export function derivedWith(fields: readonly FieldRefCarrier[]): readonly DerivedRef[] {
  return CORE_DERIVED.map((entry) =>
    entry.attr === ":node/mentions"
      ? { ...entry, carriers: [...entry.carriers, ...fields.map(fieldCarrier)] }
      : entry,
  );
}
