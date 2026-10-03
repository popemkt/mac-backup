/**
 * A code view as of a moment (DESIGN.md → Sandbox → Snapshots): what its code
 * draws, run where no browser is — a `ui://kb/view/<id>` resource, or
 * `render.view` as html. A snapshot is a read, so its run may only read: the
 * runtime's capability host refuses every write. It runs untrusted, whatever
 * this machine trusts, until the run is quiet or its budget is spent, and
 * hands back the last drawing as static HTML built from the allowlist.
 */
import { Context, Duration, Effect } from "effect";
import type { CodeGrant } from "@kb/views";
import { answerToolCall, type CapabilityHost } from "./capability.ts";
import { drawingToHtml } from "./drawing.ts";
import type { SandboxEngine } from "./engine.ts";
import { runGuest } from "./guest.ts";
import { ENGINE_LIMITS } from "./limits.ts";
import type { GuestEnd } from "./protocol.ts";

/** One code view to draw: its code, its grant, and the node it is shown for. */
export interface CodeRun {
  readonly code: string;
  readonly grant: CodeGrant;
  readonly subject: string | null;
}

/** What a snapshot shows: the last drawing, and how the run ended if it did. */
export interface CodeSnapshot {
  readonly html: string | null;
  readonly end: GuestEnd | null;
}

export interface CodeSnapshotter {
  draw(run: CodeRun): Effect.Effect<CodeSnapshot>;
}

/**
 * The snapshotter a runtime provides. A surface that provides none shows a
 * code view as its text (its code and grant), so nothing downstream gains a
 * requirement.
 */
export const CodeSnapshots = Context.Reference<CodeSnapshotter | null>("kb/CodeSnapshots", {
  defaultValue: () => null,
});

/** How long a snapshot waits for its run to go quiet. */
export const SNAPSHOT_BUDGET_MS = 2_000;

/** Draw `run` with `engine`, its calls answered by `host`, until it is quiet or `budgetMs` passes. */
export const snapshotRun = Effect.fn("sandbox.snapshotRun")(function* (
  engine: SandboxEngine,
  host: CapabilityHost,
  run: CodeRun,
  budgetMs: number = SNAPSHOT_BUDGET_MS,
): Effect.fn.Return<CodeSnapshot> {
  const limits = ENGINE_LIMITS[engine.kind];
  let html: string | null = null;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const guest = yield* runGuest(
        engine,
        { code: run.code, subject: run.subject, limits },
        {
          draw: (drawing) =>
            Effect.sync(() => {
              html = drawingToHtml(drawing.nodes);
            }),
          log: () => Effect.void,
          callTool: (call) =>
            answerToolCall(host, { grant: run.grant, subject: run.subject }, limits, call),
        },
      );
      yield* guest.settled.pipe(Effect.timeoutOption(Duration.millis(budgetMs)));
      const end = (yield* guest.over) ? yield* guest.ended : null;
      return { html, end };
    }),
  );
});
