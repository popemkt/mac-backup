import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import type { KbNode } from "@kb/model";
import { BrowserStore } from "./browser-store";

const node = (id: string, text: string): KbNode => ({
  id,
  text,
  props: {},
  children: [],
  createdAt: "2026-09-06T00:00:00.000Z",
  updatedAt: "2026-09-06T00:00:00.000Z",
});

describe("BrowserStore", () => {
  it("commits into memory and advances its generation fingerprint", async () => {
    const store = new BrowserStore([node("a", "before")]);
    const initial = Number(await Effect.runPromise(store.fingerprint));
    await Effect.runPromise(
      store.commitEffect({ upserts: [node("a", "after"), node("b", "new")], deletes: [] }),
    );
    const afterFirstCommit = Number(await Effect.runPromise(store.fingerprint));
    await Effect.runPromise(store.commitEffect({ upserts: [], deletes: ["b"] }));

    expect(await Effect.runPromise(store.loadEffect)).toEqual([node("a", "after")]);
    expect(afterFirstCommit).toBe(initial + 1);
    expect(Number(await Effect.runPromise(store.fingerprint))).toBe(afterFirstCommit + 1);
    expect(store.path).toBe("browser");
  });
});
