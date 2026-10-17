/**
 * What a process kb starts is given of this one's environment (`child-env.ts`):
 * a kb child gets the base and kb's own settings, never a key; a lookup gets
 * the base and the session bus; an agent runtime the base and its network,
 * and a key only where the code it runs declares it reads one; the person's own tool gets everything; and
 * an override always lands.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { childProcessEnv } from "../src/child-env.ts";

const SET = {
  ANTHROPIC_API_KEY: "sk-secret",
  AWS_SECRET_ACCESS_KEY: "aws-secret",
  HTTPS_PROXY: "http://proxy:3128",
  KB_HOME: "/tmp/home",
  XDG_DATA_HOME: "/tmp/data",
  DBUS_SESSION_BUS_ADDRESS: "unix:path=/tmp/bus",
  LC_ALL: "C",
} as const;
let saved: Record<string, string | undefined> = {};

describe("a child process's environment", () => {
  beforeEach(() => {
    saved = Object.fromEntries(Object.keys(SET).map((key) => [key, process.env[key]]));
    Object.assign(process.env, SET);
  });
  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test("a kb child gets the base and kb's settings, never a key", () => {
    const env = childProcessEnv("kb", { KB_PKG_ROOT: "/pkg" });
    expect(env).toMatchObject({ KB_HOME: "/tmp/home", XDG_DATA_HOME: "/tmp/data", LC_ALL: "C" });
    expect(env.PATH).toBeDefined();
    expect(env.KB_PKG_ROOT).toBe("/pkg");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.DBUS_SESSION_BUS_ADDRESS).toBeUndefined();
  });

  test("a lookup gets the base and the session bus, and nothing of kb's", () => {
    const env = childProcessEnv("lookup");
    expect(env.DBUS_SESSION_BUS_ADDRESS).toBe("unix:path=/tmp/bus");
    expect(env.PATH).toBeDefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.KB_HOME).toBeUndefined();
  });

  test("an agent runtime gets the base and its network, and a key only where its code declares it", () => {
    const env = childProcessEnv("agent");
    expect(env).toMatchObject({ HTTPS_PROXY: "http://proxy:3128", XDG_DATA_HOME: "/tmp/data" });
    expect(env.PATH).toBeDefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.KB_HOME).toBeUndefined();
    const declared = childProcessEnv("agent", {}, ["ANTHROPIC_API_KEY"]);
    expect(declared.ANTHROPIC_API_KEY).toBe("sk-secret");
    expect(declared.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });

  test("the person's own tool gets the whole environment", () => {
    expect(childProcessEnv("tool").ANTHROPIC_API_KEY).toBe("sk-secret");
  });
});
