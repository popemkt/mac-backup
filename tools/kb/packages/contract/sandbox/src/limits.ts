/**
 * What a sandbox run may spend, and which engine runs it (DESIGN.md →
 * Sandbox). Code is untrusted until a person trusts its digest on this
 * machine; untrusted code runs in QuickJS, whose interpreter enforces every
 * limit here, and trusted code runs in a Worker, which is faster and keeps
 * the same capability API and the same limits except memory, which a Worker
 * cannot cap.
 */
import { Schema } from "effect";

/** The two engines, one per trust level. */
export const ENGINE_KINDS = ["quickjs", "worker"] as const;
export type EngineKind = (typeof ENGINE_KINDS)[number];

/** The engine code runs in: a Worker once a person trusts it, QuickJS until then. */
export function engineKindFor(trusted: boolean): EngineKind {
  return trusted ? "worker" : "quickjs";
}

const Positive = Schema.Finite.check(Schema.isGreaterThan(0));

/**
 * The bounds of one run. A turn is one delivery to the guest — its first
 * run, a tool call's answer, an event — together with the promise jobs it
 * leaves behind; a turn that outlives `turnMs` is interrupted and ends the
 * run. Every other bound ends the run the moment it is crossed.
 */
export const SandboxLimits = Schema.Struct({
  /** How long one turn may run. */
  turnMs: Positive,
  /** The guest heap, in bytes; `null` where the engine cannot cap it (a Worker). */
  memoryBytes: Schema.NullOr(Positive),
  /** The guest's stack, in bytes, where the engine can cap it. */
  stackBytes: Positive,
  /** How many messages the guest may send in any one second. */
  messagesPerSecond: Positive,
  /** The largest message the guest may send, in UTF-16 code units. */
  maxMessageChars: Positive,
  /** How many tool calls may wait on the host at once. */
  maxPendingCalls: Positive,
  /** The largest tool result the guest is handed, in UTF-16 code units of its JSON. */
  maxResultChars: Positive,
  /** How many elements and text runs one drawing may hold. */
  maxDrawNodes: Positive,
});
export type SandboxLimits = typeof SandboxLimits.Type;

const SHARED = {
  stackBytes: 512 * 1024,
  messagesPerSecond: 200,
  maxMessageChars: 512 * 1024,
  maxPendingCalls: 16,
  maxResultChars: 512 * 1024,
  maxDrawNodes: 10_000,
} as const;

/** The limits each engine runs with. */
export const ENGINE_LIMITS: Readonly<Record<EngineKind, SandboxLimits>> = {
  quickjs: { ...SHARED, turnMs: 500, memoryBytes: 32 * 1024 * 1024 },
  worker: { ...SHARED, turnMs: 5_000, memoryBytes: null },
};
