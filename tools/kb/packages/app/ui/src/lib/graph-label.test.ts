import { describe, expect, it } from "vitest";
import { fitGraphLabel, wrapGraphLabel, graphDisplayText } from "./graph-label";
const measure = (text: string) =>
  Array.from(text).reduce((width, char) => width + (char === "W" ? 12 : 6), 0);
describe("graph label space", () => {
  it("keeps meaningful ordinary labels independent of node size", () => {
    expect(fitGraphLabel("Knowledge relationships", measure)).toBe("Knowledge relationships");
  });
  it("fits measured glyph widths without cutting Unicode codepoints", () => {
    const label = fitGraphLabel("WWWWWWWWWWWWWWWWWWWWWWWW", measure, 70);
    expect(measure(label)).toBeLessThanOrEqual(70);
    expect(label.endsWith("…")).toBe(true);
    expect(fitGraphLabel("🌱🌱🌱🌱", () => 100, 20)).toBe("…");
  });
  it("wraps tree labels without losing text", () => {
    const text = "A useful relationship between two ideas and one extraordinarilylongword";
    const lines = wrapGraphLabel(text, measure, 110);
    expect(lines.every((line) => measure(line) <= 110)).toBe(true);
    expect(lines.join("").replace(/\s/g, "")).toBe(text.replace(/\s/g, ""));
  });
});

it("graph text displays reference labels and resolves bare references without exposing ids", () => {
  expect(
    graphDisplayText("See [[n.topic|Topic]] and [[n.other]]", (id) =>
      id === "n.other" ? "**Other idea**" : undefined,
    ),
  ).toBe("See Topic and Other idea");
  expect(graphDisplayText("")).toBe("Untitled");
});
