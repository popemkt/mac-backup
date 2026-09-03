// 28 leaves + a root + the editable perspective.
export const FIXTURE_SIZE = 30;

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
 * A stable single-cluster graph with 29 child edges. Keeping `cluster-by` at
 * `none` matches the production failure that used to collapse ForceGraph3D.
 * The perspective is intentionally part of the ~30-node lens: it remains editable
 * when renderer switching persists to this scratch data root.
 */
export function renderFixtureNodes(): FixtureNode[] {
  const leafIds = Array.from({ length: 28 }, (_, index) => `render.fixture.node.${index + 1}`);
  const rootId = "render.fixture.root";
  const leaves = leafIds.map((id, index) =>
    node(id, `Fixture node ${index + 1} [[${rootId}|fixture root]]`, [], {}),
  );

  return [
    node(rootId, "Fixture root", leafIds),
    ...leaves,
    // Preserve the seed id so opening the scratch root does not add a second
    // default perspective beside this fixture.
    node("lens.all-mentions", "Render fixture", [], {
      "sys.f.type": [{ t: "ref", v: "sys.tag.graph-perspective" }],
      "sys.f.lens.renderer": [{ t: "str", v: "force2d" }],
      "sys.f.lens.edge-kinds": [
        { t: "str", v: "mention" },
        { t: "str", v: "child" },
      ],
      "sys.f.lens.cluster-by": [{ t: "str", v: "none" }],
      "sys.f.lens.max-nodes": [{ t: "num", v: FIXTURE_SIZE }],
    }),
  ];
}
