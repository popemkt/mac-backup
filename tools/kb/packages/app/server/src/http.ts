import { relative } from "node:path";
import { Cause, Effect, Option } from "effect";
import type { FileSystem } from "effect/FileSystem";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import {
  ActionInvocationSchema,
  TxOrigin,
  listedOn,
  type ActionResponse,
  type KbContext,
  type ServerIdentity,
  type SurfaceWire,
} from "@kb/contracts";
import { type ActionHandlerEnv, manifest } from "@kb/runtime";
import { canonicalRoot } from "@kb/workspace-fs";
import * as assets from "./assets.ts";
import { serverInvoke } from "./invoke.ts";
import { listSavedQueriesEffect } from "./saved-queries.ts";
import { serverRuntimeLayer } from "./screens.ts";
import type { SubscriptionHub } from "./session.ts";

/**
 * HTTP's wire: `POST /api/action` takes the invocation envelope, so it carries
 * `approved`, and `GET /api/manifest` lists every action ({@link listedOn}).
 */
export const HTTP_WIRE: SurfaceWire = { carriesApproval: true };

/** Match Bun/Web `Response.json` Content-Type exactly. */
const JSON_CONTENT_TYPE = "application/json;charset=utf-8";

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

/** A read of the API: a `GET` that answers JSON. */
type JsonRead = (deps: UiHttpDeps) => Effect.Effect<unknown, never, FileSystem>;

/** The API's reads, by path. */
const JSON_READS: ReadonlyMap<string, JsonRead> = new Map<string, JsonRead>([
  ["/api/graph", ({ hub }) => Effect.succeed(hub.snapshot)],
  [
    "/api/manifest",
    ({ root }) =>
      manifest(root).pipe(
        Effect.map((entries) => entries.filter((entry) => listedOn(HTTP_WIRE, entry.mode))),
      ),
  ],
  ["/api/queries", ({ root }) => listSavedQueriesEffect(root)],
  [
    "/api/identity",
    ({ root }) =>
      canonicalRoot(root).pipe(Effect.map((served): ServerIdentity => ({ root: served }))),
  ],
]);

/**
 * HTTP/API routing for `kb ui` (WebSocket upgrade stays on the Bun.serve
 * boundary in `server.ts`).
 *
 * Genuine Effect program: route dispatch, asset reads, saved-query reads,
 * store reloads and snapshot reads are all Effect programs. Content-Type
 * matches the pre-Effect surface (`Response.json` charset + bare text bodies).
 */
const handleHttpRequestEffect = (
  req: Request,
  deps: UiHttpDeps,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, ActionHandlerEnv> =>
  Effect.gen(function* () {
    const { root, ctx } = deps;
    const url = new URL(req.url);

    const read = req.method === "GET" ? JSON_READS.get(url.pathname) : undefined;
    if (read !== undefined) {
      return jsonResponse(yield* read(deps));
    }

    // The request guard (`guard.ts`) has already refused another site's page,
    // so only the UI and local programs reach this.
    if (url.pathname === "/api/action" && req.method === "POST") {
      const body = yield* Effect.tryPromise(() => req.json()).pipe(Effect.option);
      if (Option.isNone(body)) {
        return invalidInput("request body must be JSON");
      }

      const parsed = ActionInvocationSchema.safeParse(body.value);
      if (!parsed.success) {
        return invalidInput(parsed.error.issues.map((i) => i.message).join("; "));
      }

      const receipt = yield* serverInvoke(ctx, parsed.data).pipe(
        Effect.provideService(TxOrigin, req.headers.get("x-kb-origin") ?? undefined),
      );
      // The head once the invocation has committed: the rev a client waits
      // for before it lets the server's image replace its own (protocol.ts →
      // ActionResponseSchema).
      const response: ActionResponse =
        receipt.status === "succeeded" ? { ...receipt, rev: ctx.log.head } : receipt;
      return jsonResponse(response);
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
 * Promise facade for the HTTP layer: runs the routing Effect against the
 * server's runtime Layer (FileSystem + store + session + templates + the
 * screens this server holds) and converts the response to a Web `Response`.
 */
export function handleHttpRequest(req: Request, deps: UiHttpDeps): Promise<Response> {
  return Effect.runPromise(
    handleHttpRequestEffect(req, deps).pipe(
      Effect.provide(serverRuntimeLayer(deps.ctx, deps.hub.screens)),
      Effect.map(HttpServerResponse.toWeb),
    ),
  );
}
