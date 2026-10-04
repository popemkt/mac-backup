/**
 * What `kb ui` reports of the extensions it hosts (DESIGN.md → Extension
 * families): `kb.manifest` lists the agent, loaded, beside the bundled
 * families when the server hosts it, and does not list it when the server
 * hosts none (`kb ui --no-agent`). The page follows that report, so a page
 * served without the agent never offers the agent's UI.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { agentExtension, agentPlugin, scriptedRuntime } from "@kb/agent";
import { BUNDLED_FAMILIES } from "@kb/bundled";
import type { ExtensionEntry, ExtensionRow } from "@kb/contracts";
import { kbManifestDef } from "@kb/operations";
import { bunFileSystemLayer } from "@kb/runtime";
import { startUi } from "@kb/server";

const AGENT: ExtensionEntry = {
  declaration: agentExtension,
  entry: agentPlugin({ runtime: scriptedRuntime(() => []) }),
};

/** The extensions a `kb ui` hosting `extensions` reports, over HTTP as the page asks. */
async function reportedBy(
  root: string,
  extensions: readonly ExtensionEntry[],
): Promise<readonly ExtensionRow[]> {
  const handle = await Effect.runPromise(
    startUi({ root, port: 0, openBrowser: false, extensions }).pipe(
      Effect.provide(bunFileSystemLayer),
    ),
  );
  try {
    const response = await fetch(`${handle.url}/api/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: kbManifestDef.id, input: {} }),
    });
    const body = (await response.json()) as { status: string; output: unknown };
    expect(body.status).toBe("succeeded");
    return kbManifestDef.outputSchema.parse(body.output).extensions;
  } finally {
    await Effect.runPromise(handle.stop);
  }
}

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
      optional: false,
      enabled: true,
      source: "host",
    });
  });

  test("without the agent, no agent is reported", async () => {
    const rows = await reportedBy(root, []);
    expect(rows.map((row) => row.name)).toEqual(
      BUNDLED_FAMILIES.map((declaration) => declaration.name),
    );
  });
});
