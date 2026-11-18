// Which threads keep a live kb frame in the window: the recently shown ones, made once and never reordered.
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { KeptFrames, ThreadTabs } from "../lib/frames.ts";

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

describe("each thread's store and session in the window", () => {
  const A = { name: "a", page: "https://a.example" };
  const B = { name: "b", page: "https://b.example" };
  const tabsWith = () => {
    const tabs = new ThreadTabs();
    tabs.configure({ stores: [A, B], defaultStore: "a" });
    return tabs;
  };

  test("a pick holds before its frame says a session, and the old frame's session never pairs with it", () => {
    const tabs = tabsWith();
    const frameA = tabs.frameOf("t")!;
    tabs.setSession("t", frameA, "sess.a");
    assert.deepEqual(tabs.tab("t"), { store: "a", session: "sess.a" });
    assert.equal(tabs.choose("t", "b"), true);
    // B is still loading (or failed to): the agent's store is B, in no session.
    assert.deepEqual(tabs.tab("t"), { store: "b", session: null });
    // A late message from A's frame does not count for B.
    assert.equal(tabs.setSession("t", frameA, "sess.a2"), false);
    assert.deepEqual(tabs.tab("t"), { store: "b", session: null });
    tabs.setSession("t", tabs.frameOf("t")!, "sess.b");
    assert.deepEqual(tabs.tab("t"), { store: "b", session: "sess.b" });
  });

  test("a reload keeps the store and drops the session until the new frame says one", () => {
    const tabs = tabsWith();
    tabs.choose("t", "b");
    const before = tabs.frameOf("t")!;
    tabs.setSession("t", before, "sess.b");
    tabs.reload("t");
    assert.deepEqual(tabs.tab("t"), { store: "b", session: null });
    assert.equal(tabs.setSession("t", before, "sess.old"), false);
    assert.equal(tabs.setSession("t", tabs.frameOf("t")!, "sess.b2"), true);
    assert.equal(tabs.sessionOf("t"), "sess.b2");
  });

  test("a config change of the default or a page is a new frame, so the old session goes with it", () => {
    const tabs = tabsWith();
    tabs.setSession("t", tabs.frameOf("t")!, "sess.a");
    tabs.configure({ stores: [A, B], defaultStore: "b" });
    assert.deepEqual(tabs.tab("t"), { store: "b", session: null });
    tabs.setSession("t", tabs.frameOf("t")!, "sess.b");
    tabs.configure({ stores: [A, { name: "b", page: "https://b2.example" }], defaultStore: "b" });
    assert.deepEqual(tabs.tab("t"), { store: "b", session: null });
  });

  test("a pick of a store no longer configured falls back to the default", () => {
    const tabs = tabsWith();
    tabs.choose("t", "b");
    tabs.configure({ stores: [A], defaultStore: "a" });
    assert.deepEqual(tabs.tab("t"), { store: "a", session: null });
    tabs.configure({ stores: [], defaultStore: null });
    assert.equal(tabs.tab("t"), null);
  });
});
