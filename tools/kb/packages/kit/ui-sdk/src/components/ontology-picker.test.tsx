import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OntologyPicker } from "./ontology-picker";

describe("OntologyPicker", () => {
  const items = [
    { id: "o.1", label: "Infrastructure" },
    { id: "o.2", label: "Notes" },
  ];

  it("shows the active label and a listbox trigger", () => {
    const html = renderToStaticMarkup(
      createElement(OntologyPicker, {
        ontologies: items,
        activeId: "o.2",
        onSelect: () => {},
      }),
    );
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-label="Ontology"');
    expect(html).toContain("Notes");
  });

  it("falls back to the placeholder and disables when there is nothing to pick", () => {
    const html = renderToStaticMarkup(
      createElement(OntologyPicker, {
        ontologies: [],
        activeId: null,
        onSelect: () => {},
        placeholder: "all nodes",
      }),
    );
    expect(html).toContain("all nodes");
    expect(html).toContain("disabled");
  });
});
