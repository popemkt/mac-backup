import { describe, expect, it } from "vitest";
import { mutations } from "./mutations";
import { createWsClient } from "@/api/ws";

describe("U3/U4 seams", () => {
  it("mutation stubs throw not wired", () => {
    expect(() => mutations.createNodeAfter("x")).toThrow(/not wired/);
    expect(() => mutations.updateNodeContent("x", "y")).toThrow(/not wired/);
  });

  it("ws client stub throws not wired", () => {
    const ws = createWsClient();
    expect(ws.status).toBe("idle");
    expect(() => ws.connect()).toThrow(/not wired/);
  });
});
