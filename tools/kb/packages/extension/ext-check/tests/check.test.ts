import { describe, expect, test } from "bun:test";
import { Effect, Layer, Option } from "effect";
import * as FileSystem from "effect/FileSystem";
import { canonicalJsonl } from "@kb/model";
import {
  kbCtxLayer,
  kbStoreLayer,
  type EffectStore,
  type KbContext,
  type KbTxLog,
} from "@kb/contracts";
import type { KbNode, KbTx, StoreTx } from "@kb/model";
import { checkAuditEffect, checkSyncEffect, type Finding } from "../src/index.ts";

const ROOT = "/repo";
const AT = "2026-09-06T00:00:00.000Z";

function node(id: string, text: string, props: KbNode["props"] = {}): KbNode {
  return { id, text, props, children: [], createdAt: AT, updatedAt: AT };
}

function typed(id: string, text: string, type: string, props: KbNode["props"] = {}): KbNode {
  return node(id, text, { ...props, "sys.f.type": [{ t: "ref", v: type }] });
}

function applyTx(nodes: readonly KbNode[], tx: StoreTx): KbNode[] {
  const byId = new Map(nodes.map((entry) => [entry.id, entry]));
  for (const id of tx.deletes) byId.delete(id);
  for (const entry of tx.upserts) byId.set(entry.id, entry);
  return [...byId.values()].toSorted((a, b) => a.id.localeCompare(b.id));
}

class TestLog implements KbTxLog {
  readonly entries: KbTx[] = [];
  get head(): number {
    return this.entries.length;
  }
  append(ops: StoreTx, at: string, origin?: string): KbTx {
    const entry: KbTx = {
      rev: this.entries.length + 1,
      at,
      ops,
      ...(origin !== undefined ? { origin } : {}),
    };
    this.entries.push(entry);
    return entry;
  }
  since(rev: number): KbTx[] | "snapshot-required" {
    return rev > this.head ? "snapshot-required" : this.entries.filter((entry) => entry.rev > rev);
  }
  subscribe(): () => void {
    return () => undefined;
  }
}

function fixtureContext(initial: readonly KbNode[]) {
  let stored = [...initial];
  let indexed = [...initial];
  let generation = 0;
  let revision = 0;
  const store: EffectStore = {
    path: "/memory/nodes.jsonl",
    watchPaths: [],
    loadEffect: Effect.sync(() => [...stored]),
    fingerprint: Effect.sync(() => `revision:${revision}`),
    commitEffect: (tx) =>
      Effect.sync(() => {
        const base = `revision:${revision}`;
        stored = applyTx(stored, tx);
        revision += 1;
        return { base, fingerprint: `revision:${revision}` };
      }),
  };
  const index = {
    get generation() {
      return generation;
    },
    rebuild(nodes: ReadonlyArray<KbNode>) {
      indexed = [...nodes];
      generation += 1;
    },
    applyTx(tx: StoreTx) {
      indexed = applyTx(indexed, tx);
      generation += 1;
    },
    run() {
      return [];
    },
    runDatalog() {
      return [];
    },
    pull() {
      return undefined;
    },
    getNode(id: string) {
      return indexed.find((entry) => entry.id === id);
    },
    allNodes() {
      return indexed;
    },
    storedNodes() {
      return [...indexed];
    },
    search(text: string, limit = Number.POSITIVE_INFINITY) {
      const needle = text.toLowerCase();
      return indexed.filter((entry) => entry.text.toLowerCase().includes(needle)).slice(0, limit);
    },
    withVirtual() {
      generation += 1;
    },
  };
  const log = new TestLog();
  const ctx: KbContext = {
    root: ROOT,
    store,
    index,
    log,
    get nodes() {
      return index.storedNodes();
    },
  };
  return { ctx, store, log };
}

function matchGlob(path: string, pattern: string): boolean {
  if (!pattern.includes("*")) return path === pattern;
  const [prefix = "", suffix = ""] = pattern.split("*");
  return path.startsWith(prefix) && path.endsWith(suffix);
}

function relativePath(path: string): string {
  return path.startsWith(`${ROOT}/`) ? path.slice(ROOT.length + 1) : path;
}

