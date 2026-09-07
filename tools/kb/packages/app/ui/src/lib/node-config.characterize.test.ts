/**
 * Characterization of the two node-backed config decoders.
 *
 * These are GOLDEN tests, not specifications: every expectation below was read
 * back from the decoders as they behaved before gaps
 * `01M1MGCEBYDFRNJX1JKXXN825H` / `01M1MGCJAKKST0C1R54VVX9HPX` were closed, so
 * the Schema that replaces the hand-written branches is measured against real
 * behaviour rather than against what the branches were meant to do.
 *
 * Two of the cases are the live store's own perspective node, one per committed
 * `.kb/nodes.jsonl`: the repo store holds a `{t:"ref"}` `lens.edge-kinds` that
 * names an ordinary node (a live edit captured in `87041e9`), and the kb store
 * still holds the pre-node `{t:"str"}` values (see g1's report). Both must
 * decode identically.
 */
import { describe, expect, it, vi } from "vitest";
import type { WireNode } from "@kb/contracts";
import { parsePerspective, type LensPerspective } from "@/lib/graph-lens";
import { getViewConfig, type ViewConfig } from "@/lib/view-config";
import { SYSTEM_IDS, type PropValue } from "@/lib/types";

const ISO = "2026-08-08T05:00:00.000Z";

function perspectiveNode(props: Record<string, PropValue[]>, text = "All mentions"): WireNode {
  return {
    id: "lens.all-mentions",
    text,
    props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.graphPerspectiveTag }], ...props },
    children: [],
    createdAt: ISO,
    updatedAt: ISO,
  };
}

/** Everything the decoder falls back to when a perspective carries no lens props. */
const ALL_DEFAULTS: LensPerspective = {
  id: "lens.all-mentions",
  label: "All mentions",
  query: "",
  renderer: "force2d",
  colorBy: "tag",
  labelBy: "text",
  sizeBy: "degree",
  edgeKinds: ["mention", "child"],
  maxNodes: 500,
  clusterBy: "parent",
  focus: null,
  layout: "force",
  spread: 150,
  linkDistance: 60,
  showLabels: true,
  curvedLinks: false,
  autorotate: false,
  labelDensity: "medium",
};

describe("parsePerspective — stored nodes", () => {
  it("decodes the repo store's `lens.all-mentions` (node-valued renderer + edge-kinds)", () => {
    // Verbatim from `.kb/nodes.jsonl` at this wave's base commit.
    const parsed = parsePerspective(
      perspectiveNode({
        "sys.f.lens.cluster-by": [{ t: "str", v: "parent" }],
        "sys.f.lens.edge-kinds": [{ t: "ref", v: "01M1TAM8J2JP70H63HH9P7E15J" }],
        "sys.f.lens.layout": [{ t: "str", v: "hierarchical" }],
        "sys.f.lens.max-nodes": [{ t: "num", v: 1000 }],
        "sys.f.lens.renderer": [{ t: "ref", v: "sys.graph.renderer.force2d" }],
      }),
    );
    expect(parsed).toEqual({
      ...ALL_DEFAULTS,
      clusterBy: "parent",
      edgeKinds: ["prop:01M1TAM8J2JP70H63HH9P7E15J"],
      layout: "hierarchical",
      maxNodes: 1000,
      renderer: "force2d",
    });
  });

  it("decodes the kb store's `lens.all-mentions` (pre-node string values)", () => {
    // Verbatim from `tools/kb/.kb/nodes.jsonl` at this wave's base commit.
    const parsed = parsePerspective(
      perspectiveNode({
        "sys.f.lens.cluster-by": [{ t: "str", v: "parent" }],
        "sys.f.lens.edge-kinds": [
          { t: "str", v: "mention" },
          { t: "str", v: "child" },
        ],
        "sys.f.lens.renderer": [{ t: "str", v: "force2d" }],
      }),
    );
    expect(parsed).toEqual({ ...ALL_DEFAULTS, clusterBy: "parent" });
  });

  it("falls back for every field when the node carries no lens props", () => {
    expect(parsePerspective(perspectiveNode({}))).toEqual(ALL_DEFAULTS);
  });

  it("labels an untitled perspective and trims the label", () => {
    expect(parsePerspective(perspectiveNode({}, "   ")).label).toBe("Untitled");
    expect(parsePerspective(perspectiveNode({}, "  Spaced  ")).label).toBe("Spaced");
  });
});

