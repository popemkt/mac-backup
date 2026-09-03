import { describe, expect, test } from "vitest";
import {
  cancelLabelEdit,
  commitLabelEdit,
  startLabelEdit,
  typeLabelDraft,
} from "./shape-label-edit";

describe("shape label edit draft", () => {
  test("start seeds draft from baseline", () => {
    expect(startLabelEdit("Prior")).toEqual({
      editing: true,
      draft: "Prior",
      baseline: "Prior",
    });
  });

  test("typing updates draft only — no persist signal", () => {
    let s = startLabelEdit("Prior");
    s = typeLabelDraft(s, "Drafted");
    expect(s.draft).toBe("Drafted");
    expect(s.baseline).toBe("Prior");
  });

  test("Esc cancel restores baseline and never yields persist", () => {
    let s = startLabelEdit("Prior");
    s = typeLabelDraft(s, "Drafted");
    s = cancelLabelEdit(s);
    expect(s).toEqual({
      editing: false,
      draft: "Prior",
      baseline: "Prior",
    });
  });

  test("Enter/blur commit persists only when draft changed", () => {
    let s = startLabelEdit("Prior");
    s = typeLabelDraft(s, "Committed");
    const changed = commitLabelEdit(s);
    expect(changed.persist).toBe("Committed");
    expect(changed.state.editing).toBe(false);

    const noop = commitLabelEdit(startLabelEdit("Same"));
    expect(noop.persist).toBeNull();
  });
});
