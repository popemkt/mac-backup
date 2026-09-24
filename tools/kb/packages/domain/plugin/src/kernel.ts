import { Cause, Effect, Exit, Scope } from "effect";
import { PluginError, type PluginErrorReason } from "./errors.ts";
import {
  asKeyType,
  type AnyServiceKey,
  type EventKey,
  type Key,
  type PointKey,
  type ServiceKey,
} from "./keys.ts";

/** What a plugin hands a point: a local id, optional absolute aliases, the value. */
export interface ContributionEntry<C> {
  readonly id: string;
  /** Extra ids this contribution also answers to, taken as written (compat shims). */
  readonly aliases?: readonly string[];
  readonly value: C;
}

/** A contribution as a point holds it: namespaced id, and who contributed it. */
export interface Contribution<C> {
  /** `<namespace>.<id>`, or the bare id for a plugin in the root namespace. */
  readonly id: string;
  readonly aliases: readonly string[];
  /** Name of the plugin that contributed it. */
  readonly owner: string;
  readonly value: C;
}

/**
 * A plugin's handle on the kernel. Everything registered through it —
 * services, contributions, listeners, children — belongs to the plugin's
 * scope, so it is undone when the plugin unloads or goes back to pending.
 */
export interface PluginContext {
  readonly name: string;
  /** Prefix of this plugin's contribution ids; `""` is the root namespace. */
  readonly namespace: string;
  /** A service this plugin declared in `inject`. */
  get<S>(key: ServiceKey<S>): Effect.Effect<S, PluginError>;
  provide<S>(key: ServiceKey<S>, impl: S): Effect.Effect<void, PluginError>;
  contribute<C>(
    point: PointKey<C>,
    entry: ContributionEntry<C>,
  ): Effect.Effect<Contribution<C>, PluginError>;
  /** Listen for an event. A failing handler is reported; it never fails the emitter. */
  on<P>(
    event: EventKey<P>,
    handler: (payload: P) => Effect.Effect<void, PluginError>,
  ): Effect.Effect<void, PluginError>;
  emit<P>(event: EventKey<P>, payload: P): Effect.Effect<void>;
  /** Load a child plugin; it unloads with this one and shares its namespace by default. */
  plugin(child: Plugin): Effect.Effect<PluginHandle, PluginError>;
}

/**
 * A plugin is a value. One that takes configuration is a function returning
 * a plugin, so composing plugins is composing values — no config channel.
 */
export interface Plugin {
  readonly name: string;
  /** Contribution id prefix. Defaults to the name (a child: its parent's namespace). */
  readonly namespace?: string;
  /** Services that must exist before `apply` runs; the plugin waits until they do. */
  readonly inject?: readonly AnyServiceKey[];
  /** Runs with the plugin's scope as `Scope`: `acquireRelease` in here is released on unload. */
  readonly apply: (ctx: PluginContext) => Effect.Effect<void, PluginError, Scope.Scope>;
}

export function definePlugin(plugin: Plugin): Plugin {
  return plugin;
}

/**
 * `pending`: loaded, waiting for an injected service. `active`: applied.
 * `failed`: `apply` failed and everything it registered was undone.
 */
export type PluginStatus = "pending" | "active" | "failed";

export interface PluginState {
  readonly name: string;
  readonly namespace: string;
  readonly status: PluginStatus;
  /** The plugin that loaded this one as a child, if any. */
  readonly parent: string | null;
  /** Injected services nobody provides right now. */
  readonly missing: readonly string[];
  readonly error: PluginError | null;
}

export interface PluginHandle {
  readonly name: string;
  /** Unload the plugin; unloading one that is already gone does nothing. */
  readonly unload: Effect.Effect<void>;
}

export interface Kernel {
  load(plugin: Plugin): Effect.Effect<PluginHandle, PluginError>;
  unload(name: string): Effect.Effect<void, PluginError>;
  /** Unload every plugin, newest first. */
  readonly shutdown: Effect.Effect<void>;
  /** Every contribution to a point, in the order it was made. */
  contributions<C>(point: PointKey<C>): readonly Contribution<C>[];
  /** The contribution holding `id` as its id or one of its aliases. */
  lookup<C>(point: PointKey<C>, id: string): Contribution<C> | undefined;
  service<S>(key: ServiceKey<S>): S | undefined;
  plugins(): readonly PluginState[];
  /** Called after every change to plugins, services or contributions. */
  subscribe(listener: () => void): () => void;
  /** Moves on every change; the snapshot `useSyncExternalStore` compares. */
  version(): number;
}

