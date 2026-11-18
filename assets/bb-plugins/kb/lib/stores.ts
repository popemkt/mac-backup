// The kb stores the plugin can reach, by name: what the person configured, what bb's environment declares, and
// which one a call goes to. Pure, so tests run on plain text and maps.
import { originOf } from "./kb.ts";

/** Where kb's API is reached from the bb server: kb ui's owner-only socket, or an http(s) origin. */
export type KbAddress = { readonly socket: string } | { readonly url: string };

/** One named kb store: the page the panel frames (null: tools only), and where its API is called. */
export interface KbConnection {
  readonly name: string;
  readonly page: string | null;
  readonly api: KbAddress;
}

/** The stores configured now, and the one a call goes to when it names none and no panel says otherwise. */
export interface KbStores {
  readonly connections: readonly KbConnection[];
  /** Null only when no store is configured. */
  readonly defaultName: string | null;
  /** Lines that could not be read, each saying why; the rest still count. */
  readonly problems: readonly string[];
}

/** The name of the store an old single-store configuration (KB_URL/KB_SOCKET, or the `url`/`socket` settings) becomes. */
export const LEGACY_NAME = "default";

const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * One store from its words: `<name> <page-url> [<socket-path> | <api-url>]`, or `<name> <socket-path>` for a
 * store the tools reach but the panel cannot frame. The page URL is also the API's address unless a socket or a
 * second URL says otherwise.
 */
export function parseConnection(line: string): KbConnection | string {
  const [name, ...rest] = line.trim().split(/\s+/);
  if (!NAME.test(name)) return `"${name}" is not a store name (lowercase letters, digits, . _ -)`;
  if (rest.length === 0 || rest.length > 2) return `${name}: expected a page URL and/or a socket path or API URL`;
  let page: string | null = null;
  let api: KbAddress | null = null;
  for (const [i, word] of rest.entries()) {
    if (word.startsWith("/")) {
      if (api !== null) return `${name}: more than one API address`;
      api = { socket: word };
    } else if (originOf(word) !== null) {
      if (i === 0) page = word;
      else if (api !== null) return `${name}: more than one API address`;
      else api = { url: word };
    } else {
      return `${name}: "${word}" is neither an http(s) URL nor an absolute socket path`;
    }
  }
  if (api === null) api = page === null ? null : { url: page };
  if (api === null) return `${name}: no address`;
  return { name, page, api };
}

/**
 * Stores, one per line or `;`-separated; `#` starts a comment. A later store of the same name replaces an
 * earlier one.
 */
export function parseConnections(text: string): { connections: KbConnection[]; problems: string[] } {
  const byName = new Map<string, KbConnection>();
  const problems: string[] = [];
  for (const raw of text.split(/[\n;]/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (line === "") continue;
    const parsed = parseConnection(line);
    if (typeof parsed === "string") problems.push(parsed);
    else {
      byName.delete(parsed.name);
      byName.set(parsed.name, parsed);
    }
  }
  return { connections: [...byName.values()], problems };
}

/** What the stores are read from: the plugin's settings and bb's environment. */
export interface StoreSources {
  /** The `connections` setting. */
  readonly connections: string;
  /** The `defaultKb` setting. */
  readonly defaultKb: string;
  readonly env: {
    readonly KB_CONNECTIONS?: string;
    readonly KB_DEFAULT?: string;
    readonly KB_URL?: string;
    readonly KB_SOCKET?: string;
  };
}

/**
 * The stores: bb's environment declares some (KB_CONNECTIONS, else KB_URL and KB_SOCKET as one store named
 * `default`), and the person's `connections` setting adds more or replaces one of the same name. The default is
 * the `defaultKb` setting, else KB_DEFAULT, else the first store.
 */
export function resolveStores({ connections, defaultKb, env }: StoreSources): KbStores {
  const declared = (env.KB_CONNECTIONS ?? "").trim();
  const legacy = [env.KB_URL, env.KB_SOCKET].map(v => (v ?? "").trim()).filter(v => v !== "");
  const fromEnv = parseConnections(declared !== "" ? declared : legacy.length > 0 ? `${LEGACY_NAME} ${legacy.join(" ")}` : "");
  const fromSettings = parseConnections(connections);
  const byName = new Map<string, KbConnection>();
  for (const c of [...fromEnv.connections, ...fromSettings.connections]) {
    byName.delete(c.name);
    byName.set(c.name, c);
  }
  const all = [...byName.values()];
  const problems = [
    ...fromEnv.problems.map(p => `bb's environment: ${p}`),
    ...fromSettings.problems.map(p => `connections setting: ${p}`),
  ];
  let defaultName: string | null = null;
  for (const [wanted, from] of [
    [defaultKb.trim(), "defaultKb setting"],
    [(env.KB_DEFAULT ?? "").trim(), "KB_DEFAULT"],
  ] as const) {
    if (wanted === "") continue;
    if (byName.has(wanted)) {
      defaultName = wanted;
      break;
    }
    problems.push(`${from}: no store named ${wanted}`);
  }
  return { connections: all, defaultName: defaultName ?? all[0]?.name ?? null, problems };
}

/**
 * The store a call goes to: the one it names, else the one the thread's kb tab shows, else the default. An
 * unknown name is an error that lists the names there are.
 */
export function chooseStore(
  stores: KbStores,
  named: string | undefined,
  shown: string | undefined,
): { connection: KbConnection } | { error: string } {
  const names = stores.connections.map(c => c.name);
  if (names.length === 0) {
    return {
      error:
        "kb is not configured: add a store to the kb plugin's connections (bb plugin config kb set connections '<name> <url>').",
    };
  }
  const wanted = named ?? (shown !== undefined && names.includes(shown) ? shown : (stores.defaultName ?? names[0]));
  const connection = stores.connections.find(c => c.name === wanted);
  return connection === undefined ? { error: `kb has no store named ${wanted}; configured: ${names.join(", ")}` } : { connection };
}

/** The stores as the agent reads them, one line: each name, which is the default, which the tab shows. */
export function storesLine(stores: KbStores, shown: string | undefined): string {
  const parts = stores.connections.map(c => {
    const marks = [
      ...(c.name === stores.defaultName ? ["default"] : []),
      ...(c.name === shown ? ["in the tab"] : []),
      ...(c.page === null ? ["no page"] : []),
    ];
    return marks.length === 0 ? c.name : `${c.name} (${marks.join(", ")})`;
  });
  return `kb stores (pass kb: <name> to choose): ${parts.join(", ")}`;
}

/** A legacy single-store setting as a `connections` line, or null when there is none. */
export function legacyLine(url: string, socket: string, env: StoreSources["env"]): string | null {
  const u = url.trim();
  const s = socket.trim();
  if (u === "" && s === "") return null;
  const words = [u !== "" ? u : (env.KB_URL ?? "").trim(), s !== "" ? s : (env.KB_SOCKET ?? "").trim()].filter(w => w !== "");
  return `${LEGACY_NAME} ${words.join(" ")}`;
}
