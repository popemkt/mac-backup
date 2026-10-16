import type { WireNode } from "@kb/contracts";
import { SYSTEM_IDS } from "@kb/ui-sdk";

const ISO = "2026-08-23T00:00:00.000Z";

export function node(
  id: string,
  text: string,
  props: WireNode["props"] = {},
  children: string[] = [],
): WireNode {
  return { id, text, props, children, createdAt: ISO, updatedAt: ISO };
}

/** The tag the ontology `o.1` includes. */
const TAG = "t.svc";

function tagged(id: string, text: string, children: string[] = []): WireNode {
  return node(id, text, { [SYSTEM_IDS.typeField]: [{ t: "ref", v: TAG }] }, children);
}

/**
 * One ontology over one tag:
 *
 *   #svc: n.a (child n.b, child n.out) and n.b
 *   n.out / n.other: untagged, not members
 *   o.1 "Services" includes #svc
 */
export function ontologyWire(): WireNode[] {
  return [
    node(TAG, "service", {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
    }),
    tagged("n.a", "alpha", ["n.b", "n.out"]),
    tagged("n.b", "beta"),
    node("n.out", "outsider"),
    node("n.other", "unrelated"),
    node("o.1", "Services", {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.ontologyTag }],
      [SYSTEM_IDS.ontoIncludeField]: [{ t: "ref", v: TAG }],
    }),
  ];
}

/** A second ontology over the same tag, to switch scopes between. */
export function secondOntology(): WireNode {
  return node("o.2", "Services again", {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.ontologyTag }],
    [SYSTEM_IDS.ontoIncludeField]: [{ t: "ref", v: TAG }],
  });
}

/** An ontology that extends itself and holds unparsable EDN. */
export function brokenOntology(): WireNode {
  return node("o.bad", "Broken", {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.ontologyTag }],
    [SYSTEM_IDS.ontoExtendsField]: [{ t: "ref", v: "o.bad" }],
    [SYSTEM_IDS.ontoQueryField]: [{ t: "str", v: "[:find ?id :where" }],
  });
}