/** field id -> [stored values, expected decoded patch] for one-field cases. */
const LENS_CASES: [string, string, PropValue[], Partial<LensPerspective>][] = [
  [
    "query",
    SYSTEM_IDS.lensQueryField,
    [{ t: "str", v: "  [:find ?e]  " }],
    { query: "[:find ?e]" },
  ],
  ["query non-str", SYSTEM_IDS.lensQueryField, [{ t: "num", v: 3 }], { query: "" }],
  [
    "renderer unknown ref keeps the id",
    SYSTEM_IDS.lensRendererField,
    [{ t: "ref", v: "n.custom" }],
    { renderer: "n.custom" },
  ],
  [
    "renderer free-form string",
    SYSTEM_IDS.lensRendererField,
    [{ t: "str", v: "sankey" }],
    { renderer: "sankey" },
  ],
  ["renderer non-str", SYSTEM_IDS.lensRendererField, [{ t: "num", v: 3 }], { renderer: "force2d" }],
  [
    "colorBy source ref",
    SYSTEM_IDS.lensColorByField,
    [{ t: "ref", v: "sys.graph.source.parent" }],
    { colorBy: "parent" },
  ],
  [
    "colorBy user field ref becomes a prop key",
    SYSTEM_IDS.lensColorByField,
    [{ t: "ref", v: "field.team" }],
    { colorBy: "prop:field.team" },
  ],
  ["colorBy non-str", SYSTEM_IDS.lensColorByField, [{ t: "num", v: 3 }], { colorBy: "tag" }],
  [
    "colorBy reads the first value's carrier, then any str",
    SYSTEM_IDS.lensColorByField,
    [
      { t: "num", v: 1 },
      { t: "str", v: "fixed:#abcdef" },
    ],
    { colorBy: "fixed:#abcdef" },
  ],
  [
    "sizeBy source ref",
    SYSTEM_IDS.lensSizeByField,
    [{ t: "ref", v: "sys.graph.source.child-count" }],
    { sizeBy: "children" },
  ],
  [
    "labelBy source ref",
    SYSTEM_IDS.lensLabelByField,
    [{ t: "ref", v: "sys.graph.source.text" }],
    { labelBy: "text" },
  ],
  [
    "clusterBy source ref",
    SYSTEM_IDS.lensClusterByField,
    [{ t: "ref", v: "sys.graph.source.tags" }],
    { clusterBy: "tag" },
  ],
  ["edge kinds present but empty", SYSTEM_IDS.lensEdgeKindsField, [], { edgeKinds: [] }],
  [
    "edge kinds `none` sentinel",
    SYSTEM_IDS.lensEdgeKindsField,
    [{ t: "ref", v: "sys.graph.source.none" }],
    { edgeKinds: [] },
  ],
  [
    "edge kinds unknown entry",
    SYSTEM_IDS.lensEdgeKindsField,
    [{ t: "str", v: "bogus" }],
    { edgeKinds: [] },
  ],
  [
    "edge kinds keep recognised entries",
    SYSTEM_IDS.lensEdgeKindsField,
    [
      { t: "str", v: "mention" },
      { t: "num", v: 5 },
      { t: "ref", v: "field.depends" },
    ],
    { edgeKinds: ["mention", "prop:field.depends"] },
  ],
  ["maxNodes truncates", SYSTEM_IDS.lensMaxNodesField, [{ t: "num", v: 12.7 }], { maxNodes: 12 }],
  ["maxNodes zero", SYSTEM_IDS.lensMaxNodesField, [{ t: "num", v: 0 }], { maxNodes: 500 }],
  ["maxNodes negative", SYSTEM_IDS.lensMaxNodesField, [{ t: "num", v: -5 }], { maxNodes: 500 }],
  [
    "maxNodes as a string",
    SYSTEM_IDS.lensMaxNodesField,
    [{ t: "str", v: "50" }],
    { maxNodes: 500 },
  ],
  ["focus ref", SYSTEM_IDS.lensFocusField, [{ t: "ref", v: "n.a" }], { focus: "n.a" }],
  ["focus as a string", SYSTEM_IDS.lensFocusField, [{ t: "str", v: "n.a" }], { focus: null }],
  [
    "layout unknown",
    SYSTEM_IDS.lensLayoutField,
    [{ t: "str", v: "circular" }],
    { layout: "force" },
  ],
  ["layout grid", SYSTEM_IDS.lensLayoutField, [{ t: "str", v: "grid" }], { layout: "grid" }],
  ["layout non-str", SYSTEM_IDS.lensLayoutField, [{ t: "num", v: 1 }], { layout: "force" }],
  [
    "labelDensity unknown",
    SYSTEM_IDS.lensLabelDensityField,
    [{ t: "str", v: "ultra" }],
    { labelDensity: "medium" },
  ],
  [
    "labelDensity low",
    SYSTEM_IDS.lensLabelDensityField,
    [{ t: "str", v: "low" }],
    { labelDensity: "low" },
  ],
  ["spread zero", SYSTEM_IDS.lensSpreadField, [{ t: "num", v: 0 }], { spread: 150 }],
  ["spread fractional", SYSTEM_IDS.lensSpreadField, [{ t: "num", v: 12.5 }], { spread: 12.5 }],
  [
    "linkDistance negative",
    SYSTEM_IDS.lensLinkDistanceField,
    [{ t: "num", v: -1 }],
    { linkDistance: 60 },
  ],
  [
    "showLabels non-bool",
    SYSTEM_IDS.lensShowLabelsField,
    [{ t: "str", v: "false" }],
    { showLabels: true },
  ],
  [
    "showLabels false",
    SYSTEM_IDS.lensShowLabelsField,
    [{ t: "bool", v: false }],
    {
      showLabels: false,
    },
  ],
  [
    "curvedLinks true",
    SYSTEM_IDS.lensCurvedLinksField,
    [{ t: "bool", v: true }],
    {
      curvedLinks: true,
    },
  ],
  [
    "curvedLinks non-bool",
    SYSTEM_IDS.lensCurvedLinksField,
    [{ t: "str", v: "true" }],
    { curvedLinks: false },
  ],
  [
    "autorotate true",
    SYSTEM_IDS.lensAutorotateField,
    [{ t: "bool", v: true }],
    {
      autorotate: true,
    },
  ],
];

