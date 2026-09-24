import { isSysPrefixed, systemSeedNodes } from "@kb/model";

const LEAF_IDS = Array.from({ length: 28 }, (_, index) => `render.fixture.node.${index + 1}`);
const ROOT_ID = "render.fixture.root";
const PERSPECTIVE_ID = "lens.all-mentions";

/**
 * Every node the perspective's lens sees: the fixture's leaves, root and
 * perspective, plus each non-system node the seed adds when the scratch store
 * opens (today the Pinned list). Derived from the seed, not counted by hand,
 * because the lens has no way to tell a seeded node from a fixture one.
 */
const LENS_IDS = new Set([
  ...LEAF_IDS,
  ROOT_ID,
  PERSPECTIVE_ID,
  ...systemSeedNodes()
    .map((seeded) => seeded.id)
    .filter((id) => !isSysPrefixed(id)),
]);

export const FIXTURE_SIZE = LENS_IDS.size;

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
 * The perspective is intentionally part of its own lens: it remains editable
 * when renderer switching persists to this scratch data root. Its `max-nodes`
 * is the lens population, so no spec runs against a capped graph.
 */
export function renderFixtureNodes(): FixtureNode[] {
  const leaves = LEAF_IDS.map((id, index) =>
    node(id, `Fixture node ${index + 1} [[${ROOT_ID}|fixture root]]`, [], {}),
  );

  return [
    node(ROOT_ID, "Fixture root", LEAF_IDS),
    ...leaves,
    // Preserve the seed id so opening the scratch root does not add a second
    // default perspective beside this fixture.
    node(PERSPECTIVE_ID, "Render fixture", [], {
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
