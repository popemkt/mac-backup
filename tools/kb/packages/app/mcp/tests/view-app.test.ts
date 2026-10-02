/**
 * A view's MCP App snapshot refreshes through its host and never looks live
 * without one: the page runs here in a DOM whose parent plays the MCP Apps
 * host, answering `ui/initialize` and `resources/read` as the spec has it.
 */
import { describe, expect, test } from "bun:test";
import { Window, type HTMLButtonElement } from "happy-dom";
import { viewSnapshotApp } from "../src/view-app.ts";

const URI = "ui://kb/view/v.x";
const BEFORE = "2026-10-02T00:00:00.000Z";
const AFTER = "2026-10-02T00:05:00.000Z";

const page = (heading: string) =>
  `<!doctype html><meta charset="utf-8"><title>kb</title>\n<body>\n<main id="kb-view">\n<h1>${heading}</h1>\n</main>\n</body>`;

interface Request {
  readonly jsonrpc: "2.0";
  readonly id?: number;
  readonly method: string;
  readonly params?: unknown;
}

function isRequest(value: unknown): value is Request {
  return typeof value === "object" && value !== null && "method" in value;
}

/** The snapshot in a DOM, framed by a host that answers with `answer`, or by nothing. */
function open(answer: ((request: Request) => unknown) | null) {
  const window = new Window({ settings: { enableJavaScriptEvaluation: true } });
  const received: Request[] = [];
  if (answer !== null)
    Object.defineProperty(window, "parent", {
      value: {
        postMessage: (message: unknown) => {
          if (!isRequest(message)) return;
          received.push(message);
          if (message.id === undefined) return;
          const result = answer(message);
          setTimeout(() => {
            window.dispatchEvent(
              new window.MessageEvent("message", {
                data: { jsonrpc: "2.0", id: message.id, result },
              }),
            );
          }, 0);
        },
      },
    });
  window.document.write(viewSnapshotApp(page("Before"), URI, BEFORE));
  const button = window.document.querySelector("#kb-refresh") as HTMLButtonElement | null;
  return { window, received, button };
}

async function until(ready: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !ready(); i++) await new Promise((r) => setTimeout(r, 5));
}

describe("view snapshot app", () => {
  test("shows its refresh once the host answers, and swaps in the fresh snapshot", async () => {
    const { window, received, button } = open((request) =>
      request.method === "resources/read"
        ? { contents: [{ uri: URI, text: viewSnapshotApp(page("After"), URI, AFTER) }] }
        : {
            protocolVersion: "2026-01-26",
            hostCapabilities: {},
            hostInfo: { name: "t", version: "0" },
          },
    );
    await until(() => button?.hidden === false);
    expect(button?.hidden).toBe(false);
    expect(received.map((r) => r.method)).toEqual([
      "ui/initialize",
      "ui/notifications/initialized",
    ]);

    button?.click();
    await until(() => window.document.querySelector("#kb-view h1")?.textContent === "After");
    expect(window.document.querySelector("#kb-view h1")?.textContent).toBe("After");
    expect(received.at(-1)).toMatchObject({ method: "resources/read", params: { uri: URI } });
    // The fresh snapshot is stamped by the server that rendered it.
    expect(window.document.querySelector("#kb-as-of")?.textContent).toBe(AFTER);
    await window.happyDOM.close();
  });

  test("outside a host it offers no refresh", async () => {
    const { window, button } = open(null);
    await new Promise((r) => setTimeout(r, 20));
    expect(button?.hidden).toBe(true);
    expect(window.document.querySelector("#kb-view h1")?.textContent).toBe("Before");
    await window.happyDOM.close();
  });
});
