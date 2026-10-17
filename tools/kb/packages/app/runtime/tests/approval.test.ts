/**
 * The invoke core decides each call by the root's approval policies
 * (DESIGN.md → Action registry → Approval): the seeded defaults, a policy
 * written a moment ago, and what `kb.manifest` tells each actor. The
 * resolver's rules are `@kb/contracts`' tests; that every surface agrees is
 * the surface contract's.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { z } from "zod";
import { DecidedEntrySchema, type ActionInvocation } from "@kb/contracts";
import { CODE_IDS } from "@kb/code";
import { DECISION_OPTION_IDS, SYSTEM_IDS } from "@kb/model";
import { codeDigest } from "@kb/sandbox";
import { invoke } from "../src/invoke.ts";
import { openKb } from "../src/session.ts";

const ManifestSchema = z.object({ actions: z.array(DecidedEntrySchema) });

/** A node.delete call for `id`, with the envelope fields a test varies. */
const remove = (id: string, rest: Partial<ActionInvocation>): ActionInvocation => ({
  id: "node.delete",
  input: { id },
  ...rest,
});

/** A node.add call minting the script `id`, with the envelope fields a test varies. */
/**
 * A call made as a script's: running for `subject`, its grant naming
 * `action`, as its host stamps it (`answerToolCall`).
 */
const asScript = (subject: string, action: string): Partial<ActionInvocation> => ({
  actor: "script",
  script: { subject, grant: { reads: "subject", actions: [action] } },
});

const mint = (id: string, rest: Partial<ActionInvocation>): ActionInvocation => ({
  id: "node.add",
  input: { id, text: "badges", tags: ["script"] },
  ...rest,
});

/** Name the script `s.trusted` on the board `n.board`, as `rest` says who. */
const attach = (rest: Partial<ActionInvocation>): ActionInvocation => ({
  id: "node.update",
  input: {
    id: "n.board",
    setProps: [{ field: CODE_IDS.scriptsField, value: { t: "ref", v: "s.trusted" } }],
  },
  ...rest,
});

