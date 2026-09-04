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

/**
 * An error that names its own {@link FailureCode}. This is the shape every
 * surface can turn into a receipt without guessing — `receiptFromError` reads
 * exactly these two fields, and `ensureDomainError` folds anything else into
 * `internal`. {@link DomainError} is one; a bundled extension's own error class
 * is another.
 */
export interface CodedError extends Error {
  readonly code: FailureCode;
  readonly details?: unknown;
}
