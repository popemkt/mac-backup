import { Effect, Result } from "effect";
import { KbCtx } from "@kb/contracts";
import type { FailureCode } from "@kb/model";
import { docsViewNamed, docsViewsOf, type DocsView, type DocsViews } from "@kb/views";

/** Typed failure for docs operations; registry maps it to a receipt. */
export class DocsError extends Error {
  readonly code: FailureCode;
  readonly details?: unknown;

  constructor(code: FailureCode, message: string, details?: unknown) {
    super(message);
    this.name = "DocsError";
    this.code = code;
    this.details = details;
  }
}

/** Every docs view in the session, read by `docsViewsOf` (`@kb/views`). */
export const docsViewsEffect = Effect.fn("docs.views")(function* (): Effect.fn.Return<
  DocsViews,
  never,
  KbCtx
> {
  return docsViewsOf((yield* KbCtx).nodes);
});

/** The docs view `name` names, or why there is none it can be (`docsViewNamed`). */
export const docsViewEffect = Effect.fn("docs.view")(function* (
  name: string,
): Effect.fn.Return<DocsView, DocsError, KbCtx> {
  const view = docsViewNamed((yield* KbCtx).nodes, name);
  if (Result.isSuccess(view)) return view.success;
  const { code, message, details } = view.failure;
  return yield* Effect.fail(new DocsError(code, message, details));
});
