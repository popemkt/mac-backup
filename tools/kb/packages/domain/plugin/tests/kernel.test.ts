import { describe, expect, test } from "bun:test";
import { Cause, Effect, Exit } from "effect";
import {
  Event,
  Point,
  Service,
  definePlugin,
  makeKernel,
  type Kernel,
  type Plugin,
  PluginError,
} from "../src/index.ts";

const Greetings = Point<string>()("test.greetings");
const Counter = Service<{ readonly next: () => number }>()("test.counter");
const Said = Event<string>()("test.said");

function greeter(name: string, ...words: string[]): Plugin {
  return definePlugin({
    name,
    apply: (ctx) =>
      Effect.forEach(words, (word) => ctx.contribute(Greetings, { id: word, value: word }), {
        discard: true,
      }),
  });
}

const counterProvider = definePlugin({
  name: "counter",
  apply: (ctx) => {
    let n = 0;
    return ctx.provide(Counter, { next: () => ++n });
  },
});

const counterUser = definePlugin({
  name: "user",
  inject: [Counter],
  apply: Effect.fnUntraced(function* (ctx) {
    const counter = yield* ctx.get(Counter);
    yield* ctx.contribute(Greetings, { id: "count", value: String(counter.next()) });
  }),
});

function run<A>(effect: Effect.Effect<A, PluginError>): A {
  return Effect.runSync(effect);
}

function failure(effect: Effect.Effect<unknown, PluginError>): PluginError | null {
  const exit = Effect.runSyncExit(effect);
  if (Exit.isSuccess(exit)) return null;
  const error = Cause.squash(exit.cause);
  return error instanceof PluginError ? error : null;
}

function ids(kernel: Kernel): string[] {
  return kernel.contributions(Greetings).map((c) => c.id);
}

function statusOf(kernel: Kernel, name: string): string | undefined {
  return kernel.plugins().find((p) => p.name === name)?.status;
}

describe("loading and unloading", () => {
  test("a plugin's contributions exist exactly while it is loaded, namespaced by it", () => {
    const kernel = makeKernel();
    let notified = 0;
    kernel.subscribe(() => notified++);
    const handle = run(kernel.load(greeter("hello", "a", "b")));
    expect(ids(kernel)).toEqual(["hello.a", "hello.b"]);
    expect(kernel.lookup(Greetings, "hello.b")?.owner).toBe("hello");
    expect(notified).toBeGreaterThan(0);

    const before = kernel.version();
    run(handle.unload);
    expect(ids(kernel)).toEqual([]);
    expect(kernel.plugins()).toEqual([]);
    expect(kernel.version()).toBeGreaterThan(before);
    run(handle.unload);
  });

  test("the root namespace leaves ids bare; aliases are taken as written", () => {
    const kernel = makeKernel();
    run(
      kernel.load(
        definePlugin({
          name: "core",
          namespace: "",
          apply: (ctx) =>
            ctx.contribute(Greetings, { id: "node.add", aliases: ["add"], value: "" }),
        }),
      ),
    );
    expect(ids(kernel)).toEqual(["node.add"]);
    expect(kernel.lookup(Greetings, "add")?.id).toBe("node.add");
  });

  test("two plugins cannot share a name", () => {
    const kernel = makeKernel();
    run(kernel.load(greeter("dup", "a")));
    expect(failure(kernel.load(greeter("dup", "b")))?.reason).toBe("name-taken");
    expect(ids(kernel)).toEqual(["dup.a"]);
  });

  test("resources acquired in apply are released on unload", () => {
    const kernel = makeKernel();
    const log: string[] = [];
    const handle = run(
      kernel.load(
        definePlugin({
          name: "res",
          apply: () =>
            Effect.acquireRelease(
              Effect.sync(() => log.push("open")),
              () => Effect.sync(() => log.push("close")),
            ),
        }),
      ),
    );
    expect(log).toEqual(["open"]);
    run(handle.unload);
    expect(log).toEqual(["open", "close"]);
  });

  test("shutdown unloads everything, newest first", () => {
    const kernel = makeKernel();
    const log: string[] = [];
    const tracked = (name: string): Plugin =>
      definePlugin({
        name,
        apply: () => Effect.addFinalizer(() => Effect.sync(() => log.push(name))),
      });
    run(kernel.load(tracked("first")));
    run(kernel.load(tracked("second")));
    run(kernel.shutdown);
    expect(log).toEqual(["second", "first"]);
    expect(kernel.plugins()).toEqual([]);
  });
});

