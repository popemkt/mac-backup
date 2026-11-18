// The named kb stores: how they are written, where they come from, which one a call goes to.
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { chooseStore, legacyLine, parseConnection, parseConnections, resolveStores, storesLine } from "../lib/stores.ts";

const WORK = "https://kb-work.example.ts.net";
const HOME = "https://kb-popemkt.example.ts.net";

describe("a store's line", () => {
  test("a page URL is also the API's address", () => {
    assert.deepEqual(parseConnection(`kb-work ${WORK}`), { name: "kb-work", page: WORK, api: { url: WORK } });
  });

  test("a socket or a second URL is the API's address", () => {
    assert.deepEqual(parseConnection(`kb-popemkt ${HOME} /run/kb-popemkt/kb.sock`), {
      name: "kb-popemkt",
      page: HOME,
      api: { socket: "/run/kb-popemkt/kb.sock" },
    });
    assert.deepEqual(parseConnection(`kb-work ${WORK} http://127.0.0.1:9000`), {
      name: "kb-work",
      page: WORK,
      api: { url: "http://127.0.0.1:9000" },
    });
  });

  test("a socket alone is a store the tools reach and the panel cannot frame", () => {
    assert.deepEqual(parseConnection("local /tmp/kb.sock"), { name: "local", page: null, api: { socket: "/tmp/kb.sock" } });
  });

  test("a bad line says why", () => {
    assert.match(parseConnection(`Kb ${WORK}`) as string, /not a store name/);
    assert.match(parseConnection("kb") as string, /expected/);
    assert.match(parseConnection("kb ftp://x") as string, /neither/);
    assert.match(parseConnection("kb /a /b") as string, /more than one/);
  });

  test("lines, or ;-separated, with comments; a later store of one name wins", () => {
    const { connections, problems } = parseConnections(`# mine\nkb-work ${WORK}\nkb-popemkt ${HOME}; kb-work ${HOME}\nbad`);
    assert.deepEqual(
      connections.map(c => [c.name, c.page]),
      [
        ["kb-popemkt", HOME],
        ["kb-work", HOME],
      ],
    );
    assert.equal(problems.length, 1);
  });
});

describe("the stores", () => {
  test("bb's environment declares them and the setting adds to or replaces them", () => {
    const stores = resolveStores({
      connections: `extra /tmp/kb.sock\nkb-work ${WORK} http://127.0.0.1:9000`,
      defaultKb: "",
      env: { KB_CONNECTIONS: `kb-work ${WORK};kb-popemkt ${HOME}` },
    });
    assert.deepEqual(
      stores.connections.map(c => c.name),
      ["kb-popemkt", "extra", "kb-work"],
    );
    assert.deepEqual(stores.connections.find(c => c.name === "kb-work")?.api, { url: "http://127.0.0.1:9000" });
    assert.equal(stores.defaultName, "kb-popemkt");
  });

  test("KB_URL and KB_SOCKET are one store named default when nothing else declares any", () => {
    const stores = resolveStores({ connections: "", defaultKb: "", env: { KB_URL: HOME, KB_SOCKET: "/run/kb.sock" } });
    assert.deepEqual(stores.connections, [{ name: "default", page: HOME, api: { socket: "/run/kb.sock" } }]);
    assert.equal(stores.defaultName, "default");
    const declared = resolveStores({ connections: "", defaultKb: "", env: { KB_URL: HOME, KB_CONNECTIONS: `w ${WORK}` } });
    assert.deepEqual(
      declared.connections.map(c => c.name),
      ["w"],
    );
  });

  test("the default is the setting, else KB_DEFAULT, else the first; an unknown one is a problem", () => {
    const env = { KB_CONNECTIONS: `a ${WORK};b ${HOME}`, KB_DEFAULT: "b" };
    assert.equal(resolveStores({ connections: "", defaultKb: "", env }).defaultName, "b");
    assert.equal(resolveStores({ connections: "", defaultKb: "a", env }).defaultName, "a");
    const unknown = resolveStores({ connections: "", defaultKb: "zz", env });
    assert.equal(unknown.defaultName, "b");
    assert.match(unknown.problems.join("\n"), /no store named zz/);
  });

  test("none configured", () => {
    const stores = resolveStores({ connections: "", defaultKb: "", env: {} });
    assert.deepEqual(stores, { connections: [], defaultName: null, problems: [] });
    assert.match((chooseStore(stores, undefined, undefined) as { error: string }).error, /not configured/);
  });
});

describe("which store a call goes to", () => {
  const stores = resolveStores({ connections: `a ${WORK}\nb ${HOME}\nc /tmp/kb.sock`, defaultKb: "a", env: {} });
  const nameOf = (r: ReturnType<typeof chooseStore>) => ("error" in r ? r.error : r.connection.name);

  test("the one named, else the one the tab shows, else the default", () => {
    assert.equal(nameOf(chooseStore(stores, "c", "b")), "c");
    assert.equal(nameOf(chooseStore(stores, undefined, "b")), "b");
    assert.equal(nameOf(chooseStore(stores, undefined, undefined)), "a");
    assert.equal(nameOf(chooseStore(stores, undefined, "gone")), "a");
  });

  test("an unknown name lists the configured ones", () => {
    assert.equal(nameOf(chooseStore(stores, "zz", undefined)), "kb has no store named zz; configured: a, b, c");
  });

  test("the agent's line names the default and the store in the tab", () => {
    assert.equal(storesLine(stores, "b"), "kb stores (pass kb: <name> to choose): a (default), b (in the tab), c (no page)");
  });
});

describe("the legacy single-store settings", () => {
  test("become one connections line named default, filled from the environment where empty", () => {
    assert.equal(legacyLine("", "", {}), null);
    assert.equal(legacyLine(HOME, "", { KB_SOCKET: "/run/kb.sock" }), `default ${HOME} /run/kb.sock`);
    assert.equal(legacyLine("", "/run/kb.sock", {}), "default /run/kb.sock");
  });
});
