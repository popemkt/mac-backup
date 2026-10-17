/**
 * The page token (DESIGN.md → Surfaces → The page token): the secret a
 * `kb ui` mints when it starts, which proves a request is its own page's.
 * The page URL carries it in the fragment, which a browser never sends in a
 * request, so a program that fetches the page does not get it. The page
 * keeps it for its tab and sends it on every `/api` request and on the
 * `/ws` handshake. This module is how each side spells it; who holds it, and
 * what it proves, are the server's (`guard.ts`).
 */

/** The request header the page sends the token in. */
export const PAGE_TOKEN_HEADER = "x-kb-page-token";

/**
 * The WebSocket subprotocol a page offers, and the server answers with: a
 * browser cannot set a header on a handshake, so the token rides beside it
 * as a second subprotocol, which the server never answers with.
 */
export const PAGE_PROTOCOL = "kb";

const TOKEN_PROTOCOL = `${PAGE_PROTOCOL}.page-token.`;

/** The fragment key the token is under in a page URL. */
const FRAGMENT_KEY = "token";

/** The page at `url` of the `kb ui` whose token is `token`: the URL that opens it as the page. */
export function pageUrlOf(url: string, token: string): string {
  const page = new URL(url);
  page.hash = new URLSearchParams({ [FRAGMENT_KEY]: token }).toString();
  return page.toString();
}

/** The token a page URL carries in its fragment, or null when it carries none. */
export function pageTokenOf(url: string): string | null {
  const token = new URLSearchParams(new URL(url).hash.slice(1)).get(FRAGMENT_KEY);
  return token === "" ? null : token;
}

/** `url` with no token in its fragment, as the page leaves its address bar. */
export function withoutPageToken(url: string): string {
  const bare = new URL(url);
  const rest = new URLSearchParams(bare.hash.slice(1));
  rest.delete(FRAGMENT_KEY);
  bare.hash = rest.toString();
  return bare.toString();
}

/** The subprotocols a page's WebSocket offers: the one the server answers with, then the token. */
export function pageProtocols(token: string): string[] {
  return [PAGE_PROTOCOL, `${TOKEN_PROTOCOL}${token}`];
}

/** The token a handshake offers in its `Sec-WebSocket-Protocol`, or null when it offers none. */
export function offeredPageToken(protocols: string | null): string | null {
  const offered = (protocols ?? "")
    .split(",")
    .map((protocol) => protocol.trim())
    .find((protocol) => protocol.startsWith(TOKEN_PROTOCOL));
  return offered === undefined ? null : offered.slice(TOKEN_PROTOCOL.length);
}
