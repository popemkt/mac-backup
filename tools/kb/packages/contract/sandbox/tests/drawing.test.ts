import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { drawingToDom, drawingToHtml, sanitizeDrawing } from "../src/index.ts";

const html = (drawing: unknown, max = 1000) => drawingToHtml(sanitizeDrawing(drawing, max).nodes);

describe("a drawing", () => {
  test("is text, elements with attributes, and lists of drawings", () => {
    expect(html(["div", { class: "card" }, "hello ", ["strong", {}, 2], [null, false, "!"]])).toBe(
      '<div class="card">hello <strong>2</strong>!</div>',
    );
    expect(html(["p", "no attrs"])).toBe("<p>no attrs</p>");
    expect(html(["br"])).toBe("<br>");
  });

  test("escapes every text run and attribute value", () => {
    expect(html(["p", { title: '"><script>' }, "<img src=x onerror=alert(1)>"])).toBe(
      '<p title="&quot;&gt;&lt;script&gt;">&lt;img src=x onerror=alert(1)&gt;</p>',
    );
  });

  test("drops every element that can run script, load or navigate, with its subtree", () => {
    for (const tag of [
      "script",
      "iframe",
      "img",
      "a",
      "form",
      "object",
      "embed",
      "link",
      "meta",
      "style",
      "base",
      "foreignObject",
      "use",
      "image",
    ]) {
      const report = sanitizeDrawing(["div", {}, [tag, { src: "https://evil.example" }, "x"]], 100);
      expect(drawingToHtml(report.nodes)).toBe("<div></div>");
      expect(report.dropped).toContain(`<${tag}>`);
    }
  });

  test("drops handlers, URLs, and styles that reach outside", () => {
    const report = sanitizeDrawing(
      [
        "div",
        {
          onclick: "alert(1)",
          OnMouseOver: "x",
          href: "https://evil.example",
          src: "x",
          action: "x",
          formaction: "x",
          style: "background:url(https://evil.example/leak)",
          "data-ok": "1",
          "data-bad": "url(https://x)",
          title: "javascript:alert(1)",
        },
      ],
      100,
    );
    expect(drawingToHtml(report.nodes)).toBe('<div data-ok="1"></div>');
    expect(html(["div", { style: "color: red; \\75rl(x)" }])).toBe("<div></div>");
    expect(html(["div", { style: "color: red" }])).toBe('<div style="color: red"></div>');
  });

  test("keeps SVG, its local paint references, and refuses outside ones", () => {
    expect(
      html(["svg", { viewBox: "0 0 10 10" }, ["rect", { width: 5, height: 5, fill: "url(#g)" }]]),
    ).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5" height="5" fill="url(#g)"></rect></svg>',
    );
    expect(html(["svg", {}, ["rect", { fill: "url(https://evil.example/p.svg#g)" }]])).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect></rect></svg>',
    );
  });

  test("keeps controls that fetch nothing", () => {
    expect(html(["input", { type: "checkbox", checked: true, id: "c" }])).toBe(
      '<input type="checkbox" checked="" id="c">',
    );
    expect(html(["input", { type: "image" }])).toBe("<input>");
    expect(html(["button", { type: "submit" }, "go"])).toBe("<button>go</button>");
  });

  test("is cut short at its node bound and nesting bound, and never throws", () => {
    const many = ["div", {}, ...Array.from({ length: 50 }, (_, i) => ["span", {}, String(i)])];
    const report = sanitizeDrawing(many, 10);
    expect(report.truncated).toBe(true);
    let deep: unknown = "leaf";
    for (let i = 0; i < 200; i++) deep = ["div", {}, deep];
    expect(() => sanitizeDrawing(deep, 10_000)).not.toThrow();
    for (const odd of [undefined, {}, () => 1, Symbol("s"), [{}], [1, 2]]) {
      expect(() => sanitizeDrawing(odd, 100)).not.toThrow();
    }
  });

  test("builds the same tree as DOM nodes, element by element", () => {
    const window = new Window();
    const doc = window.document;
    const nodes = sanitizeDrawing(
      ["div", { id: "d" }, "a", ["svg", {}, ["circle", { r: 2 }]]],
      100,
    ).nodes;
    const root = doc.createElement("main");
    for (const child of drawingToDom(doc, nodes)) root.appendChild(child);
    expect(root.innerHTML).toBe('<div id="d">a<svg><circle r="2"></circle></svg></div>');
    expect(root.querySelector("circle")?.namespaceURI).toBe("http://www.w3.org/2000/svg");
    window.close();
  });
});
