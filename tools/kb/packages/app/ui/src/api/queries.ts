import { SavedQuerySchema, type SavedQuery } from "@kb/contracts";
import { z } from "zod";
import { pageHeaders } from "@/api/page-token";

/** GET /api/queries — saved queries from .kb/queries/*.edn. */
export async function fetchSavedQueries(): Promise<SavedQuery[]> {
  const res = await fetch("/api/queries", { headers: pageHeaders() });
  if (!res.ok) throw new Error(`GET /api/queries → ${res.status}`);
  const json: unknown = await res.json();
  return z.array(SavedQuerySchema).parse(json);
}
