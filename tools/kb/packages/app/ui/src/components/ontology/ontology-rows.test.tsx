/**
 * Prop-driven render checks (react-dom/server). Store-coupled rendering lives
 * in ontology-page.component.test.tsx: store hooks resolve zustand's INITIAL
 * state inside React's server renderer, so anything reading the store needs a
 * real DOM (same split as query-results vs instance-identity).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MemberRow } from "@/components/ontology/member-row";
import { OntologyScopeBar } from "@/components/ontology/ontology-scope-bar";

describe("MemberRow", () => {
  it("joins multiple reasons and shows the pin state", () => {
    const html = renderToStaticMarkup(
      createElement(MemberRow, {
        row: {
          id: "n.1",
          label: "tailscaled",
          reasons: [
            { kind: "tag", via: "t.svc" },
            { kind: "member" },
            { kind: "extends", via: "o.parent" },
          ],
          pinned: true,
        },
        labelOf: (id: string) =>
          id === "t.svc" ? "service" : id === "o.parent" ? "Networking" : id,
      }),
    );
    expect(html).toContain("via #service · pinned · via ⬡ Networking");
    expect(html).toContain("Unpin tailscaled");
    expect(html).toContain("Exclude tailscaled");
  });

  it("says the node keeps its tags when excluding a derived member", () => {
    const html = renderToStaticMarkup(
      createElement(MemberRow, {
        row: {
          id: "n.1",
          label: "beta",
          reasons: [{ kind: "tag", via: "t.svc" }],
          pinned: false,
        },
        labelOf: () => "service",
      }),
    );
    expect(html).toContain("Exclude here only — the node keeps its tags");
  });
});

describe("OntologyScopeBar", () => {
  it("shows identity, count, and an exit path", () => {
    const html = renderToStaticMarkup(
      createElement(OntologyScopeBar, {
        ontologyId: "o.1",
        label: "Infrastructure",
        memberCount: 412,
        warnings: [],
        view: "page",
        onExit: () => {},
      }),
    );
    expect(html).toContain("Infrastructure");
    expect(html).toContain("412 members");
    expect(html).toContain("Exit");
    expect(html).not.toContain("data-ontology-warnings");
  });

  it("uses the singular for one member and badges warnings", () => {
    const html = renderToStaticMarkup(
      createElement(OntologyScopeBar, {
        ontologyId: "o.1",
        label: "Infrastructure",
        memberCount: 1,
        warnings: ["extends cycle ignored: a → b → a"],
        view: "graph",
        onExit: () => {},
      }),
    );
    expect(html).toContain("1 member<");
    expect(html).toContain('data-ontology-warnings="1"');
  });
});
