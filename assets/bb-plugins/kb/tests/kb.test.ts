// The plugin's pure parts: the thread → kb tab session registry, what a framed kb page posts, and how kb's
// answers read to an agent.
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import {
  bounded,
  manifestAnswer,
  originOf,
  receiptAnswer,
  SESSION_TTL_MS,
  sessionOfMessage,
  ThreadSessions,
} from "../lib/kb.ts";

describe("each thread's kb tab session", () => {
  test("is the panel's while it keeps reporting it, and lapses when it stops", () => {
    const sessions = new ThreadSessions();
    sessions.report("thr_a", "tab.1", 0);
    assert.equal(sessions.live("thr_a", SESSION_TTL_MS), "tab.1");
    assert.equal(sessions.live("thr_b", 0), undefined);
    sessions.report("thr_a", "tab.2", SESSION_TTL_MS);
    assert.equal(sessions.live("thr_a", SESSION_TTL_MS * 2), "tab.2");
    assert.equal(sessions.live("thr_a", SESSION_TTL_MS * 2 + 1), undefined);
  });

  test("goes when the panel says it no longer shows kb", () => {
    const sessions = new ThreadSessions();
    sessions.report("thr_a", "tab.1", 0);
    sessions.report("thr_a", null, 1);
    assert.equal(sessions.live("thr_a", 1), undefined);
  });
});

describe("what the framed page posts", () => {
  test("only kb's session message names a session", () => {
    assert.equal(sessionOfMessage({ type: "kb.session", session: "tab.1" }), "tab.1");
    assert.equal(sessionOfMessage({ type: "kb.session", session: "" }), null);
    assert.equal(sessionOfMessage({ type: "other", session: "tab.1" }), null);
    assert.equal(sessionOfMessage("kb.session"), null);
  });

  test("the page's origin is an http(s) URL's", () => {
    assert.equal(originOf("https://kb-popemkt.example.ts.net/node/n.a"), "https://kb-popemkt.example.ts.net");
    assert.equal(originOf("javascript:alert(1)"), null);
    assert.equal(originOf("not a url"), null);
  });
});

describe("kb's answers, as the agent reads them", () => {
  test("a succeeded call is its output, and what the tab filled", () => {
    assert.deepEqual(
      receiptAnswer(
        {
          status: "succeeded",
          id: "node.update",
          output: { id: "n.a" },
          context: { id: { from: "focused", value: "n.a" } },
          rev: 4,
        },
        200,
      ),
      { text: '{"id":"n.a"}\nfilled from the person\'s tab: id = "n.a" (focused)', isError: false },
    );
  });

  test("a failed call is its code and message, as an error", () => {
    const answer = receiptAnswer(
      { status: "failed", id: "node.update", code: "invalid_input", message: "id is required" },
      400,
    );
    assert.equal(answer.isError, true);
    assert.equal(answer.text, "node.update failed [invalid_input]: id is required");
    assert.equal(receiptAnswer("<html>", 502).isError, true);
  });

  test("the listing is a line per action, or one action whole", () => {
    const listing = [
      {
        id: "node.update",
        title: "Update node",
        description: "Edit a node",
        mode: { kind: "write" },
        inputSchema: { type: "object" },
        context: { id: { reference: "focused", description: "the node the pane's focus is on" } },
      },
      { id: "node.get", title: "Get node", description: "Read", mode: { kind: "read" }, inputSchema: {} },
    ];
    assert.equal(
      manifestAnswer(listing, undefined).text,
      "node.update [write] Update node (in the tab: id ← the node the pane's focus is on)\nnode.get [read] Get node",
    );
    assert.match(manifestAnswer(listing, "node.get").text, /"description": "Read"/);
    assert.equal(manifestAnswer(listing, "node.gone").isError, true);
  });

  test("a long answer is cut, saying how much was left out", () => {
    assert.equal(bounded("abcdef", 4), "abcd\n… (2 more characters left out; narrow the call)");
    assert.equal(bounded("abc", 4), "abc");
  });
});
