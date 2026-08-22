/**
 * r1 D10 — pure vertical-arrow decisions. Layout probes are injected, so
 * these run without a real rendering engine.
 */
import { describe, expect, it } from "vitest";
import { verticalArrowDecision } from "@/components/outline/caret";

describe("verticalArrowDecision (D10)", () => {
  it("crosses up only when the caret is on the first visual line", () => {
    expect(
      verticalArrowDecision({
        key: "ArrowUp",
        geometry: { onFirstLine: true, onLastLine: false, x: 120 },
      }),
    ).toEqual({ kind: "cross", direction: -1, x: 120 });

    expect(
      verticalArrowDecision({
        key: "ArrowUp",
        geometry: { onFirstLine: false, onLastLine: true, x: 80 },
      }),
    ).toEqual({ kind: "within" });
  });

  it("crosses down only when the caret is on the last visual line", () => {
    expect(
      verticalArrowDecision({
        key: "ArrowDown",
        geometry: { onFirstLine: false, onLastLine: true, x: null },
      }),
    ).toEqual({ kind: "cross", direction: 1, x: null });

    expect(
      verticalArrowDecision({
        key: "ArrowDown",
        geometry: { onFirstLine: true, onLastLine: false, x: null },
      }),
    ).toEqual({ kind: "within" });
  });

  it("single-line rows always cross in both directions", () => {
    const geo = { onFirstLine: true, onLastLine: true, x: 42 };
    expect(verticalArrowDecision({ key: "ArrowUp", geometry: geo })).toEqual({
      kind: "cross",
      direction: -1,
      x: 42,
    });
    expect(verticalArrowDecision({ key: "ArrowDown", geometry: geo })).toEqual({
      kind: "cross",
      direction: 1,
      x: 42,
    });
  });
});
