/**
 * An optional family is switched on the server (DESIGN.md → Extension
 * families → optional is a server-side load decision). The switch is the
 * family's node in the store, written only by `extension.switch`: the
 * registry loads the family while the node says so, and `kb.manifest`
 * reports what it loaded, which is what the page follows. A fresh store has
 * no switch, so the lab is off, and opening a store never writes one.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { bundledSeed } from "@kb/bundled";
import {
  EXTENSION_ENABLED_FIELD,
  ReadInvoke,
  extensionNodeId,
  type ActionInvocation,
  type ActionReceipt,
} from "@kb/contracts";
import { SYSTEM_IDS, present, type Actor, type KbNode } from "@kb/model";
import { kbManifestDef } from "@kb/operations";
import { invoke } from "../src/invoke.ts";
import { kbRuntimeLayer } from "../src/layers.ts";
import { openKb } from "../src/session.ts";

type Session = Awaited<ReturnType<typeof openKb>>;

/** What `kb.manifest` says of the lab: its row, and whether its view is in the catalog. */
async function labIn(ctx: Session) {
  const receipt = await invoke(ctx, { id: "kb.manifest", input: {} });
  expect(receipt.status).toBe("succeeded");
  const manifest = kbManifestDef.outputSchema.parse(
    receipt.status === "succeeded" ? receipt.output : null,
  );
  return {
    row: manifest.extensions.find(({ name }) => name === "lab"),
    listed: manifest.views.some(({ id }) => id === "lab.page"),
  };
}

function switchLab(ctx: Session, on: boolean): Promise<ActionReceipt> {
  return invoke(ctx, { id: "extension.switch", input: { name: "lab", on } });
}

const LAB_NODE = extensionNodeId("lab");

describe("the lab is switched on the server", () => {
  let root: string;
  let store: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kb-extension-switch-"));
    store = join(root, ".kb", "nodes.jsonl");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("the seed holds no switch, so a fresh store has the lab off and the registry leaves it out", async () => {
    const seeded = new Set(bundledSeed().map((node) => node.id));
    expect(seeded.has(LAB_NODE)).toBe(false);
    expect(seeded.has(EXTENSION_ENABLED_FIELD)).toBe(false);

    const ctx = await openKb(root);
    expect(ctx.index.getNode(LAB_NODE)).toBeUndefined();
    expect(await labIn(ctx)).toEqual({
      row: { name: "lab", label: "Lab", optional: true, enabled: false, source: "bundled" },
      listed: false,
    });
    // The view type's option is seeded whether the family is on or not: the data outlives the code.
    expect(ctx.index.getNode(SYSTEM_IDS.viewsRoot)?.children).toContain("sys.view.lab.page");
  });

  test("switched on, the registry loads it and reports it; switched off, it leaves again", async () => {
    const ctx = await openKb(root);
    expect(await switchLab(ctx, true)).toMatchObject({
      status: "succeeded",
      output: { name: "lab", on: true },
    });
    expect(await labIn(ctx)).toMatchObject({ row: { enabled: true }, listed: true });
    expect(ctx.index.getNode(LAB_NODE)).toMatchObject({
      text: "Lab",
      props: { [EXTENSION_ENABLED_FIELD]: [{ t: "bool", v: true }] },
    });
    expect(ctx.index.getNode(EXTENSION_ENABLED_FIELD)?.props[SYSTEM_IDS.fieldTypeField]).toEqual([
      { t: "ref", v: SYSTEM_IDS.ftCheckbox },
    ]);

    expect((await switchLab(ctx, false)).status).toBe("succeeded");
    expect(await labIn(ctx)).toMatchObject({ row: { enabled: false }, listed: false });
    // Off is a value of the switch, not its absence: the node stays, and says so.
    expect(ctx.index.getNode(LAB_NODE)?.props[EXTENSION_ENABLED_FIELD]).toEqual([
      { t: "bool", v: false },
    ]);
  });

  test("the switch is the store's: another session over the root reads it", async () => {
    const first = await openKb(root);
    expect((await switchLab(first, true)).status).toBe("succeeded");
    const second = await openKb(root);
    expect(await labIn(second)).toMatchObject({ row: { enabled: true }, listed: true });
  });

  test("opening a store with the lab switched on writes nothing", async () => {
    const ctx = await openKb(root);
    expect((await switchLab(ctx, true)).status).toBe("succeeded");
    const before = await readFile(store);
    const reopened = await openKb(root);
    expect(await labIn(reopened)).toMatchObject({ row: { enabled: true } });
    expect((await readFile(store)).equals(before)).toBe(true);
  });

  test("a switch reads the store as it is, so a stale session does not re-create another's node", async () => {
    const stale = await openKb(root);
    const other = await openKb(root);
    expect((await switchLab(other, true)).status).toBe("succeeded");
    const created = other.index.getNode(LAB_NODE)?.createdAt;
    expect(created).toBeDefined();
    expect(stale.index.getNode(LAB_NODE)).toBeUndefined();

    expect((await switchLab(stale, false)).status).toBe("succeeded");
    expect(stale.index.getNode(LAB_NODE)?.createdAt).toBe(created);
    expect(await labIn(stale)).toMatchObject({ row: { enabled: false } });
  });

  test("a family that is not optional cannot be switched, and an unknown one is not found", async () => {
    const ctx = await openKb(root);
    const before: KbNode[] = ctx.nodes;
    expect(
      await invoke(ctx, { id: "extension.switch", input: { name: "chart", on: false } }),
    ).toMatchObject({ status: "failed", code: "invalid_input" });
    expect(
      await invoke(ctx, { id: "extension.switch", input: { name: "nope", on: true } }),
    ).toMatchObject({ status: "failed", code: "not_found" });
    expect(ctx.nodes).toEqual(before);
  });
});

