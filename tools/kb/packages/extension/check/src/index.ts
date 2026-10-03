/**
 * The check family's shared package (DESIGN.md → Extension families): its
 * declaration, the one home of its name. The server entry (`@kb/ext-check`)
 * reads it, and the bundled list (`@kb/bundled`) folds it.
 */
import { defineExtension } from "@kb/contracts";

export const checkExtension = defineExtension({ name: "check", label: "Check" });
