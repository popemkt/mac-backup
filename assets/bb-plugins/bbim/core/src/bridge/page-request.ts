// A page reached by script (bb's `experimental_page`) as a PageView: each
// request is one evaluation in the page's isolated world, handed to its page
// bridge. The bridge bundle goes along only when the document has none yet
// (a new page or a navigation, which drops everything installed); then it
// installs itself, announces its document (`ready`), and takes the request.
import type { ParentMessage } from "../domain/protocol.ts";
import type { PageView } from "../dom/bridge-client.ts";
import { BBIM_PAGE_SCRIPT } from "../../bridge/bbim-page.ts";

/** Script access to a page: what bb's `experimental_page` offers. */
export interface ScriptedPage {
  readonly evaluate: (expression: string, options?: { readonly world?: "isolated" | "main" }) => Promise<unknown>;
  readonly onMessage: (listener: (data: unknown) => void) => () => void;
}

const BRIDGE = 'globalThis[Symbol.for("bbim.page")]';

/** Deliver `message` to the page bridge if this document has one; resolves whether it did. */
export function pageDelivery(message: ParentMessage): string {
  return `(()=>{const b=${BRIDGE};if(b===undefined)return false;b.receive(${JSON.stringify(message)});return true})()`;
}

/**
 * Install the page bridge, then deliver `message`; resolves whether a bridge
 * took it. One expression, like every request: bb awaits it inside a function
 * whose parameter is `bb` (statements there do not parse), so the bundle's
 * statements run in an arrow's body, where that `bb` is in scope.
 */
export function pageInstall(message: ParentMessage): string {
  return `(()=>{${BBIM_PAGE_SCRIPT}\n;const b=${BRIDGE};if(b===undefined)return false;b.receive(${JSON.stringify(message)});return true})()`;
}

/** `page`, its native view drawn over `element`, as a page for `Bbim.attachPage`; `onError` hears failed evaluations. */
export function scriptedPage(element: Element, page: ScriptedPage, onError: (error: unknown) => void): PageView {
  const isolated = { world: "isolated" } as const;
  return {
    element,
    send: (message) => {
      page
        .evaluate(pageDelivery(message), isolated)
        .then((delivered) => (delivered === true ? true : page.evaluate(pageInstall(message), isolated)))
        .then((installed) => {
          if (installed !== true) onError(new Error("bbim: the page bridge did not install (no bb channel in the page's world)"));
          return undefined;
        })
        .catch(onError);
    },
    listen: (handler) => page.onMessage(handler),
  };
}
