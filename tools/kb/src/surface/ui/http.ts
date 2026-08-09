import { relative } from "node:path";
import { z } from "zod";
import { reload, type KbContext } from "../../context.ts";
import { invoke, manifest } from "../../registry.ts";
import { serveKbAsset, serveStatic, UI_DIST } from "./assets.ts";
import { listSavedQueries } from "./saved-queries.ts";
import type { SubscriptionHub } from "./session.ts";

const ActionInvocationSchema = z.object({
  id: z.string().min(1),
  input: z.unknown().optional(),
});

export interface UiHttpDeps {
  root: string;
  ctx: KbContext;
  hub: SubscriptionHub;
}

/**
 * HTTP/API routing for `kb ui` (everything except WebSocket upgrade).
 * Ownership: REST endpoints, kb asset GET, SPA static fallback.
 */
export async function handleHttpRequest(
  req: Request,
  deps: UiHttpDeps,
): Promise<Response> {
  const { root, ctx, hub } = deps;
  const url = new URL(req.url);

  try {
    if (url.pathname === "/api/graph" && req.method === "GET") {
      return Response.json(hub.snapshot);
    }

    if (url.pathname === "/api/manifest" && req.method === "GET") {
      return Response.json(await manifest(root));
    }

    if (url.pathname === "/api/queries" && req.method === "GET") {
      const queries = await listSavedQueries(root);
      return Response.json(queries);
    }

    if (url.pathname === "/api/action" && req.method === "POST") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return Response.json(
          {
            status: "failed",
            id: "unknown",
            code: "invalid_input",
            message: "request body must be JSON",
          },
          { status: 400 },
        );
      }

      const parsed = ActionInvocationSchema.safeParse(body);
      if (!parsed.success) {
        return Response.json(
          {
            status: "failed",
            id: "unknown",
            code: "invalid_input",
            message: parsed.error.issues.map((i) => i.message).join("; "),
          },
          { status: 400 },
        );
      }

      // Fresh load so we don't miss external writes, then invoke.
      await reload(ctx);
      const receipt = await invoke(ctx, {
        id: parsed.data.id,
        input: parsed.data.input ?? {},
      });
      // Immediate bump/broadcast — do not wait for fs.watch.
      hub.applyNodes(ctx.nodes);
      return Response.json(receipt);
    }

    // W6a: opaque media files — before SPA / ui/dist so /assets never
    // falls through to index.html.
    if (
      (url.pathname === "/assets" || url.pathname.startsWith("/assets/")) &&
      req.method === "GET"
    ) {
      // await so rejected asset promises hit the catch → 500 (not an unhandled reject)
      return await serveKbAsset(root, url.pathname);
    }

    if (url.pathname.startsWith("/api/") || url.pathname === "/ws") {
      return new Response("not found", { status: 404 });
    }

    const staticResp = await serveStatic(url.pathname);
    if (staticResp) return staticResp;

    return Response.json(
      {
        error: "ui_not_built",
        message:
          "kb UI assets not found; build tools/kb/ui (ui/dist) or use the API/WS endpoints",
        hint: relative(process.cwd(), UI_DIST),
      },
      { status: 503 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { status: "failed", code: "internal", message },
      { status: 500 },
    );
  }
}
