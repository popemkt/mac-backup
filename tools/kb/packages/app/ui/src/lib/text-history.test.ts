import { describe, expect, it } from "vitest";
import { present } from "@kb/model";
import {
  TEXT_HISTORY_COALESCE_MS,
  emptyTextHistory,
  recordTextEdit,
  redoTextEdit,
  undoTextEdit,
} from "./text-history";

const s = (text: string, caret = text.length) => ({ text, caret });

describe("text history", () => {
  it("undoes a typing burst as one step and redoes it", () => {
    let h = recordTextEdit(emptyTextHistory, s("a"), 0);
    h = recordTextEdit(h, s("ab"), 10);
    h = recordTextEdit(h, s("abc"), 20);
    const undone = present(undoTextEdit(h, s("abcd")), "undo");
    expect(undone.state).toEqual(s("a"));
    const redone = present(redoTextEdit(undone.history, undone.state), "redo");
    expect(redone.state).toEqual(s("abcd"));
  });

  it("separates edits further apart than the coalescing window", () => {
    let h = recordTextEdit(emptyTextHistory, s("a"), 0);
    h = recordTextEdit(h, s("ab"), TEXT_HISTORY_COALESCE_MS + 1);
    const first = present(undoTextEdit(h, s("abc")), "undo");
    expect(first.state).toEqual(s("ab"));
    expect(present(undoTextEdit(first.history, first.state), "undo").state).toEqual(s("a"));
  });

  it("a new edit clears what could be redone, and an empty history does nothing", () => {
    const h = recordTextEdit(emptyTextHistory, s("a"), 0);
    const undone = present(undoTextEdit(h, s("ab")), "undo");
    const edited = recordTextEdit(undone.history, s("a"), 5000);
    expect(redoTextEdit(edited, s("ax"))).toBeNull();
    expect(undoTextEdit(emptyTextHistory, s(""))).toBeNull();
  });
});
