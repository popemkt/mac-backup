/** Where the home store lives: `KB_HOME` when set, else the platform's place for app data. */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { homePath } from "../src/home.ts";

describe("the home store's place", () => {
  test("KB_HOME names it, resolved to an absolute path", () => {
    expect(homePath({ KB_HOME: "/tmp/somewhere/home" }, "darwin", "/Users/me")).toBe(
      "/tmp/somewhere/home",
    );
    expect(homePath({ KB_HOME: "relative" }, "linux", "/home/me")).toBe(
      join(process.cwd(), "relative"),
    );
  });

  test("unset, it is the platform's application data place", () => {
    expect(homePath({}, "darwin", "/Users/me")).toBe(
      "/Users/me/Library/Application Support/kb/home",
    );
    expect(homePath({ XDG_DATA_HOME: "/data" }, "linux", "/home/me")).toBe("/data/kb/home");
    expect(homePath({ XDG_DATA_HOME: "" }, "linux", "/home/me")).toBe(
      "/home/me/.local/share/kb/home",
    );
  });
});
