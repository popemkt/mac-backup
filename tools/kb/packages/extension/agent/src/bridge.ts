import { Cause, Deferred, Effect, Exit, Fiber, Stream, type Scope } from "effect";
import {
  ChannelPoint,
  UiHost,
  failed,
  listingOf,
  onWire,
  type ActionReceipt,
  type Channel,
  type ChannelPeer,
  type ManifestEntry,
  type UiHostService,
} from "@kb/contracts";
import { definePlugin, type Plugin } from "@kb/plugin";
import { AGENT_SYSTEM_PROMPT, screenContext } from "./prompt.ts";
import {
  AGENT_CHANNEL_ID,
  AGENT_PLUGIN,
  AGENT_WIRE,
  AgentRequestSchema,
  type AgentEvent,
  type AgentRequest,
} from "./protocol.ts";
import type { AgentOutput, AgentRuntime } from "./runtime.ts";

/**
 * The bridge: the agent plugin the `kb ui` server hosts. It owns the
 * conversations, gives the runtime the registry as its tools, and runs each
 * call through the invoke core, which decides it (`DESIGN.md` → Agent
 * packages):
 *
 * - every call runs at once through `UiHost.invoke`, the server's one invoke
 *   path, as the agent's;
 * - a call the invoke core answers `approval_required` is handed to the
 *   person: the sidebar asks, makes the call itself through the browser's
 *   invoke path, approved or not, and answers with the receipt. The bridge
 *   never predicts which calls ask and never says a call was approved; only
 *   the person's tab does, and the invoke core decides.
 */

/** One call waiting for the person, and the action it must be the receipt of. */
interface Waiting {
  readonly action: string;
  readonly answer: Deferred.Deferred<ActionReceipt>;
}

/**
 * How many conversations one connection holds at once. Starting one more
 * closes the connection's least recently spoken-in one: its turn is
 * interrupted (the sidebar hears `turn-end` cancelled, and a call waiting
 * for the person is dropped) and it is forgotten. Without the bound a
 * connection could grow the bridge's memory, and the turns in it, without
 * limit. Speaking to a closed conversation's id starts it afresh.
 */
export const MAX_CONVERSATIONS_PER_CONNECTION = 8;

/**
 * A conversation, in this process's memory only: it is gone when its
 * connection closes, when its connection starts more than
 * {@link MAX_CONVERSATIONS_PER_CONNECTION}, or when the server stops.
 */
// GAP [[01M40WSVNKVH3ZY8QE0GN5DY8X]]
interface Conversation {
  readonly id: string;
  /** The connection that started it; no other may speak in it. */
  readonly connection: string;
  /** The runtime's handle on the conversation so far. */
  resume: string | undefined;
  turn: Fiber.Fiber<void> | null;
  readonly waiting: Map<string, Waiting>;
}

function messageOf(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : String(error);
}

class Bridge {
  /** Least recently spoken-in first: speaking re-inserts, so Map order is the eviction order. */
  private readonly conversations = new Map<string, Conversation>();
  private readonly host: UiHostService;
  private readonly runtime: AgentRuntime;
  /** The plugin's scope: every turn runs in it, so unloading the plugin stops them. */
  private readonly scope: Scope.Scope;

  constructor(host: UiHostService, runtime: AgentRuntime, scope: Scope.Scope) {
    this.host = host;
    this.runtime = runtime;
    this.scope = scope;
  }

  readonly channel: Channel = {
    receive: (peer, data) => {
      const request = AgentRequestSchema.safeParse(data);
      if (!request.success) {
        return send(peer, { type: "refused", reason: request.error.issues[0]?.message ?? "" });
      }
      return this.handle(peer, request.data);
    },
    drop: (connection) =>
      Effect.forEach(this.heldBy(connection), (held) => this.close(held), { discard: true }),
  };

  private heldBy(connection: string): Conversation[] {
    return [...this.conversations.values()].filter((held) => held.connection === connection);
  }

  /** Forget a conversation and stop its turn, if one runs. */
  private close(held: Conversation): Effect.Effect<void> {
    this.conversations.delete(held.id);
    return held.turn === null ? Effect.void : Fiber.interrupt(held.turn);
  }

  private handle(peer: ChannelPeer, request: AgentRequest): Effect.Effect<void> {
    const held = this.conversations.get(request.conversation);
    if (held !== undefined && held.connection !== peer.connection) {
      return refuse(peer, request.conversation, "another connection holds this conversation");
    }
    if (request.type === "send") {
      if (held !== undefined) {
        this.conversations.delete(held.id);
        this.conversations.set(held.id, held);
        return this.start(peer, held, request.text);
      }
      const holding = this.heldBy(peer.connection);
      const surplus = holding.slice(
        0,
        Math.max(0, holding.length + 1 - MAX_CONVERSATIONS_PER_CONNECTION),
      );
      const opened = this.open(peer, request.conversation);
      return Effect.forEach(surplus, (old) => this.close(old), { discard: true }).pipe(
        Effect.andThen(this.start(peer, opened, request.text)),
      );
    }
    if (request.type === "cancel") {
      const turn = held?.turn ?? null;
      return turn === null ? Effect.void : Fiber.interrupt(turn);
    }
    const waiting = held?.waiting.get(request.call);
    if (waiting === undefined || waiting.action !== request.receipt.id) {
      return refuse(peer, request.conversation, `no call ${request.call} waits for a receipt`);
    }
    return Effect.asVoid(Deferred.succeed(waiting.answer, request.receipt));
  }

