import { relative } from "node:path";
import { Cause, Effect, Option } from "effect";
import { type FileSystem } from "effect/FileSystem";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { z } from "zod";
import type { KbContext } from "@kb/contracts";
import { reloadEffect } from "@kb/operations";
import { kbStoreLayer, KbCtx, type KbStore } from "@kb/contracts";
import { bunFileSystemLayer } from "@kb/store-jsonl";
import { invokeReceiptEffect, manifest } from "@kb/runtime";
import * as assets from "./assets.ts";
import { listSavedQueriesEffect } from "./saved-queries.ts";
import type { SubscriptionHub } from "./session.ts";

/** Match Bun/Web `Response.json` Content-Type exactly. */
const JSON_CONTENT_TYPE = "application/json;charset=utf-8";

const ActionInvocationSchema = z.object({
  id: z.string().min(1),
  input: z.unknown().optional(),
});

export interface UiHttpDeps {
  root: string;
  ctx: KbContext;
  hub: SubscriptionHub;
}

function jsonResponse(
  body: unknown,
  options?: { status?: number },
): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.jsonUnsafe(body, {
    status: options?.status,
    contentType: JSON_CONTENT_TYPE,
  });
}

/** Match pre-Effect `new Response(body, { status })` — no Content-Type. */
function plainStatus(body: string, status: number): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.raw(body, { status });
}

function internalFailure(err: unknown): HttpServerResponse.HttpServerResponse {
  const message = err instanceof Error ? err.message : String(err);
  return jsonResponse({ status: "failed", code: "internal", message }, { status: 500 });
}

function invalidInput(message: string): HttpServerResponse.HttpServerResponse {
  return jsonResponse(
    { status: "failed", id: "unknown", code: "invalid_input", message },
    { status: 400 },
  );
}

/**
 * HTTP/API routing for `kb ui` (WebSocket upgrade stays on the Bun.serve
 * boundary in `server.ts`).
 *
 * Genuine Effect program: route dispatch, asset reads, saved-query reads,
 * store reloads and hub broadcasts are all Effect programs. Content-Type
 * matches the pre-Effect surface (`Response.json` charset + bare text bodies).
 */
export const handleHttpRequestEffect = (
  req: Request,
  deps: UiHttpDeps,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, FileSystem | KbStore | KbCtx> =>
  Effect.gen(function* () {
    const { root, ctx, hub } = deps;
    const url = new URL(req.url);

    if (url.pathname === "/api/graph" && req.method === "GET") {
      return jsonResponse(hub.snapshot);
    }

    if (url.pathname === "/api/manifest" && req.method === "GET") {
      return jsonResponse(yield* Effect.promise(() => manifest(root)));
    }

    if (url.pathname === "/api/queries" && req.method === "GET") {
      return jsonResponse(yield* listSavedQueriesEffect(root));
    }

    if (url.pathname === "/api/action" && req.method === "POST") {
      const body = yield* Effect.tryPromise(() => req.json()).pipe(Effect.option);
      if (Option.isNone(body)) {
        return invalidInput("request body must be JSON");
      }

      const parsed = ActionInvocationSchema.safeParse(body.value);
      if (!parsed.success) {
        return invalidInput(parsed.error.issues.map((i) => i.message).join("; "));
      }

      // Fresh load so we don't miss external writes, then invoke natively.
      yield* reloadEffect(ctx);
      const receipt = yield* invokeReceiptEffect(ctx, {
        id: parsed.data.id,
        input: parsed.data.input ?? {},
      });
      // Immediate bump/broadcast — do not wait for fs.watch.
      yield* hub.applyNodes(ctx.nodes, req.headers.get("x-kb-origin") ?? undefined);
      return jsonResponse(receipt);
    }

    // W6a: opaque media files — before SPA / ui/dist so /assets never
    // falls through to index.html.
    if (
      (url.pathname === "/assets" || url.pathname.startsWith("/assets/")) &&
      req.method === "GET"
    ) {
      return yield* assets.serveKbAssetEffect(root, url.pathname);
    }

    if (url.pathname.startsWith("/api/") || url.pathname === "/ws") {
      return plainStatus("not found", 404);
    }

    const staticResp = yield* assets.serveStaticEffect(url.pathname);
    if (staticResp) return staticResp;

    return jsonResponse(
      {
        error: "ui_not_built",
        message: "kb UI assets not found; build tools/kb/ui (ui/dist) or use the API/WS endpoints",
        hint: relative(process.cwd(), assets.UI_DIST),
      },
      { status: 503 },
    );
  }).pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.interrupt
        : Effect.succeed(internalFailure(Cause.squash(cause))),
    ),
  );

/**
 * Promise facade for the HTTP layer: runs the routing Effect with the
 * FileSystem/KbStore layers and converts the response to a Web `Response`.
 */
export function handleHttpRequest(req: Request, deps: UiHttpDeps): Promise<Response> {
  return Effect.runPromise(
    handleHttpRequestEffect(req, deps).pipe(
      Effect.provide(bunFileSystemLayer),
      Effect.provide(kbStoreLayer(deps.ctx.effectStore)),
      Effect.provideService(KbCtx, deps.ctx),
      Effect.map(HttpServerResponse.toWeb),
    ),
  );
}