interface Entry {
  readonly name: string;
  readonly namespace: string;
  readonly inject: readonly AnyServiceKey[];
  readonly parent: string | null;
  readonly apply: Plugin["apply"];
  status: PluginStatus;
  error: PluginError | null;
  /** Open while `active`; everything the plugin registered hangs off it. */
  scope: Scope.Closeable | null;
}

interface ServiceSlot {
  readonly key: AnyServiceKey;
  readonly owner: string;
  readonly impl: unknown;
}

interface PointSlot {
  readonly key: Key<"point", unknown>;
  readonly items: Contribution<unknown>[];
  /** Ids and aliases, so a lookup and a conflict check are one read. */
  readonly byId: Map<string, Contribution<unknown>>;
}

interface Listener {
  readonly owner: string;
  readonly run: (payload: unknown) => Effect.Effect<void, PluginError>;
}

interface EventSlot {
  readonly key: Key<"event", unknown>;
  readonly listeners: Listener[];
}

function refusal(plugin: string, reason: PluginErrorReason, message: string): PluginError {
  return new PluginError({ plugin, reason, message });
}

function failureOf(plugin: string, cause: Cause.Cause<PluginError>): PluginError {
  const squashed = Cause.squash(cause);
  if (squashed instanceof PluginError) return squashed;
  return refusal(
    plugin,
    "apply-failed",
    squashed instanceof Error ? squashed.message : String(squashed),
  );
}

function namespaced(namespace: string, id: string): string {
  return namespace === "" ? id : `${namespace}.${id}`;
}

/** Everything a kernel knows, mutated only inside the effects below. */
interface State {
  readonly entries: Map<string, Entry>;
  readonly services: Map<string, ServiceSlot>;
  readonly points: Map<string, PointSlot>;
  readonly events: Map<string, EventSlot>;
  readonly subscribers: Set<() => void>;
  version: number;
}

function changed(state: State): void {
  state.version++;
  for (const listener of state.subscribers) listener();
}

function missingOf(state: State, entry: Entry): string[] {
  return entry.inject
    .filter((key) => state.services.get(key.name)?.key !== key)
    .map((key) => key.name);
}

function scopeOf(entry: Entry): Effect.Effect<Scope.Closeable, PluginError> {
  return entry.scope === null
    ? Effect.fail(refusal(entry.name, "not-loaded", `plugin ${entry.name} is not active`))
    : Effect.succeed(entry.scope);
}

/** The slot's key must be this very key object: one name, one meaning. */
function claim<K extends string>(
  owner: string,
  slotKey: Key<K, unknown> | undefined,
  key: Key<K, unknown>,
): Effect.Effect<void, PluginError> {
  return slotKey === undefined || slotKey === key
    ? Effect.void
    : Effect.fail(
        refusal(owner, "key-mismatch", `two different ${key.kind} keys are named ${key.name}`),
      );
}

const deactivate = Effect.fnUntraced(function* (state: State, entry: Entry, next: PluginStatus) {
  const scope = entry.scope;
  // Marked inactive before its finalizers run, so a finalizer that reaches
  // back into the kernel sees a plugin that is already on its way out.
  entry.scope = null;
  entry.status = next;
  if (scope !== null) yield* Scope.close(scope, Exit.void);
  changed(state);
});

const removeService = Effect.fnUntraced(function* (state: State, name: string) {
  state.services.delete(name);
  changed(state);
  // Whoever injected it holds a reference to something that is gone: back to
  // pending, and forward again when a provider returns.
  for (const dependent of state.entries.values()) {
    if (dependent.status === "active" && dependent.inject.some((key) => key.name === name)) {
      yield* deactivate(state, dependent, "pending");
    }
  }
});

const activate = Effect.fnUntraced(function* (state: State, entry: Entry) {
  const scope = yield* Scope.make();
  entry.scope = scope;
  entry.status = "active";
  entry.error = null;
  changed(state);
  const exit = yield* Effect.exit(Scope.provide(scope)(entry.apply(contextFor(state, entry))));
  if (Exit.isSuccess(exit) || entry.scope !== scope) return;
  // A failed apply leaves nothing behind: closing its scope undoes every
  // registration it made before it failed.
  entry.scope = null;
  entry.status = "failed";
  entry.error = failureOf(entry.name, exit.cause);
  yield* Scope.close(scope, exit);
  changed(state);
});

