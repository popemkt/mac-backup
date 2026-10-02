/**
 * The view keys read their settings from props through the caller's report
 * sink: an unset prop is silent, a malformed one is reported and falls back.
 * The per-field carriers are characterised in the UI's node-config tests,
 * which drive these same decoders through the UI's log seam.
 */
import { describe, expect, test } from "bun:test";
import { Result } from "effect";
import { SYSTEM_IDS } from "@kb/model";
import {
  DEFAULT_VIEW_CONFIG,
  NeighbourhoodView,
  OutlineTableView,
  decodeFrameConfig,
  decodeLensConfig,
  paramsFromProps,
} from "@kb/views";

function collect(): { report: (w: string) => void; warnings: string[] } {
  const warnings: string[] = [];
  return { report: (w) => warnings.push(w), warnings };
}

describe("view config readers", () => {
  test("an unset frame decodes to the defaults and reports nothing", () => {
    const { report, warnings } = collect();
    expect(decodeFrameConfig(undefined, report)).toEqual(DEFAULT_VIEW_CONFIG);
    expect(warnings).toEqual([]);
  });

  test("a malformed lens prop is reported to the caller's sink and falls back", () => {
    const { report, warnings } = collect();
    const lens = decodeLensConfig(
      { [SYSTEM_IDS.lensLayoutField]: [{ t: "str", v: "spiral" }] },
      report,
    );
    expect(lens.layout).toBe("force");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(SYSTEM_IDS.lensLayoutField);
  });

  test("a key reads its params from props for the node it is shown for", () => {
    const { report } = collect();
    const table = paramsFromProps(
      OutlineTableView,
      { [SYSTEM_IDS.viewPagesizeField]: [{ t: "num", v: 25 }] },
      "n.frame",
      report,
    );
    expect(Result.getOrThrow(table).pagesize).toBe(25);
    const shownFor = paramsFromProps(NeighbourhoodView, {}, "n.host", report);
    expect(Result.getOrThrow(shownFor).root).toBe("n.host");
  });
});
