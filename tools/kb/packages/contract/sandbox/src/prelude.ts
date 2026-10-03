/**
 * The guest's side of the capability API: the `kb` global that sandboxed
 * code calls (DESIGN.md → Sandbox → The capability API). It is one script,
 * run first in every engine, so QuickJS and a Worker hand the guest the same
 * API. An engine provides one thing beneath it, a string pipe:
 * `__kb_post(text)` sends a message to the host, and the engine calls
 * `__kb_receive(text)` to hand the guest one. Requests and their answers are
 * matched here, in the guest, so an engine never parses what flows through.
 */
import { JSON_RPC_VERSION, MCP_APPS_METHODS } from "@kb/contracts";
import { GRAPH_READ, NODE_READ } from "./grant.ts";
import { KB_METHODS } from "./protocol.ts";

/** What the prelude is started with. */
export interface GuestInit {
  /** The node the code is shown for, as `kb.subject`. */
  readonly subject: string | null;
}

/** How long a failure message or a log line may be. */
const MAX_LINE = 4000;

const CONSTANTS = {
  jsonrpc: JSON_RPC_VERSION,
  toolsCall: MCP_APPS_METHODS.toolsCall,
  log: MCP_APPS_METHODS.log,
  draw: KB_METHODS.draw,
  fail: KB_METHODS.fail,
  event: KB_METHODS.event,
  nodeRead: NODE_READ,
  graphRead: GRAPH_READ,
  maxLine: MAX_LINE,
};

/**
 * The prelude, as a function expression of `(init, constants)`. It is
 * written in plain ES2020, because QuickJS runs it as it is.
 */
const PRELUDE = String.raw`(function (init, c) {
  "use strict";
  var post = globalThis.__kb_post;
  delete globalThis.__kb_post;
  var send = function (message) { post(JSON.stringify(message)); };
  var line = function (value) {
    var text;
    if (typeof value === "string") text = value;
    else { try { text = JSON.stringify(value); } catch (e) { text = String(value); } }
    if (text === undefined) text = String(value);
    return text.length > c.maxLine ? text.slice(0, c.maxLine) + "…" : text;
  };
  var failed = false;
  var fail = function (error) {
    if (failed) return;
    failed = true;
    var name = error && error.name ? error.name + ": " : "";
    var message = error && error.message !== undefined ? error.message : error;
    send({ jsonrpc: c.jsonrpc, method: c.fail, params: { message: line(name + line(message)) } });
  };
  var nextId = 0;
  var pending = new Map();
  var handlers = new Map();
  var KbError = function (code, message, details) {
    var error = new Error(message);
    error.name = "KbError";
    error.code = code;
    error.details = details;
    return error;
  };
  var call = function (name, args) {
    return new Promise(function (resolve, reject) {
      nextId += 1;
      pending.set(nextId, { resolve: resolve, reject: reject });
      send({ jsonrpc: c.jsonrpc, id: nextId, method: c.toolsCall, params: { name: String(name), arguments: args === undefined ? {} : args } });
    });
  };
  var settle = function (message) {
    var waiting = pending.get(message.id);
    if (waiting === undefined) return;
    pending.delete(message.id);
    if (message.error) { waiting.reject(KbError("internal", message.error.message)); return; }
    var result = message.result || {};
    var block = result.content && result.content[0];
    var body;
    try { body = block ? JSON.parse(block.text) : undefined; } catch (e) { body = block ? block.text : undefined; }
    if (result.isError) {
      var failure = body && typeof body === "object" ? body : { code: "internal", message: String(body) };
      waiting.reject(KbError(failure.code, failure.message, failure.details));
    } else {
      waiting.resolve(body);
    }
  };
  var dispatch = function (event) {
    var set = handlers.get(event.type);
    if (set === undefined) return;
    set.forEach(function (handler) {
      try {
        var result = handler(event);
        if (result && typeof result.then === "function") result.then(undefined, fail);
      } catch (error) { fail(error); }
    });
  };
  Object.defineProperty(globalThis, "__kb_receive", {
    value: function (text) {
      var message = JSON.parse(text);
      if (message.id !== undefined) settle(message);
      else if (message.method === c.event) dispatch(message.params);
    },
    writable: false,
    configurable: false,
  });
  var log = function (level) {
    return function () {
      var parts = [];
      for (var i = 0; i < arguments.length; i++) parts.push(line(arguments[i]));
      send({ jsonrpc: c.jsonrpc, method: c.log, params: { level: level, data: line(parts.join(" ")) } });
    };
  };
  var kb = {
    subject: init.subject,
    invoke: function (action, input) { return call(action, input); },
    query: function (query) {
      return call(c.graphRead, { query: String(query) }).then(function (out) { return out.rows; });
    },
    node: function (id, depth) {
      return call(c.nodeRead, { id: String(id), depth: depth === undefined ? 1 : depth }).then(function (out) { return out.node; });
    },
    draw: function (drawing) { send({ jsonrpc: c.jsonrpc, method: c.draw, params: { drawing: drawing } }); },
    on: function (type, handler) {
      if (typeof handler !== "function") throw new TypeError("kb.on needs a function");
      var set = handlers.get(type) || new Set();
      set.add(handler);
      handlers.set(type, set);
      return function () { set.delete(handler); };
    },
    h: function (tag, attrs) {
      var children = [];
      for (var i = 2; i < arguments.length; i++) children.push(arguments[i]);
      return [tag, attrs || {}].concat(children);
    },
    log: log("info"),
  };
  Object.freeze(kb);
  Object.defineProperty(globalThis, "kb", { value: kb, writable: false, configurable: false });
  globalThis.console = Object.freeze({ log: log("info"), info: log("info"), debug: log("debug"), warn: log("warning"), error: log("error") });
  Object.defineProperty(globalThis, "__kb_main", {
    value: function (main) {
      delete globalThis.__kb_main;
      try { Promise.resolve(main()).then(undefined, fail); } catch (error) { fail(error); }
    },
    configurable: true,
  });
})`;

/**
 * The script an engine runs for `code`: the prelude, started with `init`,
 * then the code as the body of an async function, so it may `await` at its
 * top level and every error it throws, now or later, ends the run with that
 * error's message.
 */
export function guestScript(code: string, init: GuestInit): string {
  return [
    `${PRELUDE}(${JSON.stringify(init)}, ${JSON.stringify(CONSTANTS)});`,
    "globalThis.__kb_main(async function () {",
    code,
    "});",
  ].join("\n");
}
