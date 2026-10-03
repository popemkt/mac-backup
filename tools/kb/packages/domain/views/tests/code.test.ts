/**
 * The code view's key: its settings are its code, run exactly as stored, and
 * its grant, and a view node holds them as two text props.
 */
import { describe, expect, test } from "bun:test";
import { Result } from "effect";
import { SYSTEM_IDS, canonicalJson, type NodeProps } from "@kb/model";
import { BUNDLED_DECLARATIONS } from "@kb/bundled";
import {
  CodeView,
  DEFAULT_GRANT,
  STARTER_CODE,
  paramsFromProps,
  viewNodeFor,
} from "../src/index.ts";

const quiet = () => {};
const CODE = '  kb.draw(["p", {}, "hi"]);\n';

describe("the code view", () => {
  test("is declared as code.view, its option sys.view.code.view", () => {
    const declared = BUNDLED_DECLARATIONS.flatMap((declaration) => declaration.views ?? []);
    expect(declared.map((view) => view.key)).toContain(CodeView);
    expect(CodeView.id).toBe("code.view");
    expect(CodeView.option).toBe("sys.view.code.view");
  });

  test("a view node holds its code untrimmed and its grant as canonical JSON", () => {
    const grant = { reads: "graph" as const, actions: ["node.update"] };
    const proposal = viewNodeFor(CodeView, { code: CODE, grant }, "n.host");
    if (Result.isFailure(proposal)) throw new Error(JSON.stringify(proposal.failure));
    expect(proposal.success.props[SYSTEM_IDS.codeField]).toEqual([{ t: "str", v: CODE }]);
    expect(proposal.success.props[SYSTEM_IDS.codeGrantField]).toEqual([
      { t: "str", v: canonicalJson(grant) },
    ]);
    expect(paramsFromProps(CodeView, proposal.success.props, "n.host", quiet)).toEqual(
      Result.succeed({ source: "n.host", code: CODE, grant }),
    );
  });

  test("its subject is its lens.focus, else the node it is shown for", () => {
    const props: NodeProps = {
      [SYSTEM_IDS.codeField]: [{ t: "str", v: CODE }],
      [SYSTEM_IDS.lensFocusField]: [{ t: "ref", v: "n.focus" }],
    };
    expect(paramsFromProps(CodeView, props, "n.host", quiet)).toEqual(
      Result.succeed({ source: "n.focus", code: CODE, grant: DEFAULT_GRANT }),
    );
  });

  test("holding nothing, it runs the starter under the default grant", () => {
    expect(paramsFromProps(CodeView, {}, null, quiet)).toEqual(
      Result.succeed({ code: STARTER_CODE, grant: DEFAULT_GRANT }),
    );
  });

  test("a grant that is not JSON is reported and the node cannot be read", () => {
    const reported: string[] = [];
    const props: NodeProps = { [SYSTEM_IDS.codeGrantField]: [{ t: "str", v: "{nope" }] };
    const params = paramsFromProps(CodeView, props, null, (w) => reported.push(w));
    expect(Result.isFailure(params)).toBe(true);
    expect(reported).toEqual([`${SYSTEM_IDS.codeGrantField} is not JSON`]);
  });

  test("a proposal is refused at the path of a grant it cannot hold", () => {
    const proposal = viewNodeFor(
      CodeView,
      { code: CODE, grant: { reads: "everything", actions: [] } },
      null,
    );
    expect(Result.isFailure(proposal)).toBe(true);
    if (Result.isFailure(proposal)) expect(proposal.failure[0]?.path).toEqual(["grant", "reads"]);
    expect(Result.isFailure(viewNodeFor(CodeView, { code: CODE }, null))).toBe(true);
    expect(
      Result.isFailure(
        viewNodeFor(CodeView, { code: CODE, grant: DEFAULT_GRANT, html: "<p>" }, null),
      ),
    ).toBe(true);
  });
});