function fileInfo(content: string): FileSystem.File.Info {
  return {
    type: "File",
    mtime: Option.none(),
    atime: Option.none(),
    birthtime: Option.none(),
    dev: 0,
    ino: Option.none(),
    mode: 0o644,
    nlink: Option.none(),
    uid: Option.none(),
    gid: Option.none(),
    rdev: Option.none(),
    size: FileSystem.Size(content.length),
    blksize: Option.none(),
    blocks: Option.none(),
  };
}

function fileLayer(files: ReadonlyMap<string, string>): Layer.Layer<FileSystem.FileSystem> {
  return FileSystem.layerNoop({
    exists: (path) => Effect.succeed(files.has(relativePath(path))),
    stat: (path) => Effect.succeed(fileInfo(files.get(relativePath(path)) ?? "")),
    glob: (pattern) => Effect.succeed([...files.keys()].filter((path) => matchGlob(path, pattern))),
    readFileString: (path) => Effect.succeed(files.get(relativePath(path)) ?? ""),
  });
}

interface Fixture {
  readonly nodes: KbNode[];
  readonly files: Map<string, string>;
}

function fixture(): Fixture {
  const nodes = [
    typed("tag.rule", "rule", "sys.tag"),
    typed("tag.check", "check", "sys.tag"),
    typed("f.home", "home", "sys.field"),
    // Enforcement levels are the field's children — the option set shape.
    // No `#enforcement-level` / `#check-surface` supertag exists to mark them.
    { ...typed("f.enforcement", "enforcement", "sys.field"), children: ["v.prose", "v.harness"] },
    typed("f.gate", "gate", "sys.field"),
    typed("f.check", "check", "sys.field"),
    typed("f.surface", "surface", "sys.field"),
    typed("f.evidence", "evidence", "sys.field"),
    typed("f.invocation", "invocation", "sys.field"),
    typed("f.blocking", "blocking", "sys.field"),
    node("v.prose", "prose"),
    node("v.harness", "harness"),
    node("check.harness", "harness-check", {
      "sys.f.type": [{ t: "ref", v: "tag.check" }],
      "f.surface": [{ t: "ref", v: "v.harness" }],
      "f.evidence": [{ t: "str", v: "tools/kb/harness/tests/check.test.ts" }],
      "f.invocation": [{ t: "str", v: "bun run harness" }],
      "f.blocking": [{ t: "bool", v: true }],
    }),
    node("rule.one", "One rule", {
      "sys.f.type": [{ t: "ref", v: "tag.rule" }],
      "f.home": [{ t: "str", v: "AGENTS.md#one-rule" }],
      "f.enforcement": [{ t: "ref", v: "v.harness" }],
      "f.check": [{ t: "ref", v: "check.harness" }],
    }),
  ];
  return {
    nodes,
    files: new Map([
      ["AGENTS.md", "# One rule\n"],
      ["tools/kb/harness/tests/check.test.ts", "test"],
      ["tools/kb/package.json", '"verify": "bun run harness"'],
    ]),
  };
}

function updateNode(nodes: KbNode[], id: string, update: (node: KbNode) => KbNode): void {
  const index = nodes.findIndex((entry) => entry.id === id);
  const current = nodes[index];
  if (current !== undefined) nodes[index] = update(current);
}

function audit(input: Fixture): Promise<readonly Finding[]> {
  const { ctx } = fixtureContext(input.nodes);
  return Effect.runPromise(
    checkAuditEffect({}).pipe(
      Effect.provide(Layer.mergeAll(kbCtxLayer(ctx), fileLayer(input.files))),
    ),
  ).then((output) => output.findings);
}

