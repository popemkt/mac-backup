import { Effect, Layer, Option, Predicate } from "effect";
import type { FileSystem } from "effect/FileSystem";
import {
  ActionResponseSchema,
  SCREEN_COMMAND_TIMEOUT_MS,
  ScreenListSchema,
  ScreenReceiptSchema,
  ServerIdentitySchema,
  Screens,
  noTabReceipt,
  type ScreenList,
  type ScreenReceipt,
  type UiCaptureInput,
  type UiNavigateInput,
  type UiSelectInput,
} from "@kb/contracts";
import { domainError, type DomainError } from "@kb/model";
import { uiCaptureDef, uiNavigateDef, uiScreenDef, uiSelectDef } from "@kb/operations";
import { canonicalRoot, readUiPresence } from "@kb/workspace-fs";

/** How much longer than the command's own wait the server gets to answer. */
const ANSWER_MARGIN_MS = 2000;

/** How long the server named in `.kb/ui.json` gets to say which root it serves. */
const PROBE_MS = 500;

/** Whether a request failed because nothing listens at its address (Bun's and Node's codes). */
function refused(cause: unknown): boolean {
  if (!Predicate.hasProperty(cause, "code")) return false;
  return cause.code === "ConnectionRefused" || cause.code === "ECONNREFUSED";
}

/** What a decoded answer is, or why it is not one. */
type Decoded<A> = { success: true; data: A } | { success: false; error: { message: string } };

/**
 * The {@link Screens} port for every process that is not the `kb ui` server:
 * the CLI, `kb mcp`, a test. The tabs live in the server that serves this
 * root, so each call asks that server, found through `.kb/ui.json`, the same
 * `ui.*` action its caller invoked; the server's own adapter answers it. A
 * root no server serves has no tabs: the list is empty and a command gets
 * `no-tab`. So does a presence file whose server no longer answers, or
 * whose port a server of another root now holds.
 */
export function remoteScreensLayer(root: string): Layer.Layer<Screens, never, FileSystem> {
  return Layer.effect(
    Screens,
    Effect.gen(function* () {
      const context = yield* Effect.context<FileSystem>();

      /**
       * The URL of the `kb ui` that serves this root now, or null. The
       * presence file only says where one was: the server there is asked
       * which root it serves, briefly, and anything short of this root's
       * own answer (no file, nothing listening, too slow, another root)
       * means no server.
       */
      const serving = Effect.fn("kb.screens.serving")(function* (): Effect.fn.Return<
        string | null,
        DomainError,
        FileSystem
      > {
        const presence = yield* readUiPresence(root);
        if (presence === null) return null;
        const expected = yield* canonicalRoot(root);
        const identity = yield* Effect.tryPromise((signal) =>
          fetch(`${presence.url}/api/identity`, { signal }),
        ).pipe(
          Effect.flatMap((res) => Effect.tryPromise(() => res.json())),
          Effect.map((body) => ServerIdentitySchema.safeParse(body)),
          Effect.timeoutOption(PROBE_MS),
          Effect.orElseSucceed(() => Option.none()),
        );
        if (Option.isNone(identity) || !identity.value.success) return null;
        return identity.value.data.root === expected ? presence.url : null;
      });

      const ask = Effect.fn("kb.screens.ask")(function* <A>(
        id: string,
        input: unknown,
        waitMs: number,
        decode: (output: unknown) => Decoded<A>,
        none: A,
      ): Effect.fn.Return<A, DomainError, FileSystem> {
        const url = yield* serving();
        if (url === null) return none;
        const post = Effect.tryPromise({
          try: (signal) =>
            fetch(`${url}/api/action`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ id, input }),
              signal,
            }),
          // Nothing listens there, or the request failed some other way.
          catch: (cause) => (refused(cause) ? ("gone" as const) : ("failed" as const)),
        }).pipe(
          Effect.flatMap((res) =>
            Effect.tryPromise(() => res.json()).pipe(
              Effect.orElseSucceed((): unknown => null),
              Effect.map((body) => ({ status: res.status, body })),
            ),
          ),
        );
        const sent = yield* post.pipe(
          Effect.timeoutOption(waitMs + ANSWER_MARGIN_MS),
          Effect.catch((failure) =>
            failure === "gone"
              ? Effect.succeed(null)
              : Effect.fail(domainError("internal", `kb ui at ${url} could not be asked ${id}`)),
          ),
        );
        // Nothing listens where the presence file points: its server has gone.
        if (sent === null) return none;
        if (Option.isNone(sent)) {
          return yield* domainError("internal", `kb ui at ${url} did not answer ${id} in time`);
        }
        const { status, body } = sent.value;
        const response = ActionResponseSchema.safeParse(body);
        if (!response.success) {
          return yield* domainError("internal", `kb ui at ${url} answered ${id} with ${status}`);
        }
        if (response.data.status === "failed") {
          const { code, message } = response.data;
          return yield* domainError(
            "internal",
            `kb ui at ${url} failed ${id} (${code}): ${message}`,
          );
        }
        const output = decode(response.data.output);
        if (!output.success) {
          return yield* domainError(
            "internal",
            `kb ui at ${url} answered ${id} with output its schema rejects: ${output.error.message}`,
          );
        }
        return output.data;
      });

      const command = (id: string, input: UiNavigateInput | UiSelectInput | UiCaptureInput) =>
        ask<ScreenReceipt>(
          id,
          input,
          input.timeoutMs ?? SCREEN_COMMAND_TIMEOUT_MS,
          (output) => ScreenReceiptSchema.safeParse(output),
          noTabReceipt(input.tab),
        ).pipe(Effect.provide(context));

      return Screens.of({
        screen: (input) =>
          ask<ScreenList>(
            uiScreenDef.id,
            input,
            0,
            (output) => ScreenListSchema.safeParse(output),
            { tabs: [] },
          ).pipe(Effect.provide(context)),
        navigate: (input) => command(uiNavigateDef.id, input),
        select: (input) => command(uiSelectDef.id, input),
        capture: (input) => command(uiCaptureDef.id, input),
      });
    }),
  );
}
