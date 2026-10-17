/**
 * A script run once against a canvas (`ext.code.script.run`, DESIGN.md →
 * Sandbox → Scripts): only a script a person trusts runs, an agent's run
 * asks for approval, and the script writes through the canvas verbs as the
 * `script` actor, within its grant.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { CANVAS_IDS, parseCanvasDoc } from "@kb/canvas";
import { CODE_IDS } from "@kb/code";
import type { ActionInvocation } from "@kb/contracts";
import { canonicalJson, present } from "@kb/model";
import { codeDigest } from "@kb/sandbox";
import { invoke } from "../src/invoke.ts";
import { resetRegistryCache } from "../src/registry.ts";
import { openKb } from "../src/session.ts";

const PLACE = `await kb.invoke("ext.canvas.place", {
  canvasId: kb.subject,
  items: [{ make: { id: "from-script", text: "placed by a script" }, at: { x: 0, y: 0 } }],
});`;
const GRANT = { reads: "subject" as const, actions: ["ext.canvas.place"] };

const run = (rest: Partial<ActionInvocation> = {}): ActionInvocation => ({
  id: "ext.code.script.run",
  input: { script: "s.place", subject: "n.canvas" },
  ...rest,
});

describe("running a script once", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kb-script-run-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    resetRegistryCache();
  });

  test("an untrusted script never runs; a trusted one writes through the verbs as the script", async () => {
    const ctx = await openKb(root);
    await invoke(ctx, {
      id: "node.add",
      input: { text: "Board", id: "n.canvas", tags: ["canvas"] },
    });
    await invoke(ctx, {
      id: "node.add",
      input: {
        id: "s.place",
        text: "Place a card",
        tags: ["script"],
        props: [
          { field: CODE_IDS.codeField, value: { t: "str", v: PLACE } },
          { field: CODE_IDS.codeGrantField, value: { t: "str", v: canonicalJson(GRANT) } },
        ],
      },
    });
    const items = () => {
      const raw = ctx.nodes.find((n) => n.id === "n.canvas")?.props[CANVAS_IDS.canvasField]?.[0];
      return raw === undefined ? [] : parseCanvasDoc(String(raw.v)).nodes.map((n) => n.id);
    };

    // An agent asks before it runs one at all.
    expect(await invoke(ctx, run({ actor: "agent" }))).toMatchObject({
      status: "failed",
      code: "approval_required",
    });
    // Approved or a person's, an untrusted script still never runs.
    expect(await invoke(ctx, run({ actor: "human" }))).toMatchObject({
      status: "failed",
      code: "forbidden",
    });
    expect(items()).toEqual([]);

    const digest = await Effect.runPromise(codeDigest(PLACE, GRANT));
    expect(
      await invoke(ctx, { id: "sandbox.trust", input: { digest }, actor: "human" }),
    ).toMatchObject({ status: "succeeded" });

    const ran = await invoke(ctx, run({ actor: "agent", approved: true }));
    expect(ran).toMatchObject({ status: "succeeded" });
    expect(items()).toEqual(["from-script"]);
  });

  test("a script reaches through the canvas verbs only the canvas it runs for", async () => {
    const ctx = await openKb(root);
    for (const id of ["n.canvas", "n.other"]) {
      await invoke(ctx, { id: "node.add", input: { text: id, id, tags: ["canvas"] } });
    }
    await invoke(ctx, { id: "node.add", input: { id: "n.elsewhere", text: "elsewhere" } });
    const escape = `const tried = [];
      for (const call of [
        ["ext.canvas.place", { canvasId: "n.other", items: [{ make: { id: "x" }, at: { x: 0, y: 0 } }] }],
        ["ext.canvas.tx.apply", { canvasId: kb.subject, doc: { nodes: [], edges: [] },
          propTargetId: "n.elsewhere", setProps: [{ field: "f.note", value: { t: "str", v: "hi" } }] }],
        ["ext.canvas.describe", { canvasId: "n.other" }],
        ["ext.canvas.place", { canvasId: kb.subject, items: [{ make: { id: "mine" }, at: { x: 0, y: 0 } }] }],
      ]) {
        try { await kb.invoke(call[0], call[1]); tried.push("ran"); } catch (e) { tried.push(e.code); }
      }
      kb.log(tried.join(","));`;
    const grant = {
      reads: "subject" as const,
      actions: ["ext.canvas.place", "ext.canvas.tx.apply", "ext.canvas.describe"],
    };
    await invoke(ctx, {
      id: "node.add",
      input: {
        id: "s.escape",
        text: "Escape",
        tags: ["script"],
        props: [
          { field: CODE_IDS.codeField, value: { t: "str", v: escape } },
          { field: CODE_IDS.codeGrantField, value: { t: "str", v: canonicalJson(grant) } },
        ],
      },
    });
    const digest = await Effect.runPromise(codeDigest(escape, grant));
    await invoke(ctx, { id: "sandbox.trust", input: { digest }, actor: "human" });
    expect(
      await invoke(
        ctx,
        run({ input: { script: "s.escape", subject: "n.canvas" }, actor: "human" }),
      ),
    ).toMatchObject({ status: "succeeded" });
    // Its own canvas it writes; another canvas, or a node outside it, it does not.
    const own = ctx.nodes.find((n) => n.id === "n.canvas")?.props[CANVAS_IDS.canvasField]?.[0];
    expect(parseCanvasDoc(String(own?.v)).nodes.map((n) => n.id)).toEqual(["mine"]);
    expect(
      ctx.nodes.find((n) => n.id === "n.other")?.props[CANVAS_IDS.canvasField],
    ).toBeUndefined();
    expect(ctx.nodes.find((n) => n.id === "n.elsewhere")?.props["f.note"]).toBeUndefined();
  });

  test("a script never starts a script run: a run is a person's act, or an agent's", async () => {
    const ctx = await openKb(root);
    await invoke(ctx, {
      id: "node.add",
      input: { text: "Board", id: "n.canvas", tags: ["canvas"] },
    });
    const call = {
      ...run({ input: { script: "s.place", subject: "n.canvas" } }),
      actor: "script" as const,
      approved: true,
      script: {
        subject: "n.canvas",
        grant: { reads: "subject", actions: ["ext.code.script.run"] },
      },
    };
    expect(await invoke(ctx, call)).toMatchObject({
      status: "failed",
      code: "forbidden",
      details: { policy: "approval.script-run" },
    });
  });

  test("a script calls nothing its grant does not name", async () => {
    const ctx = await openKb(root);
    await invoke(ctx, {
      id: "node.add",
      input: { text: "Board", id: "n.canvas", tags: ["canvas"] },
    });
    const narrow = { reads: "subject" as const, actions: [] };
    await invoke(ctx, {
      id: "node.add",
      input: {
        id: "s.place",
        text: "Place a card",
        tags: ["script"],
        props: [
          { field: CODE_IDS.codeField, value: { t: "str", v: PLACE } },
          { field: CODE_IDS.codeGrantField, value: { t: "str", v: canonicalJson(narrow) } },
        ],
      },
    });
    const digest = await Effect.runPromise(codeDigest(PLACE, narrow));
    await invoke(ctx, { id: "sandbox.trust", input: { digest }, actor: "human" });
    const ran = await invoke(ctx, run({ actor: "human" }));
    expect(ran).toMatchObject({ status: "succeeded" });
    const output = ran.status === "succeeded" ? (ran.output as { ended: unknown }) : null;
    expect(present(output, "output").ended).toMatchObject({ reason: "error" });
    expect(
      ctx.nodes.find((n) => n.id === "n.canvas")?.props[CANVAS_IDS.canvasField],
    ).toBeUndefined();
  });
});
