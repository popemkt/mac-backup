/**
 * Wire nodes for contextual-reference tests: the seeded `#ref` ontology plus a
 * builder for one reference.
 *
 * Kept beside `fixtures/graph.ts` rather than inside it because
 * `fixtureGraph`'s tag list is asserted verbatim by unrelated suites — a shared
 * fixture that grows breaks tests that are about something else entirely.
 */
import type { WireNode } from "@kb/contracts";
import { SYSTEM_IDS } from "@/lib/types";

const ISO = "2026-08-08T05:00:00.000Z";

function wire(partial: Partial<WireNode> & Pick<WireNode, "id">): WireNode {
  return {
    text: "",
    props: {},
    children: [],
    createdAt: ISO,
    updatedAt: ISO,
    ...partial,
  };
}

/** Mirrors systemSeedNodes(): the #ref tag and the ref-typed target field. */
export const REF_SEED_WIRES: WireNode[] = [
  wire({
    id: SYSTEM_IDS.refTargetField,
    text: "ref.target",
    props: {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
      [SYSTEM_IDS.fieldTypeField]: [{ t: "ref", v: "sys.ft.ref" }],
    },
  }),
  wire({
    id: SYSTEM_IDS.refTag,
    text: "ref",
    props: {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
      [SYSTEM_IDS.fieldsField]: [{ t: "ref", v: SYSTEM_IDS.refTargetField }],
    },
  }),
];

/** One contextual reference: `#ref` + a target, plus any extra wire fields. */
export function ctxRefWire(
  id: string,
  targetId: string,
  extra: Partial<WireNode> = {},
): WireNode {
  return wire({
    id,
    props: {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.refTag }],
      [SYSTEM_IDS.refTargetField]: [{ t: "ref", v: targetId }],
    },
    ...extra,
  });
}
