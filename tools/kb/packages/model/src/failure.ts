import { z } from "zod";

/**
 * The domain's failure vocabulary. Every receipt code, every DomainError and
 * every ResolveError code is drawn from this one enum, so it lives with the
 * model rather than with the action contracts that report it.
 */
export const FailureCodeSchema = z.enum([
  "not_found",
  "invalid_input",
  "ambiguous",
  "conflict",
  "invalid_move",
  "forbidden",
  "internal",
  "unknown_action",
]);
export type FailureCode = z.infer<typeof FailureCodeSchema>;
