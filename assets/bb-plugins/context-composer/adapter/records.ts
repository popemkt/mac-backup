// What the composer keeps on a thread it starts, in its plugin-metadata namespace. One record serves three readers:
// `agents.configure` (the instructions), the env resolvers (the switches) and the lineage list (manifest and basis).
// Metadata is writable by any API client and by the thread's own agent, so every read goes through parseThreadRecord.

export type ComposedRecord = {
  role: "composed";
  manifestId: string;
  manifestTitle: string;
  basisThreadId: string;
  targetId: string;
  /** The compiled instruction text, already within the target's limit. */
  instructions: string;
  /** The compiled env; the resolver still passes on only the names the target compiles. */
  env: Record<string, string>;
  excluded: string[];
  included: string[];
  composedAt: number;
};

/** The hidden thread that runs the trajectory chat for a basis thread. */
export type AdvisorRecord = { role: "advisor"; basisThreadId: string };

export type ThreadRecord = ComposedRecord | AdvisorRecord;

/** The advisor's standing rules, added to its system prompt by agents.configure. */
export const ADVISOR_INSTRUCTIONS =
  "You are the trajectory advisor of a context composer, in a side chat. Answer from the brief and the conversation; do not edit files, run commands or call tools. End every answer that recommends changes with one fenced `composer-proposal` JSON block, as the brief describes.";

const str = (v: unknown, max = 4096): string | null => (typeof v === "string" && v.length <= max ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function parseThreadRecord(v: unknown): ThreadRecord | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const basisThreadId = str(o.basisThreadId, 200);
  if (basisThreadId === null) return null;
  if (o.role === "advisor") return { role: "advisor", basisThreadId };
  if (o.role !== "composed") return null;
  const manifestId = str(o.manifestId, 200);
  const targetId = str(o.targetId, 64);
  if (manifestId === null || targetId === null) return null;
  const env: Record<string, string> = {};
  if (typeof o.env === "object" && o.env !== null) {
    for (const [k, val] of Object.entries(o.env as Record<string, unknown>)) {
      const s = str(val, 16_384);
      if (/^[A-Z_][A-Z0-9_]*$/.test(k) && s !== null) env[k] = s;
    }
  }
  return {
    role: "composed",
    manifestId,
    manifestTitle: str(o.manifestTitle, 200) ?? manifestId,
    basisThreadId,
    targetId,
    instructions: str(o.instructions) ?? "",
    env,
    excluded: strings(o.excluded),
    included: strings(o.included),
    composedAt: typeof o.composedAt === "number" ? o.composedAt : 0,
  };
}
