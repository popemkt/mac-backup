// The host's sandbox policy: the budget, the default provider, and what the local provider needs.
// Its one home is the `sandboxes` NixOS stack (modules/stacks/sandboxes), which writes it to
// /etc/bb-sandbox/policy.json; the slice that enforces the same budget is generated from the same
// options. A host without the file (a Mac, a dev checkout) gets the defaults below and no cgroups.
import { readFileSync } from "node:fs";
import { z } from "zod";

export const POLICY_PATH = "/etc/bb-sandbox/policy.json";

export const policySchema = z
  .object({
    defaultProvider: z.string().default("bwrap"),
    budget: z
      .object({
        sandboxes: z.number().int().min(1).default(3),
        cpus: z.number().positive().default(8),
        memoryMiB: z.number().int().positive().default(12288),
      })
      .strict()
      .default({ sandboxes: 3, cpus: 8, memoryMiB: 12288 }),
    bwrap: z
      .object({
        /** The bubblewrap binary. */
        path: z.string().default("bwrap"),
        /** A nixpkgs source path for `nix` images (`nix build -f <nixpkgs> <attr>`). */
        nixpkgs: z.string().nullable().default(null),
        /** Named images: preset name → nixpkgs attributes. */
        images: z.record(z.string(), z.array(z.string())).default({}),
        /**
         * The user slice every exec runs under, or null for no cgroups. When set, an exec that
         * cannot reach the user manager fails instead of running uncapped.
         */
        slice: z.string().nullable().default(null),
      })
      .strict()
      .default({ path: "bwrap", nixpkgs: null, images: {}, slice: null }),
    /** Hold new admissions above these PSI "some" avg10 percentages. */
    pressure: z
      .object({ cpu: z.number().default(60), memory: z.number().default(10) })
      .strict()
      .default({ cpu: 60, memory: 10 }),
  })
  .strict();

export type Policy = z.infer<typeof policySchema>;

export function readPolicy(path = POLICY_PATH): Policy {
  let raw: unknown = {};
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`${path}: ${(error as Error).message}`);
  }
  return policySchema.parse(raw);
}

/** PSI avg10 of `resource`, or 0 where the kernel has none. */
export function psi(resource: "cpu" | "memory"): number {
  try {
    const line = readFileSync(`/proc/pressure/${resource}`, "utf8").split("\n")[0];
    return Number(/avg10=([\d.]+)/.exec(line)?.[1] ?? 0);
  } catch {
    return 0;
  }
}
