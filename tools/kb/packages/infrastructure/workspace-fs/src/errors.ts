import { Predicate } from "effect";
import { domainError, type DomainError } from "@kb/model";

/** True for FileSystem "not found" platform errors (ENOENT on read/stat). */
export function isNotFound(err: unknown): boolean {
  return (
    Predicate.isObject(err) &&
    Predicate.hasProperty(err, "reason") &&
    Predicate.isObject(err.reason) &&
    Predicate.hasProperty(err.reason, "_tag") &&
    err.reason._tag === "NotFound"
  );
}

/** Everything the filesystem can fail with that is not "it is not there". */
export function internal(what: string, err: unknown): DomainError {
  return domainError("internal", `${what}: ${err instanceof Error ? err.message : String(err)}`);
}
