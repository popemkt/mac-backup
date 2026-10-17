/**
 * Who may reach the `kb ui` server's API, and on whose wire it calls: the
 * one request guard, applied to the `/ws` upgrade and every `/api/*` route
 * before anything else runs (`DESIGN.md` → Surfaces, the request guard and
 * the page token).
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
 *
 * Those keep other sites out; they do not say who is calling, since a local
 * program may send any Origin it likes. The page token does: a request that
 * carries this run's token is the page's, one that carries another is
 * refused, and one that carries none is a local program's, whatever its
 * Origin.
 */
import { timingSafeEqual } from "node:crypto";
import {
  PAGE_PROTOCOL,
  PAGE_TOKEN_HEADER,
  PAGE_WIRE,
  offeredPageToken,
  type SurfaceWire,
} from "@kb/contracts";

/**
 * HTTP's wire for a local program: a request that carries no page token
 * (the CLI's relay, curl, another app, or anything claiming the UI's
 * Origin). Its calls are an agent's, the more cautious caller: one cannot
 * say it is someone else, or that a person approved it, since nothing shows
 * a person stands behind it. The page's own requests are the page's wire
 * (`PAGE_WIRE`).
 */
export const HTTP_WIRE: SurfaceWire = { carriesApproval: false, actor: "agent" };

/** A page token: 32 random bytes, in hex. */
export function mintPageToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
}

/** Where the server listens, and where the browser loads the UI from. */
export interface GuardSite {
  /** The host the server was bound to. */
  readonly hostname: string;
  /** The port the server listens on. */
  readonly port: number;
  /** The port the UI page is served from: this server's, or the Vite dev server's. */
  readonly uiPort: number;
  /** Browser origin when a reverse proxy serves this UI. */
  readonly publicOrigin?: string;
  /** The page token this run minted. */
  readonly pageToken: string;
}

/** What the guard makes of a request: refused, or let through on a wire. */
type Admission = { readonly refused: Response } | { readonly wire: SurfaceWire };

export interface RequestGuard {
  readonly admit: (req: Request, url: URL) => Admission;
}

const LOOPBACK_NAMES = ["127.0.0.1", "localhost"];

function refusal(status: number, message: string): Response {
  return Response.json({ status: "failed", id: "unknown", code: "forbidden", message }, { status });
}

function isJson(contentType: string | null): boolean {
  const media = contentType?.split(";")[0]?.trim().toLowerCase();
  return media === "application/json";
}

/** The page token a request presents: in its header, or offered on its WebSocket handshake. */
function presentedToken(req: Request): string | null {
  return (
    req.headers.get(PAGE_TOKEN_HEADER) ??
    offeredPageToken(req.headers.get("sec-websocket-protocol"))
  );
}

/** Whether `presented` is `token`, compared in time that does not depend on where they differ. */
function sameToken(presented: string, token: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The response headers that accept a handshake on the page's subprotocol,
 * when it offers it: a browser closes a socket whose server answers with a
 * subprotocol it did not offer, or with none when it offered one.
 */
export function handshakeHeaders(req: Request): Record<string, string> {
  const offered = (req.headers.get("sec-websocket-protocol") ?? "")
    .split(",")
    .map((protocol) => protocol.trim());
  return offered.includes(PAGE_PROTOCOL) ? { "sec-websocket-protocol": PAGE_PROTOCOL } : {};
}

export function requestGuard(site: GuardSite): RequestGuard {
  const names = [...new Set([...LOOPBACK_NAMES, site.hostname])];
  const origins = new Set(
    names.flatMap((name) => [site.port, site.uiPort].map((port) => `http://${name}:${port}`)),
  );
  if (site.publicOrigin !== undefined) origins.add(new URL(site.publicOrigin).origin);
  const hosts = new Set([...origins].map((origin) => new URL(origin).host));
  const refused = (status: number, message: string): Admission => ({
    refused: refusal(status, message),
  });
  return {
    admit: (req, url) => {
      if (url.pathname !== "/ws" && !url.pathname.startsWith("/api/")) return { wire: HTTP_WIRE };
      const host = req.headers.get("host");
      if (host === null || !hosts.has(host)) {
        return refused(403, `host ${host ?? "(none)"} is not this kb ui`);
      }
      const origin = req.headers.get("origin");
      if (origin !== null && !origins.has(origin)) {
        return refused(403, `origin ${origin} is not this kb ui`);
      }
      if (
        url.pathname === "/api/action" &&
        req.method === "POST" &&
        !isJson(req.headers.get("content-type"))
      ) {
        return refused(415, "POST /api/action takes application/json");
      }
      const token = presentedToken(req);
      if (token === null) return { wire: HTTP_WIRE };
      if (!sameToken(token, site.pageToken)) {
        return refused(
          403,
          "this page's token is not this kb ui's (it is from an earlier run): open the page again from the URL kb ui printed, or with kb open",
        );
      }
      return { wire: PAGE_WIRE };
    },
  };
}
