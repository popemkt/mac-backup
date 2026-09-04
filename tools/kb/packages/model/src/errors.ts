import { Schema } from "effect";
import { FailureCodeSchema, type FailureCode } from "./failure.ts";
import { ResolveError } from "./resolve.ts";

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

const DOMAIN_ERROR_CODES = new Set<string>([
  "not_found",
  "ambiguous",
  "invalid_move",
  "forbidden",
  "invalid_input",
  "conflict",
  "internal",
]);

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

function isDomainErrorCode(code: FailureCode): code is DomainErrorCode {
  return DOMAIN_ERROR_CODES.has(code);
}

/** Fold a foreign failure into {@link DomainError}; pass DomainError through. */
export function ensureDomainError(err: unknown): DomainError {
  if (isDomainError(err)) return err;
  if (err instanceof ResolveError) return domainFromResolve(err);
  const message = err instanceof Error ? err.message : String(err);
  if (typeof err === "object" && err !== null) {
    const parsed = FailureCodeSchema.safeParse((err as { code?: unknown }).code);
    if (parsed.success && isDomainErrorCode(parsed.data)) {
      return domainError(parsed.data, message, (err as { details?: unknown }).details);
    }
  }
  return domainError("internal", message);
}

/** Receipt code for domain/resolve failures — always a FailureCode. */
export function receiptCodeOf(err: DomainError | ResolveError): FailureCode {
  return err.code;
}
