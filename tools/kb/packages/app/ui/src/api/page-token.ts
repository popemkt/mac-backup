/**
 * The page token on the page's side (DESIGN.md → Surfaces → The page token).
 * The URL that opened this tab carries it in its fragment. The page keeps it
 * in the tab's sessionStorage, so a reload keeps it, takes it out of the
 * address bar, and sends it on every `/api` request and on the `/ws`
 * handshake. A tab opened without one is a local program's page: it reads,
 * and the server asks for what an agent asks for.
 */
import { PAGE_TOKEN_HEADER, pageProtocols, pageTokenOf, withoutPageToken } from "@kb/contracts";

const STORAGE_KEY = "kb.page-token";

/** The token this load holds, once it is adopted or read back. */
let held: string | null = null;

function stored(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Take the token the address carries into the tab's storage and out of the
 * address bar. Runs once, before anything calls the server.
 */
export function adoptPageToken(): void {
  const token = pageTokenOf(window.location.href);
  if (token === null) return;
  held = token;
  try {
    sessionStorage.setItem(STORAGE_KEY, token);
  } catch {
    // A tab that cannot keep it still holds it until it reloads.
  }
  window.history.replaceState(window.history.state, "", withoutPageToken(window.location.href));
}

function pageToken(): string | null {
  held ??= stored();
  return held;
}

/** The headers that make a request this page's. */
export function pageHeaders(): Record<string, string> {
  const token = pageToken();
  return token === null ? {} : { [PAGE_TOKEN_HEADER]: token };
}

/** The subprotocols this page's socket offers. */
export function socketProtocols(): string[] {
  const token = pageToken();
  return token === null ? [] : pageProtocols(token);
}
