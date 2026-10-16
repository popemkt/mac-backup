/**
 * A slot reads back what it writes (`@kb/model`'s `SlotWrite`): the frame's
 * table holds that for every setting, so a setting is written the way it is
 * read, and nowhere else. The graph lens's table is held to it in
 * `@kb/graph`'s `lens.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { SYSTEM_IDS, type PropValue } from "@kb/model";
import {
  DEFAULT_VIEW_CONFIG,
  decodeFrameConfig,
  frameSettingWrite,
  parseViewFilterEdn,
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
});
