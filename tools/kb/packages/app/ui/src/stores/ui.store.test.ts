import { describe, expect, it } from "vitest";
import { TOAST_LIMIT, withToast, type Toast } from "./ui.store";

function push(toasts: readonly Toast[], id: number, text: string, kind: Toast["kind"] = "error") {
  return withToast(toasts, { id, kind, text });
}

describe("toast list (closing audit P2-5)", () => {
  it("does not stack a message already on screen: it moves to newest with a count", () => {
    let toasts = push([], 1, "That node is not visible in this outline");
    toasts = push(toasts, 2, "something else");
    toasts = push(toasts, 3, "That node is not visible in this outline");
    expect(toasts.map((t) => [t.id, t.text, t.count])).toEqual([
      [2, "something else", 1],
      [3, "That node is not visible in this outline", 2],
    ]);
  });

  it("tells an error and an info with the same text apart", () => {
    const toasts = push(push([], 1, "saved", "info"), 2, "saved", "error");
    expect(toasts).toHaveLength(2);
  });

  it("keeps only the newest few", () => {
    let toasts: Toast[] = [];
    for (let i = 1; i <= TOAST_LIMIT + 2; i++) toasts = push(toasts, i, `message ${i}`);
    expect(TOAST_LIMIT).toBe(3);
    expect(toasts.map((t) => t.id)).toEqual([3, 4, 5]);
  });
});
