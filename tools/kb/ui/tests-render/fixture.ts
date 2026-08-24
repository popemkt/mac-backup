// 28 leaves + a root + the editable perspective + its cluster tag = 31.
// This remains intentionally “~30” while keeping the tag materialised.
export const FIXTURE_SIZE = 31;
export const FIXTURE_CLUSTER_TAG = "sys.tag.render-fixture";

type PropValue = { t: "str" | "ref" | "num"; v: string | number };

export interface FixtureNode {
  id: string;
  text: string;
  children: string[];
  order: string;
  props: Record<string, PropValue[]>;
  createdAt: string;
  updatedAt: string;
}

const TIMESTAMP = "2026-08-24T00:00:00.000Z";

function node(
  id: string,
  text: string,
  children: string[] = [],
  props: Record<string, PropValue[]> = {},
): FixtureNode {
  return {
    id,
    text,
    children,
    order: id,
    props,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };
}

/**
 * A stable graph with one large tagged cluster and 29 child edges. The
 * perspective is intentionally part of the ~30-node lens: it remains editable
 * when renderer switching persists to this scratch data root.
 */
export function renderFixtureNodes(): FixtureNode[] {
  const leafIds = Array.from(
    { length: 28 },
    (_, index) => `render.fixture.node.${index + 1}`,
  );
  const rootId = "render.fixture.root";
  const leaves = leafIds.map((id, index) =>
    node(
      id,
      `Fixture node ${index + 1} [[${rootId}|fixture root]]`,
      [],
      { "sys.f.type": [{ t: "ref", v: FIXTURE_CLUSTER_TAG }] },
    ),
  );

  return [
    node(FIXTURE_CLUSTER_TAG, "render-fixture", [], {
      "sys.f.type": [{ t: "ref", v: "sys.tag" }],
    }),
    node(rootId, "Fixture root", leafIds),
    ...leaves,
    node("render.fixture.perspective", "Render fixture", [], {
      "sys.f.type": [{ t: "ref", v: "sys.tag.graph-perspective" }],
      "sys.f.lens.renderer": [{ t: "str", v: "force2d" }],
      "sys.f.lens.edge-kinds": [
        { t: "str", v: "mention" },
        { t: "str", v: "child" },
      ],
      "sys.f.lens.cluster-by": [
        { t: "str", v: `tag:${FIXTURE_CLUSTER_TAG}` },
      ],
      "sys.f.lens.max-nodes": [{ t: "num", v: FIXTURE_SIZE }],
    }),
  ];
}