/** Activate every pending plugin whose services now all exist, until none is left. */
const reconcile = Effect.fnUntraced(function* (state: State) {
  const next = (): Entry | undefined =>
    state.entries
      .values()
      .find((entry) => entry.status === "pending" && missingOf(state, entry).length === 0);
  for (let ready = next(); ready !== undefined; ready = next()) yield* activate(state, ready);
});

const unloadEntry = Effect.fnUntraced(function* (state: State, name: string) {
  const entry = state.entries.get(name);
  if (entry === undefined) {
    return yield* refusal(name, "not-loaded", `no plugin named ${name}`);
  }
  yield* deactivate(state, entry, entry.status);
  state.entries.delete(name);
  changed(state);
  return undefined;
});

const loadEntry = Effect.fnUntraced(function* (state: State, plugin: Plugin, parent: Entry | null) {
  const name = parent === null ? plugin.name : `${parent.name}/${plugin.name}`;
  if (state.entries.has(name)) {
    return yield* refusal(name, "name-taken", `a plugin named ${name} is loaded`);
  }
  // A child is torn down by its parent's scope, so the parent must be live
  // before the child exists at all.
  const parentScope = parent === null ? null : yield* scopeOf(parent);
  const entry: Entry = {
    name,
    namespace: plugin.namespace ?? parent?.namespace ?? plugin.name,
    inject: plugin.inject ?? [],
    parent: parent?.name ?? null,
    apply: plugin.apply,
    status: "pending",
    error: null,
    scope: null,
  };
  state.entries.set(name, entry);
  changed(state);
  const handle: PluginHandle = {
    name,
    unload: unloadEntry(state, name).pipe(Effect.catchTag("Kb/PluginError", () => Effect.void)),
  };
  if (parentScope !== null) yield* Scope.addFinalizer(parentScope, handle.unload);
  yield* reconcile(state);
  if (entry.status === "failed" && entry.error !== null) return yield* entry.error;
  return handle;
});

const provideErased = Effect.fnUntraced(function* (
  state: State,
  entry: Entry,
  key: AnyServiceKey,
  impl: unknown,
) {
  const scope = yield* scopeOf(entry);
  const existing = state.services.get(key.name);
  yield* claim(entry.name, existing?.key, key);
  if (existing !== undefined) {
    return yield* refusal(
      entry.name,
      "service-conflict",
      `service ${key.name} is already provided by ${existing.owner}`,
    );
  }
  state.services.set(key.name, { key, owner: entry.name, impl });
  yield* Scope.addFinalizer(scope, removeService(state, key.name));
  changed(state);
  // A new service can be the last thing a pending plugin was waiting for; it
  // activates once this plugin's load is done with the kernel.
  return undefined;
});

const getErased = Effect.fnUntraced(function* (state: State, entry: Entry, key: AnyServiceKey) {
  if (!entry.inject.includes(key)) {
    return yield* refusal(
      entry.name,
      "not-injected",
      `${entry.name} reads ${key.name} without declaring it in inject`,
    );
  }
  const slot = state.services.get(key.name);
  if (slot?.key !== key) {
    return yield* refusal(entry.name, "not-loaded", `service ${key.name} is not provided`);
  }
  return slot.impl;
});

const contributeErased = Effect.fnUntraced(function* (
  state: State,
  entry: Entry,
  point: Key<"point", unknown>,
  item: ContributionEntry<unknown>,
) {
  const scope = yield* scopeOf(entry);
  const existing = state.points.get(point.name);
  yield* claim(entry.name, existing?.key, point);
  const slot: PointSlot = existing ?? { key: point, items: [], byId: new Map() };
  const contribution: Contribution<unknown> = {
    id: namespaced(entry.namespace, item.id),
    aliases: item.aliases ?? [],
    owner: entry.name,
    value: item.value,
  };
  const ids = [contribution.id, ...contribution.aliases];
  const clash = ids.find((id) => slot.byId.has(id));
  if (clash !== undefined) {
    return yield* refusal(
      entry.name,
      "contribution-conflict",
      `${point.name} already has ${clash} (from ${slot.byId.get(clash)?.owner ?? "?"})`,
    );
  }
  state.points.set(point.name, slot);
  slot.items.push(contribution);
  for (const id of ids) slot.byId.set(id, contribution);
  yield* Scope.addFinalizer(
    scope,
    Effect.sync(() => {
      slot.items.splice(slot.items.indexOf(contribution), 1);
      for (const id of ids) slot.byId.delete(id);
      changed(state);
    }),
  );
  changed(state);
  return contribution;
});

