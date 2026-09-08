/**
 * Evidence for gap [[01M1XA98A0A7PWEPMHG2T4R5GP]]: can two @kb/ui test files
 * ever observe the same store object?
 *
 * Two scopes get confused when a suite reddens under load, and they are not
 * the same thing:
 *
 * - **The realm** is `globalThis`. A runner that reuses one process for several
 *   files hands each of them the globals the last one left behind — the hazard
 *   `dom-globals.ts` exists to close.
 * - **The module registry** is what `import` resolves against. It is what
 *   decides whether two files get one `outline.store` module, and therefore one
 *   store object, or two.
 *
 * The probe records both from inside each file that runs it, then asserts the
 * property that matters: no neighbour sharing this realm shares this file's
 * module registry or store. Records live on `globalThis`, so a file only ever
 * sees the neighbours it genuinely shares a realm with — nothing is written to
 * disk and concurrent runs cannot collide.
 *
 * Rerun the counts behind the diagnosis with `pairing-counts.sh`.
 */
import { expect } from "vitest";
import { present } from "@kb/model";
import { useOutlineStore } from "@/stores/outline.store";

const REALM_KEY = "__kbIsolationProbe";

/** One file's view of the process it ran in. */
interface IsolationProbeRecord {
  readonly label: string;
  readonly pid: number;
  /** Fresh per realm: equal for two files that share a `globalThis`. */
  readonly realmNonce: string;
  /** Fresh per module registry: equal only if two files share one registry. */
  readonly moduleNonce: string;
  /** Identity of the store object this file's registry resolved. */
  readonly storeNonce: string;
  /** Whether a neighbour had already left a DOM on the realm's globals. */
  readonly inheritedWindow: boolean;
}

interface RealmProbe {
  readonly nonce: string;
  readonly records: IsolationProbeRecord[];
}

function nonce(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Per module registry: a second registry re-evaluates this module. */
const MODULE_NONCE = nonce();

/**
 * Per store object. `useOutlineStore` is a module singleton, so a second
 * registry mints a second store and a second entry here; two files sharing a
 * registry would read the same string back.
 */
const STORE_NONCES = new WeakMap<WeakKey, string>();

function storeNonce(): string {
  const existing = STORE_NONCES.get(useOutlineStore);
  if (existing !== undefined) return existing;
  const minted = nonce();
  STORE_NONCES.set(useOutlineStore, minted);
  return minted;
}

function isRealmProbe(value: unknown): value is RealmProbe {
  return typeof value === "object" && value !== null && "records" in value && "nonce" in value;
}

function realm(): RealmProbe {
  const g = globalThis as Record<string, unknown>;
  const existing = g[REALM_KEY];
  if (isRealmProbe(existing)) return existing;
  const fresh: RealmProbe = { nonce: nonce(), records: [] };
  g[REALM_KEY] = fresh;
  return fresh;
}

function table(records: readonly IsolationProbeRecord[]): string {
  const rows = records.map(
    (r) =>
      `| ${r.label} | ${r.pid} | ${r.realmNonce} | ${r.moduleNonce} | ${r.storeNonce} | ${r.inheritedWindow} |`,
  );
  return [
    "| file | pid | realm | module | store | inherited window |",
    "|---|---:|---|---|---|---|",
    ...rows,
  ].join("\n");
}

/**
 * Record this file's identity, assert it shares nothing writable with the
 * neighbours in its realm, and return the observation table for the caller to
 * print. A file that runs alone in its realm asserts nothing and prints one
 * row; a file that follows a neighbour prints both.
 */
export function probeStoreIsolation(label: string): string {
  const here = realm();
  here.records.push({
    label,
    pid: process.pid,
    realmNonce: here.nonce,
    moduleNonce: MODULE_NONCE,
    storeNonce: storeNonce(),
    inheritedWindow: "window" in globalThis,
  });

  const mine = present(here.records.at(-1), "this file's probe record");
  for (const other of here.records.slice(0, -1)) {
    expect(other.moduleNonce, `${other.label} and ${label} share a module registry`).not.toBe(
      mine.moduleNonce,
    );
    expect(other.storeNonce, `${other.label} and ${label} share a store object`).not.toBe(
      mine.storeNonce,
    );
  }

  // Whatever a neighbour did to its store, this file starts on a pristine one.
  const state = useOutlineStore.getState();
  expect(state.activeNodeId).toBeNull();
  expect(state.wireNodes).toHaveLength(0);

  return table(here.records);
}
