// The plugin's pure parts: which kb tab session each thread's panel is showing, what a framed kb page
// says, and how kb's answers are shown to an agent. No bb and no network here, so tests run on plain data.
import { z } from "zod";

/**
 * How long a panel's report of its tab session holds without being repeated. A mounted panel repeats it
 * well inside this, so a panel that closed, or a browser that went away, stops steering an agent's calls
 * into a tab that is no longer there; the agent's calls are then made in no session.
 */
export const SESSION_TTL_MS = 90_000;

/** How often a mounted panel repeats its report. */
export const SESSION_HEARTBEAT_MS = 30_000;

/** The most text one tool answer carries back to the agent. */
export const MAX_TOOL_TEXT = 40_000;

/** Each thread's kb tab session, as its panel last reported it. */
export class ThreadSessions {
  readonly #byThread = new Map<string, { readonly session: string; readonly at: number }>();

  /** The thread's panel shows tab `session` now, or (null) no longer shows kb. */
  report(threadId: string, session: string | null, now: number): void {
    if (session === null) this.#byThread.delete(threadId);
    else this.#byThread.set(threadId, { session, at: now });
  }

  /** The session the thread's agent works in: its panel's, while the panel keeps reporting it. */
  live(threadId: string, now: number): string | undefined {
    const held = this.#byThread.get(threadId);
    if (held === undefined) return undefined;
    if (now - held.at > SESSION_TTL_MS) {
      this.#byThread.delete(threadId);
      return undefined;
    }
    return held.session;
  }
}

/** What a framed kb page posts its embedder (kb DESIGN.md → Surfaces → Embedding the page). */
const KbSessionMessageSchema = z.object({ type: z.literal("kb.session"), session: z.string().min(1) });

/** The tab session a message from the framed page names, or null when it is not kb's. */
export function sessionOfMessage(data: unknown): string | null {
  const parsed = KbSessionMessageSchema.safeParse(data);
  return parsed.success ? parsed.data.session : null;
}

/** The origin of the kb page URL, or null when it is not an http(s) URL. */
export function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** `text`, cut to `max` characters with a note saying how much was left out. */
export function bounded(text: string, max = MAX_TOOL_TEXT): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… (${text.length - max} more characters left out; narrow the call)`;
}

const ReceiptSchema = z.union([
  z.object({
    status: z.literal("succeeded"),
    id: z.string(),
    output: z.unknown(),
    context: z.record(z.string(), z.object({ from: z.string(), value: z.unknown() })).optional(),
  }),
  z.object({
    status: z.literal("failed"),
    id: z.string(),
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
]);

/** A tool answer: the text the agent reads, and whether it is an error. */
export interface ToolAnswer {
  readonly text: string;
  readonly isError: boolean;
}

/**
 * kb's receipt for a call, as the agent reads it: the output as JSON, then what the tab session filled
 * ("this" was which node), or the failure's code and message.
 */
export function receiptAnswer(body: unknown, status: number): ToolAnswer {
  const receipt = ReceiptSchema.safeParse(body);
  if (!receipt.success) {
    return { text: bounded(`kb answered HTTP ${status}: ${JSON.stringify(body)}`), isError: true };
  }
  const { data } = receipt;
  if (data.status === "failed") {
    const details = data.details === undefined ? "" : `\n${JSON.stringify(data.details)}`;
    return { text: bounded(`${data.id} failed [${data.code}]: ${data.message}${details}`), isError: true };
  }
  const filled =
    data.context === undefined
      ? ""
      : `\nfilled from the person's tab: ${Object.entries(data.context)
          .map(([key, { from, value }]) => `${key} = ${JSON.stringify(value)} (${from})`)
          .join(", ")}`;
  return { text: bounded(`${JSON.stringify(data.output)}${filled}`), isError: false };
}

const ManifestEntrySchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    mode: z.object({ kind: z.string() }).loose(),
    inputSchema: z.unknown(),
    context: z.record(z.string(), z.object({ reference: z.string(), description: z.string() })).optional(),
  })
  .loose();

/**
 * kb's action listing, as the agent reads it: one line per action (id, read or write, title, and what a
 * tab session may fill), or one action whole, its input schema included.
 */
export function manifestAnswer(body: unknown, id: string | undefined): ToolAnswer {
  const parsed = z.array(ManifestEntrySchema).safeParse(body);
  if (!parsed.success) return { text: bounded(`kb answered no listing: ${JSON.stringify(body)}`), isError: true };
  const entries = parsed.data;
  if (id !== undefined) {
    const entry = entries.find(e => e.id === id);
    if (entry === undefined) return { text: `kb lists no action ${id}`, isError: true };
    return { text: bounded(JSON.stringify(entry, null, 2)), isError: false };
  }
  const lines = entries.map(entry => {
    const fills = Object.entries(entry.context ?? {})
      .map(([key, fill]) => `${key} ← ${fill.description}`)
      .join("; ");
    return `${entry.id} [${entry.mode.kind}] ${entry.title}${fills === "" ? "" : ` (in the tab: ${fills})`}`;
  });
  return { text: bounded(lines.join("\n")), isError: false };
}
