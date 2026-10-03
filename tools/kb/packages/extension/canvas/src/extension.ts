/**
 * The canvas family's declaration (DESIGN.md → Extension families): the one
 * home of its name, which its server entry (`@kb/ext-canvas`) reads and its
 * `family:` tag is checked against.
 */
import { defineExtension } from "@kb/contracts";

export const canvasExtension = defineExtension({ name: "canvas", label: "Canvas" });