describe("failure is atomic", () => {
  test("a clashing contribution fails the plugin and undoes what it registered first", () => {
    const kernel = makeKernel();
    run(kernel.load(greeter("owner", "x")));
    const clashing = definePlugin({
      name: "clash",
      namespace: "owner",
      apply: Effect.fnUntraced(function* (ctx) {
        yield* ctx.provide(Counter, { next: () => 0 });
        yield* ctx.contribute(Greetings, { id: "fine", value: "" });
        yield* ctx.contribute(Greetings, { id: "x", value: "" });
      }),
    });
    const error = failure(kernel.load(clashing));
    expect(error?.reason).toBe("contribution-conflict");
    expect(error?.plugin).toBe("clash");
    expect(ids(kernel)).toEqual(["owner.x"]);
    expect(kernel.service(Counter)).toBeUndefined();
    expect(statusOf(kernel, "clash")).toBe("failed");
  });

  test("a defect in apply is a failed plugin, not a crashed kernel", () => {
    const kernel = makeKernel();
    const broken = definePlugin({
      name: "broken",
      apply: (ctx) =>
        ctx
          .contribute(Greetings, { id: "half", value: "" })
          .pipe(Effect.andThen(Effect.die("boom"))),
    });
    expect(failure(kernel.load(broken))?.reason).toBe("apply-failed");
    expect(ids(kernel)).toEqual([]);
    run(kernel.load(greeter("next", "ok")));
    expect(ids(kernel)).toEqual(["next.ok"]);
  });
});

describe("services and injection", () => {
  test("a plugin waits for what it injects, and runs once it is provided", () => {
    const kernel = makeKernel();
    run(kernel.load(counterUser));
    expect(statusOf(kernel, "user")).toBe("pending");
    expect(kernel.plugins().find((p) => p.name === "user")?.missing).toEqual(["test.counter"]);
    expect(ids(kernel)).toEqual([]);

    run(kernel.load(counterProvider));
    expect(statusOf(kernel, "user")).toBe("active");
    expect(ids(kernel)).toEqual(["user.count"]);
  });

  test("losing a provider sends dependents back to pending; its return brings them back", () => {
    const kernel = makeKernel();
    const provider = run(kernel.load(counterProvider));
    run(kernel.load(counterUser));
    expect(ids(kernel)).toEqual(["user.count"]);

    run(provider.unload);
    expect(statusOf(kernel, "user")).toBe("pending");
    expect(ids(kernel)).toEqual([]);

    run(kernel.load(counterProvider));
    expect(statusOf(kernel, "user")).toBe("active");
    expect(kernel.lookup(Greetings, "user.count")?.value).toBe("1");
  });

  test("one provider per service", () => {
    const kernel = makeKernel();
    run(kernel.load(counterProvider));
    const second = definePlugin({ ...counterProvider, name: "counter2" });
    expect(failure(kernel.load(second))?.reason).toBe("service-conflict");
  });

  test("get of a service not declared in inject is refused", () => {
    const kernel = makeKernel();
    run(kernel.load(counterProvider));
    const sneaky = definePlugin({
      name: "sneaky",
      apply: (ctx) => Effect.asVoid(ctx.get(Counter)),
    });
    expect(failure(kernel.load(sneaky))?.reason).toBe("not-injected");
  });

  test("two different keys with one name are a conflict, not an alias", () => {
    const kernel = makeKernel();
    run(kernel.load(counterProvider));
    const Impostor = Service<{ readonly next: () => number }>()("test.counter");
    const impostor = definePlugin({
      name: "impostor",
      apply: (ctx) => ctx.provide(Impostor, { next: () => 0 }),
    });
    expect(failure(kernel.load(impostor))?.reason).toBe("key-mismatch");
    expect(kernel.service(Impostor)).toBeUndefined();
  });
});

describe("events", () => {
  test("listeners hear emits while loaded, and a failing one fails nobody", () => {
    const kernel = makeKernel();
    const heard: string[] = [];
    const listener = run(
      kernel.load(
        definePlugin({
          name: "ear",
          apply: (ctx) => ctx.on(Said, (word) => Effect.sync(() => heard.push(word))),
        }),
      ),
    );
    run(
      kernel.load(
        definePlugin({
          name: "grump",
          apply: (ctx) => ctx.on(Said, () => Effect.die("nope")),
        }),
      ),
    );
    const mouth: { say?: (word: string) => Effect.Effect<void> } = {};
    run(
      kernel.load(
        definePlugin({
          name: "mouth",
          apply: (ctx) =>
            Effect.sync(() => {
              mouth.say = (word) => ctx.emit(Said, word);
            }),
        }),
      ),
    );
    run(mouth.say?.("hi") ?? Effect.void);
    run(listener.unload);
    run(mouth.say?.("bye") ?? Effect.void);
    expect(heard).toEqual(["hi"]);
  });
});

describe("composition", () => {
  test("children share the parent's namespace and unload with it", () => {
    const kernel = makeKernel();
    const parent = definePlugin({
      name: "canvas",
      namespace: "ext.canvas",
      apply: Effect.fnUntraced(function* (ctx) {
        yield* ctx.plugin(greeter("ui", "surface"));
        yield* ctx.plugin(
          definePlugin({
            name: "store",
            apply: (child) => child.contribute(Greetings, { id: "tx", value: "" }),
          }),
        );
      }),
    });
    const handle = run(kernel.load(parent));
    expect(ids(kernel)).toEqual(["ext.canvas.surface", "ext.canvas.tx"]);
    expect(kernel.plugins().map((p) => [p.name, p.parent])).toEqual([
      ["canvas", null],
      ["canvas/ui", "canvas"],
      ["canvas/store", "canvas"],
    ]);
    run(handle.unload);
    expect(ids(kernel)).toEqual([]);
    expect(kernel.plugins()).toEqual([]);
  });
});
