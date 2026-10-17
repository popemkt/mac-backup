/**
 * `GraphWrites` (`@kb/contracts`) is core's write path as the port a family's
 * action writes through, and `kbRuntimeLayer` is its one binding (DESIGN.md →
 * Extension families). These are its promises, held over that binding: a
 * commit is one recorded transaction the session reads at once, a
 * transaction the graph refuses writes nothing, inside a call the commit is
 * decided as part of that call, and a plan is planned again over a store
 * that moved, so a write made in between is never lost.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import {
  CurrentCall,
  GraphWrites,
  type GraphWritesPort,
  type KbContext,
  type RunningCall,
} from "@kb/contracts";
import { present, type DomainError, type KbNode } from "@kb/model";
import { persist } from "@kb/test-kit";
import { kbRuntimeLayer } from "../src/layers.ts";
import { invoke } from "../src/invoke.ts";
import { openKb } from "../src/session.ts";

const AT = "2026-10-04T00:00:00.000Z";

function plainNode(id: string, text: string, children: string[] = []): KbNode {
  return { id, text, props: {}, children, createdAt: AT, updatedAt: AT };
}

/** Run `use` against the `GraphWrites` the runtime binds for `ctx`. */
function withWrites<A, E>(
  ctx: KbContext,
  use: (writes: GraphWritesPort) => Effect.Effect<A, E>,
): Promise<A> {
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* use(yield* GraphWrites);
    }).pipe(Effect.provide(kbRuntimeLayer(ctx))),
  );
}

/** The DomainError `use` fails with. */
function failureOf<A>(
  ctx: KbContext,
  use: (writes: GraphWritesPort) => Effect.Effect<A, DomainError>,
): Promise<DomainError> {
  return withWrites(ctx, (writes) => Effect.flip(use(writes)));
}

describe("GraphWrites, as kbRuntimeLayer binds it", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kb-graph-writes-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("a commit is one recorded transaction, read at once and after a reopen", async () => {
    const ctx = await openKb(root);
    const head = ctx.log.head;
    const tx = {
      upserts: [plainNode("n.parent", "parent", ["n.child"]), plainNode("n.child", "child")],
      deletes: [],
    };
    await withWrites(ctx, (writes) => writes.commit(() => Effect.succeed(tx)));
    expect(ctx.index.getNode("n.child")?.text).toBe("child");
    expect(ctx.log.head).toBe(head + 1);
    const reopened = await openKb(root);
    expect(present(reopened.index.getNode("n.parent"), "parent").children).toEqual(["n.child"]);
  });

  test("a transaction the graph refuses is refused whole, and writes nothing", async () => {
    const ctx = await openKb(root);
    const head = ctx.log.head;
    const broken = plainNode("n.orphan-parent", "parent", ["n.nowhere"]);
    const failure = await failureOf(ctx, (writes) =>
      writes.commit(() => Effect.succeed({ upserts: [broken], deletes: [] })),
    );
    expect(failure.code).toBe("invalid_input");
    expect(ctx.index.getNode("n.orphan-parent")).toBeUndefined();
    expect(ctx.log.head).toBe(head);
  });

  test("inside a call, a write to an approval policy needs a person behind it", async () => {
    const ctx = await openKb(root);
    const policy = present(ctx.index.getNode("approval.agent-delete"), "a seeded policy");
    const call: RunningCall = {
      invocation: { id: "ext.family.write", input: {}, actor: "agent" },
      action: { id: "ext.family.write", mode: { kind: "write" } },
    };
    const failure = await failureOf(ctx, (writes) =>
      writes
        .commit(() =>
          Effect.succeed({ upserts: [{ ...policy, text: "agents never ask" }], deletes: [] }),
        )
        .pipe(Effect.provideService(CurrentCall, call)),
    );
    expect(failure.code).toBe("approval_required");
    expect(ctx.index.getNode("approval.agent-delete")?.text).toBe(policy.text);
    // The same write by the person's own hand goes through.
    await invoke(ctx, {
      id: "node.update",
      input: { id: "approval.agent-delete", text: "agents never ask" },
      actor: "human",
    });
    expect(ctx.index.getNode("approval.agent-delete")?.text).toBe("agents never ask");
  });

  test("a plan is planned again over a store that moved, so the write in between is kept", async () => {
    const ctx = await openKb(root);
    await withWrites(ctx, (writes) =>
      writes.commit(() =>
        Effect.succeed({ upserts: [plainNode("n.target", "target", [])], deletes: [] }),
      ),
    );
    const other = await openKb(root);
    let plans = 0;
    await withWrites(ctx, (writes) =>
      writes.commit((nodes) =>
        Effect.gen(function* () {
          plans += 1;
          const target = present(
            nodes.find((n) => n.id === "n.target"),
            "the target",
          );
          // Another process renames the node after this plan read it.
          if (plans === 1) {
            yield* Effect.promise(() =>
              persist(other, { upserts: [{ ...target, text: "renamed" }], deletes: [] }),
            );
          }
          return {
            upserts: [{ ...target, props: { "n.mark": [{ t: "str", v: "x" }] } }],
            deletes: [],
          };
        }),
      ),
    );
    expect(plans).toBe(2);
    const reopened = present((await openKb(root)).index.getNode("n.target"), "the target");
    expect(reopened.text).toBe("renamed");
    expect(reopened.props["n.mark"]).toEqual([{ t: "str", v: "x" }]);
  });
});
