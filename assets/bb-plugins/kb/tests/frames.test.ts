// Which threads keep a live kb frame in the window: the recently shown ones, made once and never reordered.
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { KeptFrames } from "../lib/frames.ts";

describe("the threads that keep a kb frame", () => {
  test("a thread shown again keeps the frame it had, in the place it was made", () => {
    const kept = new KeptFrames(3);
    assert.deepEqual(kept.show("a"), []);
    assert.deepEqual(kept.show("b"), []);
    assert.deepEqual(kept.show("a"), []);
    assert.deepEqual(kept.made, ["a", "b"]);
    assert.equal(kept.has("a"), true);
  });

  test("past the limit, the least recently shown thread's frame goes, and the others do not move", () => {
    const kept = new KeptFrames(3);
    kept.show("a");
    kept.show("b");
    kept.show("c");
    kept.show("a");
    assert.deepEqual(kept.show("d"), ["b"]);
    assert.deepEqual(kept.made, ["a", "c", "d"]);
    assert.equal(kept.has("b"), false);
  });

  test("a thread whose panel shows kb now keeps its frame while another can go", () => {
    const kept = new KeptFrames(2);
    kept.show("a");
    kept.show("b");
    // a is shown in another pane: b, though more recent, is the one to go.
    assert.deepEqual(kept.show("c", new Set(["a", "c"])), ["b"]);
    assert.deepEqual(kept.made, ["a", "c"]);
  });

  test("when every frame is shown now, none goes, past the limit or not", () => {
    const kept = new KeptFrames(1);
    kept.show("a");
    assert.deepEqual(kept.show("b", new Set(["a", "b"])), []);
    assert.deepEqual(kept.made, ["a", "b"]);
  });
});
