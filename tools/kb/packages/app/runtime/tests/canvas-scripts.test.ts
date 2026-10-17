/**
 * What a canvas tells of its scripts (DESIGN.md → Sandbox → Scripts):
 * `ext.canvas.describe` lists the scripts its board and its page name, as
 * the code family lists them (`ext.code.script.list`), each with its grant
 * and whether a person trusts it; and none while the code family is off.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { CODE_IDS } from "@kb/code";
import { canonicalJson } from "@kb/model";
import { codeDigest } from "@kb/sandbox";
import { invoke } from "../src/invoke.ts";
import { resetRegistryCache } from "../src/registry.ts";
import type { KbContext } from "@kb/contracts";
import { openKb } from "../src/session.ts";

const CODE = "kb.on('canvas.selection', () => {});";
const GRANT = { reads: "subject" as const, actions: ["ext.canvas.place"] };

const script = (ctx: KbContext, id: string, text: string) =>
  invoke(ctx, {
    id: "node.add",
    input: {
      id,
      text,
      tags: ["script"],
      props: [
        { field: CODE_IDS.codeField, value: { t: "str", v: CODE } },
        { field: CODE_IDS.codeGrantField, value: { t: "str", v: canonicalJson(GRANT) } },
      ],
    },
  });

const attach = (ctx: KbContext, host: string, scripts: string) =>
  invoke(ctx, {
    id: "node.update",
    input: {
      id: host,
      setProps: [{ field: CODE_IDS.scriptsField, value: { t: "ref", v: scripts } }],
    },
  });

const scriptsOf = async (ctx: KbContext, canvasId: string) => {
  const told = await invoke(ctx, { id: "ext.canvas.describe", input: { canvasId } });
  if (told.status !== "succeeded") throw new Error(`describe failed: ${JSON.stringify(told)}`);
  return (told.output as { scripts?: unknown }).scripts;
};

describe("a canvas's scripts, described", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kb-canvas-scripts-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    resetRegistryCache();
  });

  test("lists the board's scripts, then the page's, each with its grant and trust", async () => {
    const ctx = await openKb(root);
    await invoke(ctx, {
      id: "node.add",
      input: { id: "n.board", text: "Board", tags: ["canvas"] },
    });
    await invoke(ctx, {
      id: "node.add",
      input: { id: "n.page", text: "Page 2", tags: ["canvas"], parent: "n.board" },
    });
    await script(ctx, "s.board", "Board script");
    await script(ctx, "s.page", "Page script");
    await attach(ctx, "n.board", "s.board");
    await attach(ctx, "n.page", "s.page");

    const listed = {
      label: expect.any(String),
      reads: "subject",
      actions: ["ext.canvas.place"],
      trusted: false,
    };
    expect(await scriptsOf(ctx, "n.page")).toEqual([
      { ...listed, id: "s.board", label: "Board script", subject: "n.board" },
      { ...listed, id: "s.page", label: "Page script", subject: "n.page" },
    ]);
    // The board shows only its own.
    expect(await scriptsOf(ctx, "n.board")).toEqual([
      { ...listed, id: "s.board", label: "Board script", subject: "n.board" },
    ]);

    // Both are the same code and grant: trusting it is trusting both.
    const digest = await Effect.runPromise(codeDigest(CODE, GRANT));
    await invoke(ctx, { id: "sandbox.trust", input: { digest }, actor: "human" });
    expect(await scriptsOf(ctx, "n.page")).toEqual([
      expect.objectContaining({ id: "s.board", trusted: true }),
      expect.objectContaining({ id: "s.page", trusted: true }),
    ]);
  });

  test("while the code family is off, a description has no scripts", async () => {
    const ctx = await openKb(root);
    await invoke(ctx, {
      id: "node.add",
      input: { id: "n.board", text: "Board", tags: ["canvas"] },
    });
    await script(ctx, "s.board", "Board script");
    await attach(ctx, "n.board", "s.board");
    expect(
      await invoke(ctx, { id: "extension.switch", input: { name: "code", on: false } }),
    ).toMatchObject({ status: "succeeded" });
    expect(await scriptsOf(ctx, "n.board")).toBeUndefined();
  });

  test("a canvas that names no script lists none", async () => {
    const ctx = await openKb(root);
    await invoke(ctx, {
      id: "node.add",
      input: { id: "n.board", text: "Board", tags: ["canvas"] },
    });
    expect(await scriptsOf(ctx, "n.board")).toEqual([]);
  });
});
