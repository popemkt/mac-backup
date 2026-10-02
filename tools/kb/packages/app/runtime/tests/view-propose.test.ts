/**
 * `view.propose` writes the view node `@kb/views`' `viewNodeFor` checks, or
 * nothing: filed in the Views list, named by its host, and read back by its
 * key as the settings proposed (DESIGN.md → View nodes).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Result } from "effect";
import { SYSTEM_IDS, hostViewIds, type KbNode } from "@kb/model";
import { OutlineBoardView, paramsFromProps } from "@kb/views";
import type { KbContext } from "@kb/contracts";
import { openKb } from "../src/session.ts";
import { invoke } from "../src/invoke.ts";

const FRAME = "n.propose-frame";
const STATUS = "f.propose-status";
const BOARD = { filters: [], sort: [], display: [], groupFieldId: STATUS };

let root: string;
let ctx: KbContext;

async function mustInvoke(id: string, input: unknown): Promise<unknown> {
  const receipt = await invoke(ctx, { id, input });
  if (receipt.status !== "succeeded") throw new Error(`${id}: ${receipt.message}`);
  return receipt.output;
}

function node(id: string): KbNode {
  const found = ctx.index.getNode(id);
  if (found === undefined) throw new Error(`no node ${id}`);
  return found;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kb-view-propose-"));
  ctx = await openKb(root);
  await mustInvoke("field.define", { name: "status", id: STATUS });
  await mustInvoke("node.add", { id: FRAME, text: "Todos" });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("view.propose", () => {
  test("writes the view node, files it in the Views list, and names it in its host", async () => {
    const out = (await mustInvoke("view.propose", {
      view: "outline.board",
      params: BOARD,
      host: FRAME,
      id: "v.board",
    })) as { id: string; view: string; host: string; params: unknown };
    expect(out).toMatchObject({ id: "v.board", view: "outline.board", host: FRAME, params: BOARD });
    const view = node("v.board");
    expect(view.props[SYSTEM_IDS.viewField]).toEqual([{ t: "ref", v: OutlineBoardView.option }]);
    expect(node(SYSTEM_IDS.viewsList).children.at(-1)).toBe("v.board");
    expect(hostViewIds(node(FRAME))).toEqual(["v.board"]);
    expect(paramsFromProps(OutlineBoardView, view.props, FRAME, () => {})).toEqual(
      Result.succeed(BOARD),
    );
  });

  test("names a view first in its host when it is to be the default", async () => {
    const table = { filters: [], sort: [], display: [], colwidth: {}, pagesize: 50 };
    await mustInvoke("view.propose", {
      view: "outline.table",
      params: table,
      host: FRAME,
      id: "v.a",
    });
    await mustInvoke("view.propose", {
      view: "sys.view.outline.board",
      params: BOARD,
      host: FRAME,
      id: "v.b",
      default: true,
    });
    expect(hostViewIds(node(FRAME))).toEqual(["v.b", "v.a"]);
  });

  test("an unknown view, bad settings or a missing host fail and write nothing", async () => {
    const before = ctx.nodes.length;
    const unknown = await invoke(ctx, { id: "view.propose", input: { view: "outline.nope" } });
    expect(unknown).toMatchObject({ status: "failed", code: "invalid_input" });
    const bad = await invoke(ctx, {
      id: "view.propose",
      input: { view: "outline.board", params: { ...BOARD, groupFieldId: 7 }, host: FRAME },
    });
    expect(bad).toMatchObject({
      status: "failed",
      code: "invalid_input",
      details: {
        view: "outline.board",
        issues: [{ path: ["groupFieldId"], message: "Expected string | null" }],
      },
    });
    const hostless = await invoke(ctx, {
      id: "view.propose",
      input: { view: "outline.board", params: BOARD, host: "n.nobody" },
    });
    expect(hostless).toMatchObject({ status: "failed", code: "not_found" });
    expect(ctx.nodes.length).toBe(before);
    expect(hostViewIds(node(FRAME))).toEqual([]);
  });
});
