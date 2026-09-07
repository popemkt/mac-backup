import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { openKb } from "../src/session.ts";
import { invoke } from "../src/invoke.ts";
import type { KbNode } from "@kb/model";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

test("node.update replaces an entire field atomically instead of erasing the new value", async () => {
  const root = await mkdtemp(join(import.meta.dir, "kb-update-"));
  roots.push(root);
  const ctx = await openKb(root);
  await invoke(ctx, { id: "node.add", input: { id: "n.perspective", text: "Perspective" } });
  const field = "sys.f.lens.renderer";
  await invoke(ctx, {
    id: "node.update",
    input: { id: "n.perspective", setProps: [{ field, value: { t: "str", v: "force2d" } }] },
  });
  for (const renderer of ["cluster", "tree", "force3d", "force2d"]) {
    const receipt = await invoke(ctx, {
      id: "node.update",
      input: {
        id: "n.perspective",
        unsetProps: [{ field }],
        setProps: [{ field, value: { t: "str", v: renderer } }],
      },
    });
    expect(receipt.status).toBe("succeeded");
    if (receipt.status !== "succeeded") throw new Error("replacement failed");
    expect((receipt.output as { node: KbNode }).node.props[field]).toEqual([
      { t: "str", v: renderer },
    ]);
  }
  const reopened = await openKb(root);
  expect(reopened.nodes.find((node) => node.id === "n.perspective")?.props[field]).toEqual([
    { t: "str", v: "force2d" },
  ]);
});