describe("ext.check.audit", () => {
  test("reports check-missing", () => {
    const input = fixture();
    updateNode(input.nodes, "rule.one", (rule) => ({
      ...rule,
      props: {
        ...rule.props,
        "f.check": [{ t: "ref", v: "check.absent" }],
        "f.enforcement": [{ t: "ref", v: "v.prose" }],
      },
    }));
    return audit(input).then((findings) => {
      expect(findings.map((finding) => finding.kind)).toContain("check-missing");
      return undefined;
    });
  });

  test("reports evidence-missing", () => {
    const input = fixture();
    input.files.delete("tools/kb/harness/tests/check.test.ts");
    return audit(input).then((findings) => {
      expect(findings.map((finding) => finding.kind)).toContain("evidence-missing");
      return undefined;
    });
  });

  test("reports invocation-unwired", () => {
    const input = fixture();
    input.files.set("tools/kb/package.json", '"verify": "bun run lint"');
    return audit(input).then((findings) => {
      expect(findings.map((finding) => finding.kind)).toContain("invocation-unwired");
      return undefined;
    });
  });

  test("reports enforcement-stale", () => {
    const input = fixture();
    updateNode(input.nodes, "rule.one", (rule) => ({
      ...rule,
      props: { ...rule.props, "f.enforcement": [{ t: "ref", v: "v.prose" }] },
    }));
    return audit(input).then((findings) => {
      expect(findings.map((finding) => finding.kind)).toContain("enforcement-stale");
      return undefined;
    });
  });

  test("reports gate-and-check", () => {
    const input = fixture();
    updateNode(input.nodes, "rule.one", (rule) => ({
      ...rule,
      props: { ...rule.props, "f.gate": [{ t: "str", v: "future gate" }] },
    }));
    return audit(input).then((findings) => {
      expect(findings.map((finding) => finding.kind)).toContain("gate-and-check");
      return undefined;
    });
  });

  test("reports home-broken", () => {
    const input = fixture();
    updateNode(input.nodes, "rule.one", (rule) => ({
      ...rule,
      props: { ...rule.props, "f.home": [{ t: "str", v: "AGENTS.md#missing" }] },
    }));
    return audit(input).then((findings) => {
      expect(findings.map((finding) => finding.kind)).toContain("home-broken");
      return undefined;
    });
  });

  test("sync followed by audit is clean", () => {
    const input = fixture();
    updateNode(input.nodes, "rule.one", (rule) => ({
      ...rule,
      props: { ...rule.props, "f.enforcement": [{ t: "ref", v: "v.prose" }] },
    }));
    const { ctx, store } = fixtureContext(input.nodes);
    return Effect.runPromise(
      Effect.gen(function* () {
        const synced = yield* checkSyncEffect({});
        const audited = yield* checkAuditEffect({});
        return { synced, audited };
      }).pipe(
        Effect.provide(
          Layer.mergeAll(kbCtxLayer(ctx), kbStoreLayer(store), fileLayer(input.files)),
        ),
      ),
    ).then((output) => {
      expect(output.synced.updated).toEqual(["rule.one"]);
      expect(output.audited).toEqual({ clean: true, findings: [] });
      return undefined;
    });
  });

  test("an enforcement level is a CHILD of the field — a loose node is not one", () => {
    // The option set is the parenting, not a supertag. A node named "harness"
    // that is not the field's child cannot be the value sync writes back, so
    // sync must find nothing rather than pick a lookalike out of the graph.
    const input = fixture();
    updateNode(input.nodes, "f.enforcement", (field) => ({ ...field, children: ["v.prose"] }));
    updateNode(input.nodes, "rule.one", (rule) => ({
      ...rule,
      props: { ...rule.props, "f.enforcement": [{ t: "ref", v: "v.prose" }] },
    }));
    const { ctx, store } = fixtureContext(input.nodes);
    return Effect.runPromise(
      checkSyncEffect({}).pipe(
        Effect.provide(
          Layer.mergeAll(kbCtxLayer(ctx), kbStoreLayer(store), fileLayer(input.files)),
        ),
      ),
    ).then((synced) => {
      expect(synced.updated).toEqual([]);
      return undefined;
    });
  });

  test("audit is pure", () => {
    const input = fixture();
    const { ctx, log } = fixtureContext(input.nodes);
    const before = canonicalJsonl(ctx.nodes);
    return Effect.runPromise(
      checkAuditEffect({}).pipe(
        Effect.provide(Layer.mergeAll(kbCtxLayer(ctx), fileLayer(input.files))),
      ),
    ).then(() => {
      expect(canonicalJsonl(ctx.nodes)).toBe(before);
      expect(log.head).toBe(0);
      return undefined;
    });
  });
});
