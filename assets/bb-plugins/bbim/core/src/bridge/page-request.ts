// What a host evaluates in a native page to deliver one bridge request: the
// page bridge (installed if this document has none yet: a navigation drops
// it), then the request handed to its `receive`. Resolves to null.
import type { ParentMessage } from "../domain/protocol.ts";
import { BBIM_PAGE_SCRIPT } from "../../bridge/bbim-page.ts";

export function pageRequest(message: ParentMessage): string {
  return `${BBIM_PAGE_SCRIPT}\n;globalThis[Symbol.for("bbim.page")]?.receive(${JSON.stringify(message)});null`;
}
