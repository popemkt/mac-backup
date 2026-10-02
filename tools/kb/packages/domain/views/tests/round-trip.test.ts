/**
 * A slot reads back what it writes (`@kb/model`'s `SlotWrite`): the frame's
 * and the lens's tables hold that for every setting, so a setting is written
 * the way it is read, and nowhere else.
 */
import { describe, expect, test } from "bun:test";
import { SYSTEM_IDS, type PropValue } from "@kb/model";
import {
  DEFAULT_VIEW_CONFIG,
  decodeFrameConfig,
  decodeLensConfig,
  frameSettingWrite,
  parseViewFilterEdn,
  perspectiveProps,
  type LensPerspective,
  type ViewConfig,
} from "@kb/views";

function strict(): (warning: string) => void {
  return (warning) => {
    throw new Error(`reported: ${warning}`);
  };
}

const eq = parseViewFilterEdn('{:field status :eq "doing"}');
const text = parseViewFilterEdn('{:text "draft"}');

const CONFIGS: readonly ViewConfig[] = [
  DEFAULT_VIEW_CONFIG,
  {
    sort: [
      { fieldId: "f.status", dir: "desc" },
      { fieldId: SYSTEM_IDS.nodeTextField, dir: "asc" },
    ],
    display: ["f.status", "f.owner"],
    colwidth: { "f.status": 120 },
    pagesize: 25,
    groupFieldId: "f.status",
    filters: [eq, text].flatMap((f) => (f === null ? [] : [f])),
  },
];

/** What a frame's view node holds after each setting of `config` is written on its own. */
function propsOf(config: ViewConfig): Record<string, PropValue[]> {
  const props: Record<string, PropValue[]> = {};
  const write = (entries: Readonly<Record<string, readonly PropValue[]>>) => {
    for (const [field, values] of Object.entries(entries))
      if (values.length > 0) props[field] = [...values];
  };
  write(frameSettingWrite("sort", config.sort));
  write(frameSettingWrite("display", config.display));
  write(frameSettingWrite("colwidth", config.colwidth));
  write(frameSettingWrite("pagesize", config.pagesize));
  write(frameSettingWrite("groupFieldId", config.groupFieldId));
  write(frameSettingWrite("filters", config.filters));
  return props;
}

describe("slot round trips", () => {
  test("every frame setting reads back what it writes", () => {
    for (const config of CONFIGS)
      expect(decodeFrameConfig(propsOf(config), strict())).toEqual(config);
  });

  test("a perspective's props read back as its lens", () => {
    const perspective: LensPerspective = {
      id: "n.p",
      label: "P",
      query: "[:find ?id :where [?n :node/id ?id]]",
      renderer: "sys.view.graph.tree",
      colorBy: "tag",
      labelBy: "text",
      sizeBy: "degree",
      edgeKinds: [],
      maxNodes: 40,
      clusterBy: "parent",
      focus: "n.root",
      hops: 2,
      layout: "radial",
      spread: 90,
      linkDistance: 30,
      showLabels: false,
      autorotate: true,
      labelDensity: "high",
      theme: "matte",
      linkStyle: "straight",
    };
    const props = perspectiveProps(perspective);
    expect(props[SYSTEM_IDS.viewField]).toEqual([{ t: "ref", v: perspective.renderer }]);
    const { id: _id, label: _label, renderer: _renderer, ...lens } = perspective;
    const { renderer: hosted, ...read } = decodeLensConfig(props, strict());
    expect(read).toEqual(lens);
    // A graph view node's renderer is its view; it names no hosted renderer.
    expect(props[SYSTEM_IDS.lensRendererField]).toBeUndefined();
    expect(hosted).toBe("sys.view.graph.force2d");
  });
});
