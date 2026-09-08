/**
 * Half of the store-isolation probe for gap [[01M1XA98A0A7PWEPMHG2T4R5GP]].
 * The other half is `isolation.b.test.ts`; the property is stated once in
 * {@link probeStoreIsolation} and both files run it.
 */
import { describe, it } from "vitest";
import { probeStoreIsolation } from "./isolation-probe";

describe("ui test files do not share a store (probe A)", () => {
  it("sees no neighbour's module registry or store object", () => {
    console.info(`\n${probeStoreIsolation("isolation.a")}`);
  });
});