  private open(peer: ChannelPeer, id: string): Conversation {
    const conversation: Conversation = {
      id,
      connection: peer.connection,
      resume: undefined,
      turn: null,
      waiting: new Map(),
    };
    this.conversations.set(id, conversation);
    return conversation;
  }

  private start(peer: ChannelPeer, conversation: Conversation, text: string): Effect.Effect<void> {
    if (conversation.turn !== null) {
      return refuse(peer, conversation.id, "a turn is already running");
    }
    // The conversation is free again before the sidebar hears the turn end,
    // so a message it sends straight back is never refused as overlapping.
    let over = false;
    const turn = this.turn(peer, conversation, text).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          over = true;
          conversation.turn = null;
        }).pipe(Effect.andThen(send(peer, turnEnd(conversation.id, exit)))),
      ),
      Effect.ignoreCause,
    );
    // Started at once, so a cancel that follows the send finds a turn that
    // has begun and ends it with its `turn-end`, never one that never ran.
    return Effect.forkIn(turn, this.scope, { startImmediately: true }).pipe(
      Effect.map((fiber) => {
        if (!over) conversation.turn = fiber;
      }),
    );
  }

  private turn(peer: ChannelPeer, conversation: Conversation, text: string) {
    const { host, runtime } = this;
    const call = (byId: ReadonlyMap<string, ManifestEntry>) => (action: string, input: unknown) =>
      this.call(peer, conversation, byId.get(action), action, input);
    return Effect.gen(function* () {
      const screen = yield* screenContext(host, peer.tab());
      const manifest = yield* host.invoke(onWire(AGENT_WIRE, { id: "kb.manifest", input: {} }));
      const tools = listingOf(AGENT_WIRE, manifest);
      const outputs = runtime.turn({
        system: AGENT_SYSTEM_PROMPT,
        message: { text, screen },
        resume: conversation.resume,
        tools,
        call: call(new Map(tools.map((entry) => [entry.id, entry]))),
      });
      yield* Stream.runForEach(outputs, (output: AgentOutput) => {
        if (output.kind === "text") {
          return send(peer, { type: "text", conversation: conversation.id, delta: output.delta });
        }
        conversation.resume = output.resume;
        return Effect.void;
      });
    });
  }

  /**
   * Run one tool call through the invoke core, hand it to the person where
   * the core asks for them, and tell the sidebar about it on both sides.
   */
  private call(
    peer: ChannelPeer,
    conversation: Conversation,
    entry: ManifestEntry | undefined,
    action: string,
    input: unknown,
  ): Effect.Effect<ActionReceipt> {
    const { host } = this;
    const id = crypto.randomUUID();
    const askPerson = send(peer, {
      type: "approval",
      conversation: conversation.id,
      call: id,
    }).pipe(Effect.andThen(this.person(conversation, id, action)));
    return send(peer, {
      type: "tool-call",
      conversation: conversation.id,
      call: id,
      action,
      title: entry?.title ?? action,
      input,
    }).pipe(
      Effect.andThen(host.invoke(onWire(AGENT_WIRE, { id: action, input }))),
      Effect.filterOrElse(
        (receipt) => receipt.status !== "failed" || receipt.code !== "approval_required",
        () => askPerson,
      ),
      Effect.tap((receipt) =>
        send(peer, { type: "tool-result", conversation: conversation.id, call: id, receipt }),
      ),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.succeed(failed(action, "internal", messageOf(cause))),
      ),
    );
  }

  /** Wait for the person's receipt of the call `call`. */
  private person(conversation: Conversation, call: string, action: string) {
    return Effect.gen(function* () {
      const answer = yield* Deferred.make<ActionReceipt>();
      conversation.waiting.set(call, { action, answer });
      return yield* Deferred.await(answer);
    }).pipe(Effect.ensuring(Effect.sync(() => conversation.waiting.delete(call))));
  }
}

function send(peer: ChannelPeer, event: AgentEvent): Effect.Effect<void> {
  return peer.send(event);
}

function refuse(peer: ChannelPeer, conversation: string, reason: string): Effect.Effect<void> {
  return send(peer, { type: "refused", conversation, reason });
}

function turnEnd(conversation: string, exit: Exit.Exit<unknown, unknown>): AgentEvent {
  if (Exit.isSuccess(exit)) return { type: "turn-end", conversation, outcome: "done" };
  if (Cause.hasInterruptsOnly(exit.cause)) {
    return { type: "turn-end", conversation, outcome: "cancelled" };
  }
  return { type: "turn-end", conversation, outcome: "failed", message: messageOf(exit.cause) };
}

/**
 * The agent plugin over `runtime`: a channel, `agent.chat`, in a `kb ui`
 * server that provides {@link UiHost}. Anywhere else it waits, pending, and
 * does nothing.
 */
export function agentPlugin(options: { readonly runtime: AgentRuntime }): Plugin {
  return definePlugin({
    name: AGENT_PLUGIN,
    inject: [UiHost],
    apply: (ctx) =>
      Effect.gen(function* () {
        const host = yield* ctx.get(UiHost);
        const bridge = new Bridge(host, options.runtime, yield* Effect.scope);
        yield* ctx.contribute(ChannelPoint, { id: AGENT_CHANNEL_ID, value: bridge.channel });
      }),
  });
}
