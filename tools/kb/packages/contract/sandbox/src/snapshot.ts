/**
 * A run drawn as of a moment (DESIGN.md → Sandbox → Snapshots): what its
 * code draws, run where no browser is — a code view's figure on a
 * `ui://kb/view/<id>` resource, or `render.view` as html. It runs until the
 * run is quiet or its budget is spent, and hands back the last drawing as
 * static HTML built from the allowlist. Which engine runs it, and where its
 * calls go, is its caller's to say.
 */
import { Duration, Effect } from "effect";
import type { CodeGrant } from "./grant.ts";
import { answerToolCall, type CapabilityHost } from "./capability.ts";
import { drawingToHtml } from "./drawing.ts";
import type { SandboxEngine } from "./engine.ts";
import { runGuest } from "./guest.ts";
import { ENGINE_LIMITS } from "./limits.ts";
import type { GuestEnd } from "./protocol.ts";

/** One run to draw: its code, its grant, and the node it is shown for. */
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
