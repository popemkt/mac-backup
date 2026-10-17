/**
 * A family's footprint (DESIGN.md → Extension families → footprint): what it
 * adds to the graph and to the hosts that load it, as rows. A data row is a
 * node its declaration seeds, read from the index's `:node/owner`; a runtime
 * row is a contribution one of its plugins made to a kernel, read from that
 * kernel (`Kernel.contributionsOf`). Neither is stored: the fold and the
 * kernels are the two sources, and the rows are a reading of them.
 */
import { Context, type Effect } from "effect";
import { z } from "zod";
import type { Kernel } from "@kb/plugin";
import type { ExtensionRow } from "./declaration.ts";

/** Where a row was read: the seed, or the kernel of the registry, the `kb ui` host or the page. */
export const FOOTPRINT_SOURCES = ["seed", "registry", "host", "page"] as const;

export const FootprintRowSchema = z.object({
  family: z.string(),
  /**
   * What the row is: for a seeded node, its kind (its `sys.f.type`, else
   * `node`); for a runtime row, the name of the point it was contributed to
   * (`kb.actions`, `ui.routes`, …). Both are named by what types the row, so
   * a new kind of node or a new point needs no new value here.
   */
  kind: z.string(),
  id: z.string(),
  /** Whether the family is loaded by a kernel of this host. A runtime row exists only while it is. */
  enabled: z.boolean(),
  source: z.enum(FOOTPRINT_SOURCES),
});

export type FootprintRow = z.infer<typeof FootprintRowSchema>;

/** A kernel a host composes families in, and the source its rows carry. */
export interface FamilyKernel {
  readonly source: Exclude<FootprintRow["source"], "seed">;
  readonly kernel: Kernel;
}

/**
 * The kernels this host holds families in: the registry's, and the one the
 * `kb ui` server composes its hosted families in beside it.
 */
export class FamilyKernels extends Context.Service<FamilyKernels, readonly FamilyKernel[]>()(
  "kb/FamilyKernels",
) {}

/**
 * What a host composes beside the registry (the `kb ui` server's agent): its
 * families' report rows, read at each call, and the kernel it holds them in.
 */
export interface HostedFamilies {
  readonly rows: Effect.Effect<readonly ExtensionRow[]>;
  readonly kernel: Kernel;
}

/** Whether `kernel` holds `family` loaded: a plugin of that name, active. */
export function holdsFamily({ kernel }: FamilyKernel, family: string): boolean {
  return kernel.plugins().some((plugin) => plugin.name === family && plugin.status === "active");
}

/** What `family`'s plugins, its children's included, contributed to one kernel, as its rows. */
export function runtimeFootprint(family: string, held: FamilyKernel): FootprintRow[] {
  return held.kernel.contributionsOf(family).map((contribution) => ({
    family,
    kind: contribution.point,
    id: contribution.id,
    enabled: true,
    source: held.source,
  }));
}
