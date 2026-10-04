/**
 * A docs view's settings are its key's params (`DocsMarkdownView`): exactly
 * one subject, a template and a repo-relative output, each refused at its
 * path when a node cannot be read as one.
 */
import { describe, expect, test } from "bun:test";
import { Result } from "effect";
import { SYSTEM_IDS, docsViewProps, type KbNode, type NodeProps } from "@kb/model";
import {
  DocsMarkdownView,
  docsSpecOf,
  docsViewNamed,
  docsViewsOf,
  issueText,
  paramsIssues,
} from "@kb/views";

function read(props: NodeProps) {
  return paramsIssues(
    DocsMarkdownView,
    DocsMarkdownView.config.read(props, null, () => {}),
  );
}

function problems(props: NodeProps): string[] {
  const result = read(props);
  return Result.isFailure(result) ? result.failure.map(issueText) : [];
}

describe("docs.markdown", () => {
  test("a docs view node's props read back as its spec", () => {
    const spec = {
      query: "[:find ?id :where [?n :node/id ?id]]",
      template: "todos",
      output: "a.md",
    };
    expect(Result.map(read(docsViewProps(spec)), docsSpecOf)).toEqual(Result.succeed(spec));
    const saved = { savedQuery: "open", template: "todos", output: "docs/b.md" };
    expect(Result.map(read(docsViewProps(saved)), docsSpecOf)).toEqual(Result.succeed(saved));
  });

  test("a missing setting is named by its path", () => {
    expect(problems({ [SYSTEM_IDS.lensQueryField]: [{ t: "str", v: "[:find ?id]" }] })).toEqual([
      "template: Missing key",
      "output: Missing key",
    ]);
  });

  test("a subject is exactly one of a query and a saved query", () => {
    const both = {
      ...docsViewProps({ query: "[:find ?id]", template: "t", output: "a.md" }),
      [SYSTEM_IDS.viewSavedQueryField]: [{ t: "str" as const, v: "open" }],
    };
    expect(problems(both)).toEqual(["needs exactly one of a query and a saved query"]);
  });

  test("an output that leaves the repo is refused", () => {
    const out = docsViewProps({ query: "[:find ?id]", template: "t", output: "../a.md" });
    expect(problems(out)).toEqual(["output: Expected a repo-relative path without .."]);
  });
});

describe("the docs views a graph holds", () => {
  const AT = "2026-10-04T00:00:00.000Z";
  function viewNode(id: string, text: string, props: KbNode["props"]): KbNode {
    return { id, text, props, children: [], createdAt: AT, updatedAt: AT };
  }
  const spec = { query: "[:find ?id :where [?n :node/id ?id]]", template: "todos", output: "a.md" };
  const nodes = [
    viewNode("v.b", "b", docsViewProps(spec)),
    viewNode("v.a", "a", docsViewProps({ ...spec, output: "b.md" })),
    viewNode("v.bare", "bare", {
      [SYSTEM_IDS.viewField]: docsViewProps(spec)[SYSTEM_IDS.viewField] ?? [],
    }),
  ];

  test("every readable one is a view, by name; each unreadable one is a warning", () => {
    const { views, warnings } = docsViewsOf(nodes);
    expect(views.map((view) => [view.name, view.id, view.spec.output])).toEqual([
      ["a", "v.a", "b.md"],
      ["b", "v.b", "a.md"],
    ]);
    expect(warnings).toEqual(["view bare is invalid: template: Missing key; output: Missing key"]);
  });

  test("a name is its view, or why it cannot be read, or not found", () => {
    expect(Result.map(docsViewNamed(nodes, "a"), (view) => view.id)).toEqual(Result.succeed("v.a"));
    const bare = docsViewNamed(nodes, "bare");
    expect(Result.isFailure(bare) && bare.failure.code).toBe("invalid_input");
    const ghost = docsViewNamed(nodes, "ghost");
    expect(Result.isFailure(ghost) && ghost.failure).toEqual({
      code: "not_found",
      message: "view not found: ghost",
      details: { name: "ghost" },
    });
  });
});
