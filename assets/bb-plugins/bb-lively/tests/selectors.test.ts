// The selector table against bb's own markup (a capture of the 0.46.1 web
// UI). After a bb upgrade: capture again, add a fixture, run these.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Window } from "happy-dom";
import { BB_TARGETS, SELECTOR_TABLE, SELECTORS, type SelectorId } from "../adapter/selectors.ts";

const FIXTURE = readFileSync(new URL("fixtures/bb-0.46.1.html", import.meta.url), "utf8");

function bbPage(): Document {
  const win = new Window({ url: "https://bb.test/" });
  win.document.body.innerHTML = FIXTURE;
  return win.document as unknown as Document;
}

/** What the capture holds: the composer, a sidebar thread row and an open thread's timeline. */
const IN_FIXTURE: ReadonlyArray<SelectorId> = [
  "pressable",
  "rowList",
  "row",
  "focusBox",
  "sendButton",
  "sendIcon",
  "threadRow",
  "statusRow",
];

test("every selector parses", () => {
  const doc = bbPage();
  for (const { id, selector } of SELECTOR_TABLE) assert.doesNotThrow(() => doc.querySelectorAll(selector), id);
});

test("the selectors verified live match bb 0.46.1's markup", () => {
  const doc = bbPage();
  for (const id of IN_FIXTURE) assert.ok(doc.querySelectorAll(SELECTORS[id].selector).length > 0, id);
});

test("timeline rows are direct children of the row list, with an id and an index", () => {
  const doc = bbPage();
  const list = doc.querySelector(BB_TARGETS.rowList);
  const rows = [...(list?.children ?? [])].filter((child) => child.matches(BB_TARGETS.row));
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.ok(row.getAttribute(BB_TARGETS.rowIdAttribute));
    assert.ok(Number.isFinite(Number(row.getAttribute(BB_TARGETS.rowIndexAttribute))));
  }
});

test("a sidebar thread link sits inside the status card that rings", () => {
  const doc = bbPage();
  const link = doc.querySelector(SELECTORS.threadRow.selector);
  assert.ok(link?.closest(BB_TARGETS.statusRow));
});

test("the send button is pressable and not excluded", () => {
  const doc = bbPage();
  const send = doc.querySelector(BB_TARGETS.sendButton);
  assert.ok(send?.matches(BB_TARGETS.pressable));
  assert.equal(send?.closest(BB_TARGETS.pressExclude), null);
});

test("the table is the one source: every target selector comes from it", () => {
  const selectors = new Set(SELECTOR_TABLE.map((entry) => entry.selector));
  for (const [role, value] of Object.entries(BB_TARGETS)) {
    if (typeof value !== "string" || role.endsWith("Attribute")) continue;
    assert.ok(selectors.has(value), role);
  }
});

const REQUEST_FIXTURE = readFileSync(new URL("fixtures/bb-0.46.1-request.html", import.meta.url), "utf8");

test("a pending request sits in the thread window, outside its timeline (so Turn() freezes the timeline, never the request)", () => {
  const win = new Window({ url: "https://bb.test/" });
  win.document.body.innerHTML = REQUEST_FIXTURE;
  const doc = win.document as unknown as Document;
  const requests = [...doc.querySelectorAll(BB_TARGETS.pendingRequest)];
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.ok(request?.closest(BB_TARGETS.pageView));
  assert.equal(request?.closest(BB_TARGETS.rowList), null);
  assert.ok(doc.querySelector(BB_TARGETS.pageView)?.querySelector(BB_TARGETS.rowList));
  // The freeze's shape: the window that has a request, then its timeline's rows. (The stylesheet
  // wraps each in :is(), which happy-dom cannot match around a combinator; Chrome was checked live.)
  assert.ok(doc.querySelectorAll(`${BB_TARGETS.pageView}:has(${BB_TARGETS.pendingRequest}) ${BB_TARGETS.rowList} > ${BB_TARGETS.row}`).length > 0);
});
