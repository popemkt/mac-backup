/**
 * Who may reach the `kb ui` server's API: the one request guard, applied to
 * the `/ws` upgrade and every `/api/*` route before anything else runs
 * (`DESIGN.md` → Surfaces, the request guard).
 *
 * The server listens on loopback, but a web page in the same browser can
 * still send it requests, so loopback alone does not keep other sites out.
 * Three checks do:
 *
 * - **Host** must name this server (`127.0.0.1:<port>`, `localhost:<port>`,
 *   or the host it was bound to). A page on another site that rebinds its
 *   own DNS name to 127.0.0.1 sends its own name here, so this is what stops
 *   DNS rebinding.
 * - **Origin**, when there is one, must be the UI's own. A browser always
 *   sends it on a cross-origin request and on every WebSocket handshake. A
 *   local program (the CLI, `kb mcp`, curl) sends none and is let through.
 * - **`POST /api/action`** must be `application/json`. A page may send a
 *   form or `text/plain` POST to any origin without a preflight; JSON needs
 *   one, which the Origin check then refuses.
 */

/** Where the server listens, and where the browser loads the UI from. */
export interface GuardSite {
  /** The host the server was bound to. */
  readonly hostname: string;
  /** The port the server listens on. */
  readonly port: number;
  /** The port the UI page is served from: this server's, or the Vite dev server's. */
  readonly uiPort: number;
}

export interface RequestGuard {
  /** A refusal for a request the guard does not let through, or null when it may pass. */
  readonly refuse: (req: Request, url: URL) => Response | null;
}

const LOOPBACK_NAMES = ["127.0.0.1", "localhost"];

function refusal(status: number, message: string): Response {
  return Response.json({ status: "failed", id: "unknown", code: "forbidden", message }, { status });
}

function isJson(contentType: string | null): boolean {
  const media = contentType?.split(";")[0]?.trim().toLowerCase();
  return media === "application/json";
}

export function requestGuard(site: GuardSite): RequestGuard {
  const names = [...new Set([...LOOPBACK_NAMES, site.hostname])];
  const hosts = new Set(names.map((name) => `${name}:${site.port}`));
  const origins = new Set(
    names.flatMap((name) => [site.port, site.uiPort].map((port) => `http://${name}:${port}`)),
  );
  return {
    refuse: (req, url) => {
      if (url.pathname !== "/ws" && !url.pathname.startsWith("/api/")) return null;
      const host = req.headers.get("host");
      if (host === null || !hosts.has(host)) {
        return refusal(403, `host ${host ?? "(none)"} is not this kb ui`);
      }
      const origin = req.headers.get("origin");
      if (origin !== null && !origins.has(origin)) {
        return refusal(403, `origin ${origin} is not this kb ui`);
      }
      if (
        url.pathname === "/api/action" &&
        req.method === "POST" &&
        !isJson(req.headers.get("content-type"))
      ) {
        return refusal(415, "POST /api/action takes application/json");
      }
      return null;
    },
  };
}