describe("approval policies in the invoke core", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kb-approval-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("the seeded defaults ask an agent before it deletes, and nobody else", async () => {
    const ctx = await openKb(root);
    await invoke(ctx, { id: "node.add", input: { id: "n.a", text: "a" } });
    await invoke(ctx, { id: "node.add", input: { id: "n.b", text: "b" } });
    expect(await invoke(ctx, remove("n.a", { actor: "agent" }))).toMatchObject({
      status: "failed",
      code: "approval_required",
      details: { policy: "approval.agent-delete" },
    });
    expect(await invoke(ctx, remove("n.a", { actor: "agent", approved: true }))).toMatchObject({
      status: "succeeded",
    });
    expect(await invoke(ctx, remove("n.b", { actor: "cli" }))).toMatchObject({
      status: "succeeded",
    });
  });

  test("sandboxed code meets the agent's caution, and writes no policy", async () => {
    const ctx = await openKb(root);
    await invoke(ctx, { id: "node.add", input: { id: "n.a", text: "a" } });
    expect(await invoke(ctx, remove("n.a", { actor: "script" }))).toMatchObject({
      status: "failed",
      code: "approval_required",
      details: { policy: "approval.script-delete" },
    });
    expect(
      await invoke(ctx, {
        id: "node.update",
        input: { id: "approval.script-delete", text: "scripts never ask" },
        ...asScript("approval.script-delete", "node.update"),
      }),
    ).toMatchObject({ status: "failed", details: { writes: "approval-policy" } });
    expect(
      await invoke(ctx, {
        id: "node.add",
        input: { text: "plain", parent: "n.a" },
        ...asScript("n.a", "node.add"),
      }),
    ).toMatchObject({ status: "succeeded" });
    // A node at the outline's root is no subject's, so no script adds one there.
    expect(
      await invoke(ctx, {
        id: "node.add",
        input: { text: "loose" },
        ...asScript("n.a", "node.add"),
      }),
    ).toMatchObject({ status: "failed", code: "forbidden" });
  });

  test("a script is configuration: an agent writes one with approval, a script never, a person freely", async () => {
    const ctx = await openKb(root);
    expect(await invoke(ctx, mint("s.agent", { actor: "agent" }))).toMatchObject({
      status: "failed",
      code: "approval_required",
      details: { writes: "configuration" },
    });
    expect(await invoke(ctx, mint("s.agent", { actor: "agent", approved: true }))).toMatchObject({
      status: "succeeded",
    });
    await invoke(ctx, { id: "node.add", input: { id: "n.host", text: "host" } });
    expect(
      await invoke(ctx, {
        ...mint("s.script", asScript("n.host", "node.add")),
        input: { id: "s.script", text: "badges", tags: ["script"], parent: "n.host" },
      }),
    ).toMatchObject({ status: "failed", details: { writes: "configuration" } });
    expect(
      await invoke(ctx, {
        id: "node.update",
        input: { id: "s.agent", text: "rewritten" },
        ...asScript("s.agent", "node.update"),
      }),
    ).toMatchObject({ status: "failed", details: { writes: "configuration" } });
    expect(await invoke(ctx, mint("s.person", { actor: "human" }))).toMatchObject({
      status: "succeeded",
    });
  });

  test("attaching a script is configuration: trusted code acts only where a person chose", async () => {
    const ctx = await openKb(root);
    expect(await invoke(ctx, mint("s.trusted", { actor: "human" }))).toMatchObject({
      status: "succeeded",
    });
    await invoke(ctx, {
      id: "node.add",
      input: { id: "n.board", text: "Board", tags: ["canvas"] },
      actor: "human",
    });
    expect(await invoke(ctx, attach({ actor: "agent" }))).toMatchObject({
      status: "failed",
      code: "approval_required",
      details: { writes: "configuration" },
    });
    // A script attaches no script: one beyond its board is out of its reach, and one on it is configuration.
    expect(await invoke(ctx, attach(asScript("n.board", "node.update")))).toMatchObject({
      status: "failed",
      code: "forbidden",
      details: { outside: ["s.trusted"] },
    });
    await invoke(ctx, {
      ...mint("s.onboard", { actor: "human" }),
      input: { id: "s.onboard", text: "badges", tags: ["script"], parent: "n.board" },
    });
    expect(
      await invoke(ctx, {
        id: "node.update",
        input: {
          id: "n.board",
          setProps: [{ field: CODE_IDS.scriptsField, value: { t: "ref", v: "s.onboard" } }],
        },
        ...asScript("n.board", "node.update"),
      }),
    ).toMatchObject({ status: "failed", details: { writes: "configuration" } });
    expect(await invoke(ctx, attach({ actor: "agent", approved: true }))).toMatchObject({
      status: "succeeded",
    });
    // Taking it off again is configuration too.
    expect(
      await invoke(ctx, {
        id: "node.update",
        input: { id: "n.board", unsetProps: [{ field: CODE_IDS.scriptsField }] },
        actor: "agent",
      }),
    ).toMatchObject({ status: "failed", code: "approval_required" });
    expect(await invoke(ctx, attach({ actor: "human" }))).toMatchObject({ status: "succeeded" });
  });

  test("only a person trusts code, by the digest of what runs, and never in the graph", async () => {
    const ctx = await openKb(root);
    const grant = { reads: "subject" as const, actions: [] };
    const digest = await Effect.runPromise(codeDigest("kb.draw('a')", grant));
    const edited = await Effect.runPromise(codeDigest("kb.draw('a');", grant));
    const trust = (rest: Partial<ActionInvocation>): ActionInvocation => ({
      id: "sandbox.trust",
      input: { digest },
      ...rest,
    });
    expect(await invoke(ctx, trust({ actor: "agent" }))).toMatchObject({
      code: "forbidden",
      details: { policy: "approval.agent-trust" },
    });
    expect(await invoke(ctx, trust({ actor: "agent", approved: true }))).toMatchObject({
      code: "forbidden",
    });
    expect(await invoke(ctx, trust({ actor: "script", approved: true }))).toMatchObject({
      code: "forbidden",
      details: { policy: "approval.script-trust" },
    });
    expect(await invoke(ctx, trust({ actor: "cli" }))).toMatchObject({
      code: "approval_required",
    });
    expect(
      await invoke(ctx, trust({ input: { digest: "sha256:nope" }, actor: "human" })),
    ).toMatchObject({ code: "invalid_input" });
    const before = await readFile(join(root, ".kb", "nodes.jsonl"), "utf8");
    expect(await invoke(ctx, trust({ actor: "human" }))).toMatchObject({ status: "succeeded" });
    expect(await readFile(join(root, ".kb", "nodes.jsonl"), "utf8")).toBe(before);
    const trusted = await invoke(ctx, {
      id: "sandbox.trusted",
      input: { digests: [digest, edited] },
      actor: "cli",
    });
    // Changing one character of the code is a digest nobody has trusted.
    expect(trusted).toMatchObject({ status: "succeeded", output: { trusted: [digest] } });
    expect(
      await invoke(ctx, { id: "sandbox.untrust", input: { digest }, actor: "agent" }),
    ).toMatchObject({ status: "succeeded" });
  });

  test("kb.manifest tells each actor what is decided about its own calls", async () => {
    const ctx = await openKb(root);
    const decisions = async (actor: ActionInvocation["actor"]) => {
      const receipt = await invoke(ctx, { id: "kb.manifest", input: {}, actor });
      if (receipt.status !== "succeeded") throw new Error(receipt.message);
      const actions = ManifestSchema.parse(receipt.output).actions;
      return Object.fromEntries(
        actions
          .filter((action) => ["node.delete", "node.add"].includes(action.id))
          .map((action) => [action.id, action.decision]),
      );
    };
    expect(await decisions("agent")).toEqual({ "node.add": "allow", "node.delete": "ask" });
    expect(await decisions("cli")).toEqual({ "node.add": "allow", "node.delete": "allow" });
  });

  test("a write to a policy needs a person behind it, and is refused before anything is written", async () => {
    const ctx = await openKb(root);
    const policy = "approval.agent-delete";
    const textOf = () => ctx.index.getNode(policy)?.text;
    const before = textOf();
    const edit = (rest: Partial<ActionInvocation>): ActionInvocation => ({
      id: "node.update",
      input: { id: policy, text: "agents never ask" },
      ...rest,
    });
    for (const actor of ["agent", "cli"] as const) {
      expect(await invoke(ctx, edit({ actor }))).toMatchObject({
        status: "failed",
        code: "approval_required",
        details: { writes: "approval-policy" },
      });
    }
    // Deleting the list that files them deletes them too, so it asks as well.
    expect(
      await invoke(ctx, { id: "node.delete", input: { id: SYSTEM_IDS.approvalPolicies } }),
    ).toMatchObject({ status: "failed", code: "approval_required" });
    expect(textOf()).toBe(before);
    // A person's own gesture, or an approved call, writes it.
    expect(await invoke(ctx, edit({ actor: "human" }))).toMatchObject({ status: "succeeded" });
    expect(textOf()).toBe("agents never ask");
    expect(await invoke(ctx, edit({ actor: "agent", approved: true }))).toMatchObject({
      status: "succeeded",
    });
  });

  test("a policy written a moment ago decides the very next call", async () => {
    const ctx = await openKb(root);
    const add = { id: "node.add", input: { text: "x" }, actor: "cli" } as const;
    expect((await invoke(ctx, add)).status).toBe("succeeded");
    const written = await invoke(ctx, {
      id: "node.add",
      approved: true,
      input: {
        id: "p.no-adds",
        text: "nobody adds",
        props: [
          { field: SYSTEM_IDS.typeField, value: { t: "ref", v: SYSTEM_IDS.approvalPolicyTag } },
          { field: SYSTEM_IDS.approvalMatchField, value: { t: "str", v: "node.add" } },
          {
            field: SYSTEM_IDS.approvalDecisionField,
            value: { t: "ref", v: DECISION_OPTION_IDS.deny },
          },
        ],
      },
    });
    expect(written.status).toBe("succeeded");
    expect(await invoke(ctx, add)).toMatchObject({
      status: "failed",
      code: "forbidden",
      details: { policy: "p.no-adds" },
    });
  });
});
