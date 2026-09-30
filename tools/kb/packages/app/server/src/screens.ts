import { Deferred, Effect, Layer, Option } from "effect";
import {
  SCREEN_COMMAND_TIMEOUT_MS,
  Screens,
  navigateCommand,
  noTabReceipt,
  selectCommand,
  type ActionHandlerEnv,
  type KbContext,
  type ScreenAck,
  type ScreenCommand,
  type ScreenReceipt,
  type ScreenState,
  type ScreensPort,
  type ServerMessage,
  type TabScreen,
} from "@kb/contracts";
import { kbRuntimeLayer } from "@kb/runtime";
import type { ClientSend } from "./session.ts";

interface Tab {
  /** The connection the tab publishes on now; a reconnect replaces it. */
  readonly connection: string;
  readonly send: ClientSend;
  readonly state: ScreenState;
  /**
   * When the tab last published while it had the person's attention, as a
   * position in the order of events; 0 for a tab that never has.
   */
  readonly activeAt: number;
}

interface Pending {
  readonly tab: string;
  readonly connection: string;
  readonly answer: Deferred.Deferred<ScreenReceipt>;
}

/**
 * The screens of the UI tabs connected to this `kb ui`: the one place they
 * are held (`DESIGN.md` → Screen state).
 *
 * A tab is known by the id its connection names, not by the connection: a
 * tab that reconnects is the same tab on a new connection, and the old
 * connection's close, however late it arrives, drops nothing the new one
 * published. A connection becomes a tab when it publishes a screen, and the
 * tab is forgotten when that connection closes. Only the latest record per
 * tab is kept, in memory; nothing reaches the store. A command goes to one
 * tab as a `screen-command` frame and waits for that connection's
 * `screen-ack` of the same id, up to its timeout.
 *
 * The socket hub owns the connections and hands this hub what concerns
 * screens: a published record, an answer, a close.
 */
export class ScreenHub {
  private readonly tabs = new Map<string, Tab>();
  private readonly pending = new Map<string, Pending>();
  private clock = 0;

  /** The tab `tab`, on `connection`, now shows `state`. */
  publish(
    connection: string,
    tab: string,
    send: ClientSend,
    state: ScreenState,
  ): Effect.Effect<void> {
    return Effect.sync(() => {
      // A tab the person is using moves to the front; one in the background keeps its place.
      const activeAt = state.active ? ++this.clock : (this.tabs.get(tab)?.activeAt ?? 0);
      this.tabs.set(tab, { connection, send, state, activeAt });
    });
  }

  /** `connection` answered the command `id`. An answer nobody waits for is dropped. */
  ack(connection: string, id: string, result: ScreenAck): Effect.Effect<void> {
    return Effect.suspend(() => {
      const pending = this.pending.get(id);
      if (pending === undefined || pending.connection !== connection) return Effect.void;
      return Deferred.succeed(pending.answer, { ...result, tab: pending.tab }).pipe(Effect.asVoid);
    });
  }

  /** `connection` closed: the tab on it is not live any more, and cannot answer. */
  drop(connection: string): Effect.Effect<void> {
    return Effect.suspend(() => {
      for (const [tab, held] of this.tabs) {
        if (held.connection === connection) this.tabs.delete(tab);
      }
      return this.settle((pending) => pending.connection === connection);
    });
  }

  /** The server is stopping: no tab will answer. */
  dispose(): Effect.Effect<void> {
    return Effect.suspend(() => {
      this.tabs.clear();
      return this.settle(() => true);
    });
  }

  /** Every pending command `which` picks gets `no-tab`: its tab is gone. */
  private settle(which: (pending: Pending) => boolean): Effect.Effect<void> {
    const gone = [...this.pending.values()].filter(which);
    return Effect.forEach(
      gone,
      (pending) => Deferred.succeed(pending.answer, noTabReceipt(pending.tab)),
      { discard: true },
    );
  }

  /** The live tabs, most recently active first; ties keep the order they arrived in. */
  private ordered(): TabScreen[] {
    return [...this.tabs.entries()]
      .toSorted(([, a], [, b]) => b.activeAt - a.activeAt)
      .map(([tab, { state }]) => ({ tab, ...state }));
  }

  private readonly command = Effect.fn("kb.screens.command")(function* (
    this: ScreenHub,
    tab: string | undefined,
    command: ScreenCommand,
    timeoutMs: number,
  ) {
    const target = tab ?? this.ordered()[0]?.tab;
    const live = target === undefined ? undefined : this.tabs.get(target);
    if (target === undefined || live === undefined) return noTabReceipt(tab);
    const id = crypto.randomUUID();
    const answer = yield* Deferred.make<ScreenReceipt>();
    const frame: ServerMessage = { op: "screen-command", id, command };
    const receipt = yield* Effect.sync(() =>
      this.pending.set(id, { tab: target, connection: live.connection, answer }),
    ).pipe(
      Effect.andThen(live.send(JSON.stringify(frame))),
      Effect.andThen(Deferred.await(answer).pipe(Effect.timeoutOption(timeoutMs))),
      Effect.ensuring(Effect.sync(() => this.pending.delete(id))),
    );
    return Option.getOrElse(
      receipt,
      (): ScreenReceipt => ({ outcome: "timeout", tab: target, timeoutMs }),
    );
  });

  /** This hub as the {@link Screens} port the `ui.*` actions read and drive. */
  readonly port: ScreensPort = {
    screen: (input) =>
      Effect.sync(() => {
        const tabs = this.ordered();
        return {
          tabs: input.tab === undefined ? tabs : tabs.filter(({ tab }) => tab === input.tab),
        };
      }),
    navigate: (input) =>
      this.command(input.tab, navigateCommand(input), input.timeoutMs ?? SCREEN_COMMAND_TIMEOUT_MS),
    select: (input) =>
      this.command(input.tab, selectCommand(input), input.timeoutMs ?? SCREEN_COMMAND_TIMEOUT_MS),
  };
}

/**
 * The runtime the `kb ui` server runs actions in: the root's runtime, with
 * the screens this server holds in place of the adapter that would reach a
 * server.
 */
export function serverRuntimeLayer(
  ctx: KbContext,
  screens: ScreenHub,
): Layer.Layer<ActionHandlerEnv> {
  return Layer.merge(kbRuntimeLayer(ctx), Layer.succeed(Screens, screens.port));
}
