import { SavedQuerySchema, type SavedQuery } from "@kb/protocol";
import { z } from "zod";

/** GET /api/queries — saved queries from .kb/queries/*.edn. */
export async function fetchSavedQueries(): Promise<SavedQuery[]> {
  const res = await fetch("/api/queries");
  if (!res.ok) throw new Error(`GET /api/queries → ${res.status}`);
  const json: unknown = await res.json();
  return z.array(SavedQuerySchema).parse(json);
}
