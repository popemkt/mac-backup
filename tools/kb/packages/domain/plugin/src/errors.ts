import { Schema } from "effect";

/**
 * Why the kernel refused something. Every refusal names the plugin it was
 * about, so a host can show which extension broke without parsing messages.
 */
export const PluginErrorReason = Schema.Literals([
  /** A plugin of this name is already loaded. */
  "name-taken",
  /** Another plugin already provides this service. */
  "service-conflict",
  /** Another contribution already holds this id (or alias) in the point. */
  "contribution-conflict",
  /** Two different key objects share one name. */
  "key-mismatch",
  /** `get` of a service the plugin did not declare in `inject`. */
  "not-injected",
  /** The plugin's own `apply` failed. */
  "apply-failed",
  /** The plugin is not loaded. */
  "not-loaded",
]);
export type PluginErrorReason = typeof PluginErrorReason.Type;

export class PluginError extends Schema.TaggedError<PluginError>()("Kb/PluginError", {
  plugin: Schema.String,
  reason: PluginErrorReason,
  message: Schema.String,
}) {}
