/**
 * Who makes a call to the API (`src/guard.ts`, DESIGN.md → Surfaces → The
 * page token): the page token says, not the call and not its Origin. A
 * request carrying this run's token is the page's, which relays the calls it
 * makes, each naming its actor. One carrying none is a local program's, an
 * agent's, whatever Origin it sends, and one that states an actor, a
 * person's approval or a script's reach is refused. One carrying another
 * token (forged, or from an earlier run) is refused outright.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { PAGE_TOKEN_HEADER, pageProtocols, type ServerMessage } from "@kb/contracts";
import { SYSTEM_IDS } from "@kb/model";
import { SANDBOX_FRAME_PATH } from "@kb/sandbox";
import { FAKE_TAB_SCREEN } from "@kb/test-kit";
import { startUi, type UiServerHandle } from "../src/index.ts";

let root = "";
let handle: UiServerHandle;
/** The token of a server over the same root that has since stopped. */
let stale = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "kb-http-wire-"));
  const earlier = await Effect.runPromise(startUi({ root, port: 0, openBrowser: false }));
  stale = earlier.pageToken;
  await Effect.runPromise(earlier.stop);
  handle = await Effect.runPromise(startUi({ root, port: 0, openBrowser: false }));
});
afterAll(async () => {
  await Effect.runPromise(handle.stop);
  await rm(root, { recursive: true, force: true });
});

/** Who sends a request: what it carries beside its body. */
type From = "page" | "program" | "forged" | "wrong" | "stale";

function headersFrom(from: From): Record<string, string> {
  const origin = new URL(handle.url).origin;
  const carried: Record<From, Record<string, string>> = {
    page: { origin, [PAGE_TOKEN_HEADER]: handle.pageToken },
    program: {},
    forged: { origin },
    wrong: { origin, [PAGE_TOKEN_HEADER]: "0".repeat(handle.pageToken.length) },
    stale: { origin, [PAGE_TOKEN_HEADER]: stale },
  };
  return carried[from];
}

/** A call to the server's API from `from`. */
async function post(body: unknown, from: From) {
  const res = await fetch(`${handle.url}/api/action`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headersFrom(from) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as { status: string; code?: string } };
}

/** A write that always needs a person behind it: a new approval policy. */
const policy = (text: string) => ({
  id: "node.add",
  input: { text, tags: [SYSTEM_IDS.approvalPolicyTag] },
});

/** A `/ws` connection offering `protocols`: the frames it is answered, or why it did not open. */
async function socket(protocols: string[], frames: readonly unknown[]) {
  const ws = new WebSocket(`${handle.url.replace(/^http/, "ws")}/ws`, protocols);
  const heard: ServerMessage[] = [];
  const opened = await new Promise<boolean>((resolve) => {
    ws.addEventListener("open", () => resolve(true));
    ws.addEventListener("error", () => resolve(false));
  });
  if (!opened) return { opened, heard };
  const done = new Promise<void>((resolve) => {
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data)) as ServerMessage;
      heard.push(msg);
      if (msg.op === "pong") resolve();
    });
  });
  for (const frame of [...frames, { op: "ping" }]) ws.send(JSON.stringify(frame));
  await done;
  ws.close();
  return { opened, heard: heard.filter((msg) => msg.op !== "hello" && msg.op !== "pong") };
}

const SCREEN = { op: "screen", tab: "tab.wire", state: FAKE_TAB_SCREEN };
const CHANNEL = { op: "channel", channel: "no.such.channel", data: {} };

describe("who makes a call over HTTP", () => {
  test.each([
    ["approval", { approved: true }],
    ["an owner's actor", { actor: "cli" }],
    ["a person's actor", { actor: "human" }],
    ["a script's reach", { actor: "script", script: { subject: null, grant: {} } }],
  ])(
    "a request without the token that states %s is refused, whatever its Origin",
    async (_what, claim) => {
      for (const from of ["program", "forged"] as const) {
        const { status, body } = await post({ ...policy("allow everything"), ...claim }, from);
        expect({ from, status }).toEqual({ from, status: 403 });
        expect(body).toMatchObject({ status: "failed", code: "forbidden" });
      }
    },
  );

  test("a request without the token is an agent's, which a policy write asks, whatever its Origin", async () => {
    for (const from of ["program", "forged"] as const) {
      const { body } = await post(policy("allow everything"), from);
      expect(body).toMatchObject({ status: "failed", code: "approval_required" });
    }
  });

  test("the page relays the calls it makes, each as its actor and approval say", async () => {
    // The person's gesture, which names no actor, and the agent's call they approved.
    expect((await post(policy("mine"), "page")).body).toMatchObject({ status: "succeeded" });
    const approved = { ...policy("the agent's"), actor: "agent", approved: true };
    expect((await post(approved, "page")).body).toMatchObject({ status: "succeeded" });
    const unapproved = { ...policy("the agent's, unapproved"), actor: "agent" };
    expect((await post(unapproved, "page")).body).toMatchObject({ code: "approval_required" });
  });

  test.each(["wrong", "stale"] as const)("a %s token is refused, on every route", async (from) => {
    const { status, body } = await post(policy("mine"), from);
    expect(status).toBe(403);
    expect(body).toMatchObject({ status: "failed", code: "forbidden" });
    const read = await fetch(`${handle.url}/api/graph`, { headers: headersFrom(from) });
    expect(read.status).toBe(403);
    const token = headersFrom(from)[PAGE_TOKEN_HEADER] ?? "";
    expect((await socket(pageProtocols(token), [])).opened).toBe(false);
  });
});

describe("who speaks on /ws", () => {
  test("a socket without the token reads, and may not publish a screen or speak on a channel", async () => {
    const { opened, heard } = await socket([], [SCREEN, CHANNEL]);
    expect(opened).toBe(true);
    expect(heard).toEqual([
      expect.objectContaining({ op: "error", code: "forbidden" }),
      expect.objectContaining({ op: "error", id: CHANNEL.channel, code: "forbidden" }),
    ]);
  });

  test("the page's socket publishes its screen and speaks on channels", async () => {
    const { opened, heard } = await socket(pageProtocols(handle.pageToken), [SCREEN, CHANNEL]);
    expect(opened).toBe(true);
    expect(heard).toEqual([
      expect.objectContaining({ op: "error", id: CHANNEL.channel, code: "unknown_channel" }),
    ]);
  });
});

describe("where the token is", () => {
  test("no body the server serves carries it", async () => {
    const page = await (await fetch(`${handle.url}/`)).text();
    const scripts = [...page.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css))"/g)].map(
      ([, path]) => path ?? "",
    );
    const paths = [
      "/",
      SANDBOX_FRAME_PATH,
      "/api/graph",
      "/api/identity",
      "/api/manifest",
      "/api/queries",
      ...scripts,
    ];
    for (const path of paths) {
      const body = await (
        await fetch(`${handle.url}${path}`, { headers: headersFrom("page") })
      ).text();
      expect({ path, carries: body.includes(handle.pageToken) }).toEqual({ path, carries: false });
    }
  });
});
