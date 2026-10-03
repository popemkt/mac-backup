import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { BUNDLED_FAMILIES } from "@kb/bundled";
import { defineExtension } from "@kb/contracts";
import { definePlugin } from "@kb/plugin";
import { extensionContract } from "@kb/test-kit";
import { BUNDLED_EXTENSIONS, serverEntriesFor } from "../src/bundled.ts";

// Every family the server bundles keeps the one extension contract.
for (const { declaration, entry } of BUNDLED_EXTENSIONS) extensionContract(declaration, entry);

const plugin = (name: string) => definePlugin({ name, apply: () => Effect.void });
const family = (name: string) => defineExtension({ name, label: name });

describe("the server's entries are resolved from the one bundled list", () => {
  test("the resolved list is the bundled families, in order", () => {
    expect(BUNDLED_EXTENSIONS.map(({ declaration }) => declaration)).toEqual([...BUNDLED_FAMILIES]);
  });

  test("a bundled family with no server entry fails", () => {
    expect(() => serverEntriesFor([family("a"), family("b")], [plugin("a")])).toThrow(
      "bundled family b has no server entry",
    );
  });

  test("a server entry that names no bundled family fails", () => {
    expect(() => serverEntriesFor([family("a")], [plugin("a"), plugin("z")])).toThrow(
      "server entries z name no bundled family",
    );
  });
});
