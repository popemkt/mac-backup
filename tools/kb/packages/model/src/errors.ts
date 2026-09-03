import { Schema } from "effect";
import type { FailureCode } from "./failure.ts";
import { type ResolveError } from "./resolve.ts";

/**
 * Typed domain failure for Effect programs. Maps onto ActionReceipt codes at
 * the invoke boundary. Domain codes are a subset of FailureCodeSchema (which
 * includes `invalid_move` / `forbidden`); registry mapping needs no casts.
 */
export class DomainError extends Schema.TaggedError<DomainError>()("Kb/DomainError", {
  code: Schema.Literals([
    "not_found",
    "ambiguous",
    "invalid_move",
    "forbidden",
    "invalid_input",
    "conflict",
    "internal",
  ]),
  message: Schema.String,
  details: Schema.optionalKey(Schema.Unknown),
}) {}

export type DomainErrorCode = DomainError["code"] & FailureCode;

export function domainError(
  code: DomainErrorCode,
  message: string,
  details?: unknown,
): DomainError {
  return new DomainError(details === undefined ? { code, message } : { code, message, details });
}

export function domainFromResolve(err: ResolveError): DomainError {
  return domainError(err.code, err.message, err.details);
}

export function isDomainError(err: unknown): err is DomainError {
  return (
    typeof err === "object" && err !== null && (err as { _tag?: unknown })._tag === "Kb/DomainError"
  );
}

/** Receipt code for domain/resolve failures — always a FailureCode. */
export function receiptCodeOf(err: DomainError | ResolveError): FailureCode {
  return err.code;
}
