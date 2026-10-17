/**
 * What `kb ui` reports of the extensions it hosts (DESIGN.md → Extension
 * families): `kb.manifest` lists the agent beside the bundled families, on
 * while its store has it on, which it is by default. Switched off with
 * `extension.switch`, like any family, the server stops hosting it, live,
 * and reports it off; switched on, it hosts it again. A server handed no
 * agent does not list one. The page follows that report, so a page served
 * without the agent on never offers the agent's UI.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import {
  AGENT_ADAPTERS,
  DEFAULT_ADAPTER,
  agentExtension,
  agentPlugin,
  scriptedRuntime,
} from "@kb/agent";
import { BUNDLED_FAMILIES, HOSTED_FAMILIES } from "@kb/bundled";
import {
  NO_SECRETS,
  PAGE_TOKEN_HEADER,
  pageTokenOf,
  type ExtensionEntry,
  type ExtensionRow,
} from "@kb/contracts";
import { kbManifestDef } from "@kb/operations";
import { bunFileSystemLayer } from "@kb/runtime";
import { startUi } from "@kb/server";
import { hostAgentAdapters, hostExtensions } from "../src/host-plugins.ts";

const AGENT: ExtensionEntry = {
  declaration: agentExtension,
  entry: agentPlugin({
    adapters: [{ id: DEFAULT_ADAPTER, login: () => [], runtime: () => scriptedRuntime(() => []) }],
    secrets: NO_SECRETS,
  }),
};

/** A person's call from the page at `page`, over HTTP as the page makes it; its receipt's body. */
async function call(page: string, id: string, input: unknown): Promise<Record<string, unknown>> {
  const url = new URL(page).origin;
  const response = await fetch(`${url}/api/action`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: url,
      [PAGE_TOKEN_HEADER]: pageTokenOf(page) ?? "",
    },
    body: JSON.stringify({ id, input, actor: "human" }),
  });
  return (await response.json()) as Record<string, unknown>;
}

/** The extensions the server of the page at `page` reports, as the page asks. */
async function reportedAt(page: string): Promise<readonly ExtensionRow[]> {
  const body = await call(page, kbManifestDef.id, {});
  expect(body.status).toBe("succeeded");
  return kbManifestDef.outputSchema.parse(body.output).extensions;
}

/** Run `against` on the page of a `kb ui` over `root` hosting `extensions`. */
async function served<T>(
  root: string,
  extensions: readonly ExtensionEntry[],
  against: (page: string) => Promise<T>,
): Promise<T> {
  const handle = await Effect.runPromise(
    startUi({ root, port: 0, openBrowser: false, extensions }).pipe(
      Effect.provide(bunFileSystemLayer),
    ),
  );
  try {
    return await against(handle.page);
  } finally {
    await Effect.runPromise(handle.stop);
  }
}

/** The extensions a `kb ui` hosting `extensions` reports. */
function reportedBy(
  root: string,
  extensions: readonly ExtensionEntry[],
): Promise<readonly ExtensionRow[]> {
  return served(root, extensions, reportedAt);
}

describe("what kb ui hosts is what the fold declares", () => {
  test("it hands over exactly the hosted families, so each one's seed is in every store", async () => {
    const entries = await Effect.runPromise(hostExtensions("/"));
    expect(entries.map(({ declaration }) => declaration)).toEqual([...HOSTED_FAMILIES]);
  });

  test("it implements every adapter a provider may name, once", async () => {
    const adapters = await Effect.runPromise(hostAgentAdapters("/"));
    expect(adapters.map(({ id }) => id).toSorted()).toEqual(
      AGENT_ADAPTERS.map(({ id }) => id).toSorted(),
    );
  });
});

describe("kb ui reports the extensions it hosts", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kb-host-extensions-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("with the agent, the agent is reported loaded, after the bundled families", async () => {
    const rows = await reportedBy(root, [AGENT]);
    expect(rows.map((row) => row.name)).toEqual([
      ...BUNDLED_FAMILIES.map((declaration) => declaration.name),
      "agent",
    ]);
    expect(rows.find((row) => row.name === "agent")).toEqual({
      name: "agent",
      label: "Agent",
      optional: true,
      enabled: true,
      source: "host",
    });
  });

  test("switched off, the server stops hosting the agent, live; switched on, it hosts it again", async () => {
    await served(root, [AGENT], async (page) => {
      const agentAt = async () => (await reportedAt(page)).find((row) => row.name === "agent");
      expect(await call(page, "extension.switch", { name: "agent", on: false })).toMatchObject({
        status: "succeeded",
      });
      expect(await agentAt()).toMatchObject({ optional: true, enabled: false });
      expect(await call(page, "extension.switch", { name: "agent", on: true })).toMatchObject({
        status: "succeeded",
      });
      expect(await agentAt()).toMatchObject({ enabled: true });
    });
  });

  test("a store with the agent switched off starts without it", async () => {
    await served(root, [AGENT], (page) =>
      call(page, "extension.switch", { name: "agent", on: false }),
    );
    const rows = await reportedBy(root, [AGENT]);
    expect(rows.find((row) => row.name === "agent")).toMatchObject({ enabled: false });
  });

  test("without the agent, no agent is reported", async () => {
    const rows = await reportedBy(root, []);
    expect(rows.map((row) => row.name)).toEqual(
      BUNDLED_FAMILIES.map((declaration) => declaration.name),
    );
  });
});
