/**
 * The locations family's actions as every surface lists them: ids, modes and
 * schemas, with no handler. The server's entry (`@kb/locations-fs`) gives
 * each its handler; the page reads the row shape to draw the picker. Each
 * is namespaced `ext.locations.*` and answers to a bare `location.*` alias.
 *
 * Every one reaches outside the session's root, to the person's home store
 * and the roots it names, so its mode says `outsideRoot`, which MCP reports
 * as the open world.
 */
import { z } from "zod";
import type { ActionDefinition } from "@kb/contracts";

/**
 * What a location is now, read from its path each time and never stored:
 * `served` by a live `kb ui`, `closed` (a store nothing serves), `missing`
 * (nothing at the path), `not-a-store` (no `.kb` store there), or `broken`
 * (the location node holds no path, or more than one).
 */
export const LOCATION_STATUSES = ["served", "closed", "missing", "not-a-store", "broken"] as const;

export const LocationRowSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** The root's canonical path; empty for a location that holds none. */
  path: z.string(),
  /** Whether it is the root the call was made in. */
  current: z.boolean(),
  pinned: z.boolean(),
  status: z.enum(LOCATION_STATUSES),
  /** The `kb ui` serving it, when it is served. */
  url: z.string().optional(),
  /** The store's backend, when it is a store. */
  backend: z.string().optional(),
  /** Why it cannot be opened: missing, not a store, or broken. */
  reason: z.string().optional(),
});
export type LocationRow = z.infer<typeof LocationRowSchema>;

export const LocationListSchema = z.object({
  /** The home store the locations live in. */
  home: z.string(),
  rows: z.array(LocationRowSchema),
  /** What the home store holds that is not a well-formed list: no home yet, two nodes for one path. */
  warnings: z.array(z.string()),
});
export type LocationList = z.infer<typeof LocationListSchema>;

type LocationActionDef = ActionDefinition & { readonly aliases: readonly string[] };

/**
 * The bare alias each action answers to: the name every surface calls it
 * by. Each definition takes its own from here, and a caller that builds on
 * the family calls by these instead of spelling them.
 */
export const LOCATION_ACTIONS = {
  list: "location.list",
  register: "location.register",
  open: "location.open",
  forget: "location.forget",
} as const;

export const locationListDef = {
  id: "list",
  aliases: [LOCATION_ACTIONS.list],
  title: "List locations",
  description:
    "The kb roots this person has opened, from their home store, most recently opened first and pinned ones before them. Each row says whether it is served (with its URL), closed, missing or not a store, read from its path now. Reads no listed store's content.",
  mode: { kind: "read", outsideRoot: true },
  inputSchema: z.object({}),
  outputSchema: LocationListSchema,
} satisfies LocationActionDef;

export const locationRegisterDef = {
  id: "register",
  aliases: [LOCATION_ACTIONS.register],
  title: "Register location",
  description:
    "Add the kb root at `path` to the person's locations, creating their home store if it is new, and rank it first. Registering a root already listed only ranks it first (and renames it when `label` is given). Refuses a path that holds no kb store.",
  mode: { kind: "write", outsideRoot: true },
  inputSchema: z.object({
    path: z.string().min(1),
    label: z.string().min(1).optional(),
  }),
  outputSchema: LocationRowSchema,
} satisfies LocationActionDef;

export const LocationOpenedSchema = z.object({
  /** The `kb ui` serving the root now. */
  url: z.string(),
  /**
   * Where a browser opens the root. For the owner's own call (the person,
   * their command line) it is the page URL: `url` carrying the page token
   * its server kept for them (DESIGN.md → Surfaces → The page token). Any
   * other caller is given `url`, since a token it held could be written
   * where a program that only reads the graph would find it.
   */
  open: z.string(),
  /** The root's canonical path. */
  path: z.string(),
});
export type LocationOpened = z.infer<typeof LocationOpenedSchema>;

export const locationOpenDef = {
  id: "open",
  aliases: [LOCATION_ACTIONS.open],
  title: "Open location",
  description:
    "The URL of a `kb ui` serving the location `id`, the kb root at `path`, or (given neither) the person's home store, and where a browser opens it: for the person's own call, the page URL carrying that server's page token. A root already served answers its server's URL and is ranked first; one that is closed gets a `kb ui` started for it, which keeps running after the call and ranks its root first itself. Refuses a location that is missing or not a store, and a server that does not answer in about ten seconds.",
  mode: { kind: "write", outsideRoot: true },
  inputSchema: z
    .object({
      id: z.string().min(1).optional(),
      path: z.string().min(1).optional(),
    })
    .refine((input) => input.id === undefined || input.path === undefined, {
      message: "give the location's id or a path, not both",
    }),
  outputSchema: LocationOpenedSchema,
} satisfies LocationActionDef;

export const locationForgetDef = {
  id: "forget",
  aliases: [LOCATION_ACTIONS.forget],
  title: "Forget location",
  description:
    "Remove the location `id` from the person's locations. Its directory and its store are never touched.",
  mode: { kind: "write", outsideRoot: true },
  inputSchema: z.object({ id: z.string().min(1) }),
  outputSchema: z.object({ id: z.string(), label: z.string(), path: z.string() }),
} satisfies LocationActionDef;
