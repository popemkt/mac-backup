/**
 * Who makes a call over HTTP (`src/http.ts`, DESIGN.md → Surfaces): the
 * surface says, not the call. A local program's request (no Origin) is an
 * agent's, and one that states an actor, a person's approval or a script's
 * reach is refused; the UI's own page (its Origin, which the request guard
 * holds to the UI's) relays the calls it makes, each naming its actor.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { SYSTEM_IDS } from "@kb/model";
import { startUi, type UiServerHandle } from "../src/index.ts";

let root = "";
let handle: UiServerHandle;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "kb-http-wire-"));
  handle = await Effect.runPromise(startUi({ root, port: 0, openBrowser: false }));
});
afterAll(async () => {
  await Effect.runPromise(handle.stop);
  await rm(root, { recursive: true, force: true });
});

/** A call to the server's API, as the page sends it or as a local program does. */
async function post(body: unknown, from: "page" | "program") {
  const res = await fetch(`${handle.url}/api/action`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(from === "page" ? { origin: new URL(handle.url).origin } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as { status: string; code?: string } };
}

/** A write that always needs a person behind it: a new approval policy. */
const policy = (text: string) => ({
  id: "node.add",
  input: { text, tags: [SYSTEM_IDS.approvalPolicyTag] },
});

describe("who makes a call over HTTP", () => {
  test.each([
    ["approval", { approved: true }],
    ["an owner's actor", { actor: "cli" }],
    ["a person's actor", { actor: "human" }],
    ["a script's reach", { actor: "script", script: { subject: null, grant: {} } }],
  ])("a local program that states %s is refused", async (_what, claim) => {
    const { status, body } = await post({ ...policy("allow everything"), ...claim }, "program");
    expect(status).toBe(403);
    expect(body).toMatchObject({ status: "failed", code: "forbidden" });
  });

  test("a local program's own call is an agent's, which a policy write asks", async () => {
    const { body } = await post(policy("allow everything"), "program");
    expect(body).toMatchObject({ status: "failed", code: "approval_required" });
  });

  test("the page relays the calls it makes, each as its actor and approval say", async () => {
    // The person's gesture, which names no actor, and the agent's call they approved.
    expect((await post(policy("mine"), "page")).body).toMatchObject({ status: "succeeded" });
    const approved = { ...policy("the agent's"), actor: "agent", approved: true };
    expect((await post(approved, "page")).body).toMatchObject({ status: "succeeded" });
    const unapproved = { ...policy("the agent's, unapproved"), actor: "agent" };
    expect((await post(unapproved, "page")).body).toMatchObject({ code: "approval_required" });
  });
});
