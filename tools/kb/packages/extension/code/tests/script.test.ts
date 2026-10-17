/**
 * A script is a node: its code and grant in the code view's fields, named
 * on the node it runs for by `sys.f.scripts`.
 */
import { describe, expect, test } from "bun:test";
import { SYSTEM_IDS, canonicalJson } from "@kb/model";
import { CODE_IDS, DEFAULT_GRANT, scriptIdsOf, scriptOf } from "@kb/code";

const str = (v: string) => [{ t: "str" as const, v }];
/** Tagged `#script`, as every script is. */
const TAGGED = { [SYSTEM_IDS.typeField]: [{ t: "ref" as const, v: CODE_IDS.scriptTag }] };

describe("scripts", () => {
  test("a node names its scripts in order", () => {
    const host = {
      props: {
        [CODE_IDS.scriptsField]: [
          { t: "ref" as const, v: "s1" },
          { t: "ref" as const, v: "s2" },
        ],
      },
    };
    expect(scriptIdsOf(host)).toEqual(["s1", "s2"]);
    expect(scriptIdsOf({ props: {} })).toEqual([]);
  });

  test("a script runs its code as stored, under its grant or the default", () => {
    const grant = { reads: "subject" as const, actions: ["ext.canvas.place"] };
    const code = "  kb.on('canvas.page', () => {});\n";
    expect(
      scriptOf({
        id: "s",
        text: "Badges",
        props: {
          ...TAGGED,
          [CODE_IDS.codeField]: str(code),
          [CODE_IDS.codeGrantField]: str(canonicalJson(grant)),
        },
      }),
    ).toEqual({ id: "s", label: "Badges", code, grant });
    expect(
      scriptOf({ id: "s", text: "", props: { ...TAGGED, [CODE_IDS.codeField]: str("x()") } }),
    ).toEqual({
      id: "s",
      label: "s",
      code: "x()",
      grant: DEFAULT_GRANT,
    });
  });

  test("a node not tagged #script, with no code, or with a grant that is none, is no script", () => {
    expect(scriptOf({ id: "s", text: "", props: { [CODE_IDS.codeField]: str("x()") } })).toBeNull();
    expect(scriptOf({ id: "s", text: "", props: TAGGED })).toBeNull();
    expect(
      scriptOf({
        id: "s",
        text: "",
        props: {
          ...TAGGED,
          [CODE_IDS.codeField]: str("x()"),
          [CODE_IDS.codeGrantField]: str('{"reads":"all"}'),
        },
      }),
    ).toBeNull();
  });
});
