import { describe, expect, it } from "vitest";
import { RetryableError, keptLoad } from "./kept-load";

describe("a kept load", () => {
  it("loads once, and keeps what arrived", async () => {
    let calls = 0;
    const kept = keptLoad(async () => {
      calls += 1;
      return "chunk";
    });
    expect(kept.current()).toBeNull();
    const [a, b] = await Promise.all([kept.load(), kept.load()]);
    expect([a, b, kept.current(), calls]).toEqual(["chunk", "chunk", "chunk", 1]);
    await kept.load();
    expect(calls).toBe(1);
  });

  it("keeps a failed load failed until it is retried, then loads again", async () => {
    let calls = 0;
    const kept = keptLoad(async () => {
      calls += 1;
      if (calls === 1) throw new Error("did not arrive");
      return "chunk";
    });
    const failure = await kept.load().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RetryableError);
    // A render that reads it again sees the same failure, and starts no load.
    await expect(kept.load()).rejects.toBe(failure);
    expect(calls).toBe(1);
    (failure as RetryableError).retry();
    await expect(kept.load()).resolves.toBe("chunk");
    expect(calls).toBe(2);
  });
});
