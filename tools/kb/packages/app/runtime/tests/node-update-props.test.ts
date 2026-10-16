import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openKb } from "../src/session.ts";
import { invoke } from "../src/invoke.ts";
import type { KbNode } from "@kb/model";
import { LayoutView, NodeView, OntologyListView, OntologyScopeView } from "@kb/views";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

test("node.update replaces an entire field atomically instead of erasing the new value", async () => {
  const root = await mkdtemp(join(tmpdir(), "kb-update-"));
  roots.push(root);
  const ctx = await openKb(root);
  await invoke(ctx, { id: "node.add", input: { id: "n.view", text: "A view" } });
  const field = "sys.f.view";
  await invoke(ctx, {
    id: "node.update",
    input: {
      id: "n.view",
      setProps: [{ field, value: { t: "ref", v: LayoutView.option } }],
    },
  });
  for (const view of [
    NodeView.option,
    OntologyListView.option,
    OntologyScopeView.option,
    LayoutView.option,
  ]) {
    const receipt = await invoke(ctx, {
      id: "node.update",
      input: {
        id: "n.view",
        unsetProps: [{ field }],
        setProps: [{ field, value: { t: "ref", v: view } }],
      },
    });
    expect(receipt.status).toBe("succeeded");
    if (receipt.status !== "succeeded") throw new Error("replacement failed");
    expect((receipt.output as { node: KbNode }).node.props[field]).toEqual([{ t: "ref", v: view }]);
  }
  const reopened = await openKb(root);
  expect(reopened.nodes.find((node) => node.id === "n.view")?.props[field]).toEqual([
    { t: "ref", v: LayoutView.option },
  ]);
});
