import { defineExtension, extensionPlugin, type ExtensionAction } from "@kb/contracts";
import { checkAuditEffect } from "./audit.ts";
import { auditOutput, emptyInput, syncOutput } from "./model.ts";
import { checkSyncEffect } from "./sync.ts";

const actions: ExtensionAction[] = [
  {
    id: "audit",
    title: "Audit checks",
    description: "Prove rule check references, evidence, wiring, enforcement, gates, and homes",
    mode: { kind: "read" },
    inputSchema: emptyInput,
    outputSchema: auditOutput,
    effect: checkAuditEffect,
  },
  {
    id: "sync",
    title: "Sync rule enforcement",
    description: "Derive each rule's stored enforcement from its referenced check surface",
    mode: { kind: "write" },
    inputSchema: emptyInput,
    outputSchema: syncOutput,
    effect: checkSyncEffect,
  },
];

/** The check family's declaration: the one home of its name (DESIGN.md → Extension families). */
export const checkExtension = defineExtension({ name: "check", label: "Check" });

/** The check family's server entry: `ext.check.*`. */
export const checkPlugin = extensionPlugin({ name: checkExtension.name, actions, templates: [] });
export { checkAuditEffect } from "./audit.ts";
export { checkSyncEffect } from "./sync.ts";
export { auditOutput, findingSchema, syncOutput } from "./model.ts";
export type { Finding } from "./model.ts";
