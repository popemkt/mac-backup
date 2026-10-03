import type { WireNode } from "@kb/contracts";
import { frameViewNodeId, viewOptionId } from "@kb/model";
import { SYSTEM_IDS } from "@/lib/types";
import { bundledSeed } from "@kb/bundled";

const at = "2026-09-06T00:00:00.000Z";

const SEED = new Map(bundledSeed(at).map((seed) => [seed.id, seed]));

function seeded(id: string) {
  const seed = SEED.get(id);
  if (seed === undefined) throw new Error(`view fixture names an unseeded node: ${id}`);
  return seed;
}

/** A view field as the seed declares it — its value type included — minus its option children. */
function field(id: string): WireNode {
  const seed = seeded(id);
  return { id, text: id, props: seed.props, children: [], createdAt: at, updatedAt: at };
}

/** A seeded list with its option children, as the seed declares them. */
function tree(id: string): WireNode[] {
  const seed = seeded(id);
  return [
    {
      id,
      text: seed.text,
      props: seed.props,
      children: seed.children,
      createdAt: at,
      updatedAt: at,
    },
    ...seed.children.flatMap(tree),
  ];
}

/**
 * The view options as the seed declares them, each carrying its family: what
 * says a view node's view is a frame view (`familyViewIdOf`).
 */
export const viewOptionNodes = [...tree(SYSTEM_IDS.viewFamilyField), ...tree(SYSTEM_IDS.viewsRoot)];

/**
 * Field nodes required by synthetic graphs that exercise view mutations, with
 * the view options a frame's view node names and the Views list it is filed in.
 */
export const viewFieldNodes = [
  ...[
    SYSTEM_IDS.viewField,
    SYSTEM_IDS.viewsField,
    SYSTEM_IDS.viewSortField,
    SYSTEM_IDS.viewSortDirField,
    SYSTEM_IDS.viewDisplayField,
    SYSTEM_IDS.viewColwidthField,
    SYSTEM_IDS.viewPagesizeField,
    SYSTEM_IDS.viewGroupField,
    SYSTEM_IDS.viewFilterField,
    SYSTEM_IDS.nodeTextField,
    SYSTEM_IDS.lensRendererField,
  ].map(field),
  ...viewOptionNodes,
  { ...field(SYSTEM_IDS.viewsList), text: "Views" },
];

/** A frame view, by the name its key goes by in the outline plugin. */
export type FrameViewName = "list" | "table" | "board" | "cards";

/**
 * `frame` shown as `view` with `settings`, the way a store holds it: the
 * frame names its view node first in `sys.f.views`, and the view node names
 * the view and carries the settings as its params. Returns the frame, then
 * its view node.
 */
export function framedAs<N extends WireNode>(
  frame: N,
  view: FrameViewName,
  settings: WireNode["props"] = {},
): [N, WireNode] {
  const id = frameViewNodeId(frame.id);
  return [
    { ...frame, props: { ...frame.props, [SYSTEM_IDS.viewsField]: [{ t: "ref", v: id }] } },
    {
      id,
      text: "",
      props: {
        [SYSTEM_IDS.viewField]: [{ t: "ref", v: viewOptionId(`outline.${view}`) }],
        ...settings,
      },
      children: [],
      createdAt: at,
      updatedAt: at,
    },
  ];
}
