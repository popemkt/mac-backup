import { describe, expect, test } from "bun:test";
import type { ActionMode } from "@kb/contracts";
import type { FailureCode } from "@kb/model";
import type { ActionMode as SdkActionMode, FailureCode as SdkFailureCode } from "../src/surface.ts";

/**
 * The SDK surface is self-contained so it can be emitted as a standalone
 * ambient module, which makes its vocabularies a restatement of the
 * contracts'. This is the bridge that keeps the restatement exact: each
 * binding compiles only while the two types are mutually assignable, so a
 * vocabulary changed on one side fails `tsc` until the other follows.
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const modes: Same<SdkActionMode, ActionMode> = true;
const codes: Same<SdkFailureCode, FailureCode> = true;

describe("extension SDK surface", () => {
  test("restates the contracts' mode and failure vocabularies exactly", () => {
    expect([modes, codes]).toEqual([true, true]);
  });
});