const onErased = Effect.fnUntraced(function* (
  state: State,
  entry: Entry,
  event: Key<"event", unknown>,
  listener: Listener,
) {
  const scope = yield* scopeOf(entry);
  const existing = state.events.get(event.name);
  yield* claim(entry.name, existing?.key, event);
  const slot: EventSlot = existing ?? { key: event, listeners: [] };
  state.events.set(event.name, slot);
  slot.listeners.push(listener);
  yield* Scope.addFinalizer(
    scope,
    Effect.sync(() => {
      slot.listeners.splice(slot.listeners.indexOf(listener), 1);
    }),
  );
});

const emitErased = Effect.fnUntraced(function* (
  state: State,
  event: Key<"event", unknown>,
  payload: unknown,
) {
  const slot = state.events.get(event.name);
  if (slot?.key !== event) return;
  // A copy: a handler may unload a plugin and splice the list under us.
  for (const listener of slot.listeners.slice()) {
    const exit = yield* Effect.exit(listener.run(payload));
    if (Exit.isFailure(exit)) {
      yield* Effect.logWarning(
        `kb plugin ${listener.owner}: ${event.name} handler failed`,
        Cause.pretty(exit.cause),
      );
    }
  }
});

function contextFor(state: State, entry: Entry): PluginContext {
  return {
    name: entry.name,
    namespace: entry.namespace,
    get: (key) => getErased(state, entry, key).pipe(Effect.map((impl) => asKeyType(key, impl))),
    provide: (key, impl) => provideErased(state, entry, key, impl),
    contribute: (point, item) =>
      contributeErased(state, entry, point, item).pipe(
        Effect.map((contribution) => ({ ...contribution, value: item.value })),
      ),
    on: (event, handler) =>
      onErased(state, entry, event, {
        owner: entry.name,
        run: (payload) => handler(asKeyType(event, payload)),
      }),
    emit: (event, payload) => emitErased(state, event, payload),
    plugin: (child) => loadEntry(state, child, entry),
  };
}

/**
 * The plugin kernel: one per host (the server session, the CLI, the browser).
 * State is plain maps mutated only inside the kernel's own effects, and read
 * synchronously, so a UI can render from it without running an Effect.
 */
export function makeKernel(): Kernel {
  const state: State = {
    entries: new Map(),
    services: new Map(),
    points: new Map(),
    events: new Map(),
    subscribers: new Set(),
    version: 0,
  };
  return {
    load: (plugin) => loadEntry(state, plugin, null),
    unload: (name) => unloadEntry(state, name),
    shutdown: Effect.suspend(() =>
      Effect.forEach(
        [...state.entries.values()].filter((entry) => entry.parent === null).toReversed(),
        (entry) =>
          unloadEntry(state, entry.name).pipe(Effect.catchTag("Kb/PluginError", () => Effect.void)),
        { discard: true },
      ),
    ),
    contributions: (point) => {
      const slot = state.points.get(point.name);
      if (slot?.key !== point) return [];
      return slot.items.map((item) => ({ ...item, value: asKeyType(point, item.value) }));
    },
    lookup: (point, id) => {
      const slot = state.points.get(point.name);
      const item = slot?.key === point ? slot.byId.get(id) : undefined;
      return item === undefined ? undefined : { ...item, value: asKeyType(point, item.value) };
    },
    service: (key) => {
      const slot = state.services.get(key.name);
      return slot?.key === key ? asKeyType(key, slot.impl) : undefined;
    },
    plugins: () =>
      [...state.entries.values()].map((entry) => ({
        name: entry.name,
        namespace: entry.namespace,
        status: entry.status,
        parent: entry.parent,
        missing: missingOf(state, entry),
        error: entry.error,
      })),
    subscribe: (listener) => {
      state.subscribers.add(listener);
      return () => {
        state.subscribers.delete(listener);
      };
    },
    version: () => state.version,
  };
}