/** A call to switch the lab on, made by `actor`, with a person's approval or without. */
function call(actor: Actor, approved?: boolean): ActionInvocation {
  return {
    id: "extension.switch",
    input: { name: "lab", on: true },
    actor,
    ...(approved === undefined ? {} : { approved }),
  };
}

/**
 * Who may switch: switching changes which code the server loads, so the
 * seeded approval policies ask an agent and deny sandboxed code, while a
 * person's gesture and the CLI need no row (DESIGN.md → Action registry →
 * Approval). A code view's figure reaches actions only as a read, so it
 * cannot switch either.
 */
describe("who may switch an extension", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kb-extension-switch-approval-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("an agent is asked: refused without a person's approval, run with it", async () => {
    const ctx = await openKb(root);
    expect(await invoke(ctx, call("agent"))).toMatchObject({
      status: "failed",
      code: "approval_required",
      details: { policy: "approval.agent-extension-switch" },
    });
    expect(ctx.index.getNode(LAB_NODE)).toBeUndefined();
    expect((await invoke(ctx, call("agent", true))).status).toBe("succeeded");
    expect(await labIn(ctx)).toMatchObject({ row: { enabled: true } });
  });

  test("a person's gesture and the CLI switch with no approval", async () => {
    const ctx = await openKb(root);
    expect((await invoke(ctx, call("human"))).status).toBe("succeeded");
    expect((await invoke(ctx, { ...call("cli"), input: { name: "lab", on: false } })).status).toBe(
      "succeeded",
    );
    expect(await labIn(ctx)).toMatchObject({ row: { enabled: false } });
  });

  test("sandboxed code is refused, even with an approval", async () => {
    const ctx = await openKb(root);
    for (const approved of [undefined, true]) {
      expect(await invoke(ctx, call("script", approved))).toMatchObject({
        status: "failed",
        code: "forbidden",
        details: { policy: "approval.script-extension-switch" },
      });
    }
    expect(ctx.index.getNode(LAB_NODE)).toBeUndefined();
  });

  test("a code view's figure, which invokes only as a read, cannot switch", async () => {
    const ctx = await openKb(root);
    const receipt = await Effect.runPromise(
      Effect.gen(function* () {
        const read = present(yield* ReadInvoke, "the runtime binds ReadInvoke");
        return yield* read(call("script"));
      }).pipe(Effect.provide(kbRuntimeLayer(ctx))),
    );
    expect(receipt).toMatchObject({ status: "failed", code: "forbidden" });
    expect(ctx.index.getNode(LAB_NODE)).toBeUndefined();
  });
});
