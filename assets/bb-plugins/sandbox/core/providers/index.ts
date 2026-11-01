// The providers this plugin has, by id. A spec names one in `provider` (or gets the host policy's
// default). Only the local one is built; OpenSandbox (self-hosted, gVisor or Kata), E2B and Upstash
// are the planned slots (docs/research/2026-10-31-sandboxes.md §9.5), each a file here behind the
// same contract, and each is run through tests/contract.test.ts when it lands.
import { join } from "node:path";
import type { SandboxProvider } from "../contract.ts";
import type { Policy } from "../policy.ts";
import { createBwrapProvider } from "./bwrap.ts";

export const OUTPUT_MAX_BYTES = 256 * 1024;

export function createProviders(policy: Policy, root: string): Record<string, SandboxProvider> {
  const bwrap = createBwrapProvider({
    root: join(root, "bwrap"),
    bwrap: policy.bwrap.path,
    nixpkgs: policy.bwrap.nixpkgs,
    images: policy.bwrap.images,
    slice: policy.bwrap.slice,
    outputMaxBytes: OUTPUT_MAX_BYTES,
  });
  return { [bwrap.id]: bwrap };
}
