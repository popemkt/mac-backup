import { z } from "zod";
import type { ExtensionAction } from "@kb/contracts";
import { checkAuditEffect } from "./audit.ts";
import { auditOutput, syncOutput } from "./model.ts";
import { checkSyncEffect } from "./sync.ts";

const emptyInput = z.object({});

const actions: ExtensionAction[] = [
  {
    id: "audit",
    title: "Audit checks",
    description: "Prove rule check references, evidence, wiring, enforcement, gates, and homes",
    mode: "read",
    inputSchema: emptyInput,
    outputSchema: auditOutput,
    effect: checkAuditEffect,
  },
  {
    id: "sync",
    title: "Sync rule enforcement",
    description: "Derive each rule's stored enforcement from its referenced check surface",
    mode: "apply",
    inputSchema: emptyInput,
    outputSchema: syncOutput,
    effect: checkSyncEffect,
  },
];

export const checkActions = actions;
export { checkAuditEffect } from "./audit.ts";
export { checkSyncEffect } from "./sync.ts";
export { auditOutput, findingSchema, syncOutput } from "./model.ts";
export type { Finding } from "./model.ts";