describe("parsePerspective — per-field carriers and fallbacks", () => {
  it.each(LENS_CASES)("%s", (_name, field, values, patch) => {
    expect(parsePerspective(perspectiveNode({ [field]: values }))).toEqual({
      ...ALL_DEFAULTS,
      ...patch,
    });
  });
});

/** Everything `getViewConfig` falls back to. */
const VIEW_DEFAULTS: ViewConfig = {
  mode: "list",
  sort: [],
  display: [],
  colwidth: {},
  pagesize: 100,
  groupFieldId: null,
  filters: [],
};

const VIEW_CASES: [string, Record<string, PropValue[]>, Partial<ViewConfig>][] = [
  ["no props", {}, {}],
  ["mode table", { [SYSTEM_IDS.viewModeField]: [{ t: "str", v: "table" }] }, { mode: "table" }],
  ["mode unknown", { [SYSTEM_IDS.viewModeField]: [{ t: "str", v: "kanban" }] }, { mode: "list" }],
  ["mode non-str", { [SYSTEM_IDS.viewModeField]: [{ t: "ref", v: "table" }] }, { mode: "list" }],
  [
    "sort pairs refs with dirs and defaults a missing dir to asc",
    {
      [SYSTEM_IDS.viewSortField]: [
        { t: "ref", v: "f1" },
        { t: "ref", v: "f2" },
      ],
      [SYSTEM_IDS.viewSortDirField]: [{ t: "str", v: "desc" }],
    },
    {
      sort: [
        { fieldId: "f1", dir: "desc" },
        { fieldId: "f2", dir: "asc" },
      ],
    },
  ],
  [
    "sort skips a non-ref entry but keeps the dir index",
    {
      [SYSTEM_IDS.viewSortField]: [
        { t: "str", v: "f1" },
        { t: "ref", v: "f2" },
      ],
      [SYSTEM_IDS.viewSortDirField]: [
        { t: "str", v: "desc" },
        { t: "str", v: "desc" },
      ],
    },
    { sort: [{ fieldId: "f2", dir: "desc" }] },
  ],
  [
    "display dedupes and drops non-refs",
    {
      [SYSTEM_IDS.viewDisplayField]: [
        { t: "ref", v: "f1" },
        { t: "ref", v: "f1" },
        { t: "str", v: "f2" },
        { t: "ref", v: "f3" },
      ],
    },
    { display: ["f1", "f3"] },
  ],
  [
    "colwidth JSON object",
    { [SYSTEM_IDS.viewColwidthField]: [{ t: "str", v: '{"f1":200,"f2":150}' }] },
    { colwidth: { f1: 200, f2: 150 } },
  ],
  ["colwidth bad JSON", { [SYSTEM_IDS.viewColwidthField]: [{ t: "str", v: "{bad" }] }, {}],
  ["colwidth array", { [SYSTEM_IDS.viewColwidthField]: [{ t: "str", v: "[1,2]" }] }, {}],
  ["colwidth non-str", { [SYSTEM_IDS.viewColwidthField]: [{ t: "num", v: 1 }] }, {}],
  ["pagesize num", { [SYSTEM_IDS.viewPagesizeField]: [{ t: "num", v: 50 }] }, { pagesize: 50 }],
  ["pagesize zero", { [SYSTEM_IDS.viewPagesizeField]: [{ t: "num", v: 0 }] }, {}],
  [
    "pagesize numeric string",
    { [SYSTEM_IDS.viewPagesizeField]: [{ t: "str", v: "25" }] },
    { pagesize: 25 },
  ],
  ["pagesize junk string", { [SYSTEM_IDS.viewPagesizeField]: [{ t: "str", v: "abc" }] }, {}],
  [
    "pagesize non-numeric carrier",
    { [SYSTEM_IDS.viewPagesizeField]: [{ t: "bool", v: true }] },
    {},
  ],
  [
    "group ref",
    { [SYSTEM_IDS.viewGroupField]: [{ t: "ref", v: "field.status" }] },
    { groupFieldId: "field.status" },
  ],
  ["group as a string", { [SYSTEM_IDS.viewGroupField]: [{ t: "str", v: "field.status" }] }, {}],
];

describe("getViewConfig — per-field carriers and fallbacks", () => {
  it("returns every default for absent props", () => {
    expect(getViewConfig(undefined)).toEqual(VIEW_DEFAULTS);
  });

  it.each(VIEW_CASES)("%s", (_name, props, patch) => {
    expect(getViewConfig(props)).toEqual({ ...VIEW_DEFAULTS, ...patch });
  });

  it("parses filter EDN and reports the clauses it cannot read", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const config = getViewConfig({
        [SYSTEM_IDS.viewFilterField]: [
          { t: "str", v: '{:field field.status :eq "doing"}' },
          { t: "str", v: "(not edn)" },
          { t: "str", v: '{:text "drift"}' },
        ],
      });
      expect(config.filters).toEqual([
        {
          kind: "eq",
          fieldId: "field.status",
          value: "doing",
          raw: '{:field field.status :eq "doing"}',
        },
        { kind: "text", text: "drift", raw: '{:text "drift"}' },
      ]);
    } finally {
      warn.mockRestore();
    }
  });
});
