import { describe, expect, test } from "bun:test";
import { Result } from "effect";
import type { KbNode } from "@kb/model";
import { decodeContribution, decodeDeclaration, isTemplateContribution } from "../src/index.ts";

/**
 * The extension contract's red cases. These used to live as hand-rolled
 * `actionProblem` / `templateProblem` checks inside the loader; the loader now
 * decodes and reports, so the shape is asserted here, where it is declared.
 */
const schema = { parse: (input: unknown): unknown => input };

function action(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "greet",
    title: "Greet",
    description: "fixture",
    mode: { kind: "read" },
    inputSchema: schema,
    outputSchema: schema,
    handler: () => Promise.resolve({}),
    ...overrides,
  };
}

function failureOf(value: unknown): string {
  const decoded = decodeContribution(value);
  expect(Result.isFailure(decoded), `expected a failure, got ${JSON.stringify(decoded)}`).toBe(
    true,
  );
  return Result.isFailure(decoded) ? decoded.failure : "";
}

describe("decodeContribution", () => {
  test("a valid action decodes to an action", () => {
    const decoded = decodeContribution(action());
    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isSuccess(decoded)) {
      expect(isTemplateContribution(decoded.success)).toBe(false);
    }
  });

  test("a valid template decodes to a template", () => {
    const decoded = decodeContribution({ id: "todos", template: () => "" });
    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isSuccess(decoded)) {
      expect(isTemplateContribution(decoded.success)).toBe(true);
    }
  });

  test("an Effect-native action decodes", () => {
    const decoded = decodeContribution(action({ handler: undefined, effect: () => ({}) }));
    expect(Result.isSuccess(decoded)).toBe(true);
  });

  test("aliases decode when present and are optional when absent", () => {
    expect(Result.isSuccess(decodeContribution(action({ aliases: ["greet"] })))).toBe(true);
    expect(failureOf(action({ aliases: [1] }))).toContain("aliases");
  });

  test("an id must match the namespacing pattern", () => {
    expect(failureOf(action({ id: "bad id" }))).toContain("must match");
    expect(failureOf({ id: "bad id", template: () => "" })).toContain("must match");
  });

  test("mode is a read, or a write that may require approval", () => {
    for (const mode of [{ kind: "write" }, { kind: "write", approval: "required" }]) {
      expect(Result.isSuccess(decodeContribution(action({ mode })))).toBe(true);
    }
    expect(failureOf(action({ mode: "read" }))).toContain("mode");
    expect(failureOf(action({ mode: { kind: "reed" } }))).toContain("mode");
    expect(failureOf(action({ mode: { kind: "read", approval: "required" } }))).toContain("mode");
    expect(failureOf(action({ mode: { kind: "write", approval: "maybe" } }))).toContain("mode");
  });

  test("schemas must be Standard Schema v1 or zod", () => {
    expect(failureOf(action({ inputSchema: 5 }))).toContain("Standard Schema");
    expect(failureOf(action({ outputSchema: {} }))).toContain("Standard Schema");
  });

  test("an action needs an effect or a handler", () => {
    expect(failureOf(action({ handler: undefined }))).toContain("Missing key");
  });

  test("title and description are strings", () => {
    expect(failureOf(action({ title: 1 }))).toContain("title");
    expect(failureOf(action({ description: null }))).toContain("description");
  });

  test("a non-object contribution fails as an action", () => {
    expect(failureOf("nope")).toBe("action: Expected object");
    expect(failureOf(null)).toBe("action: Expected object");
  });
});

function node(id: string): KbNode {
  return { id, text: id, props: {}, children: [], createdAt: "at", updatedAt: "at" };
}

describe("a module's declaration", () => {
  test("absent, it is the declaration of the module's name alone", () => {
    expect(decodeDeclaration(undefined, "hello")).toEqual(
      Result.succeed({ name: "hello", label: "hello" }),
    );
  });

  test("declares a label, a switch and a seed whose nodes it checks when called", () => {
    const decoded = decodeDeclaration(
      { name: "hello", label: "Hello", optional: { byDefault: "off" }, seed: () => [node("a")] },
      "hello",
    );
    if (Result.isFailure(decoded)) throw new Error(decoded.failure);
    expect(decoded.success).toMatchObject({ label: "Hello", optional: { byDefault: "off" } });
    expect(decoded.success.seed?.("at")).toEqual([node("a")]);
    const bad = decodeDeclaration(
      { name: "hello", label: "Hello", seed: () => [{ id: 1 }] },
      "hello",
    );
    if (Result.isFailure(bad)) throw new Error(bad.failure);
    expect(() => bad.success.seed?.("at")).toThrow();
  });

  test("is refused when its name is not its file's, or it declares what a repository extension cannot", () => {
    expect(Result.isFailure(decodeDeclaration({ name: "other", label: "x" }, "hello"))).toBe(true);
    const views = decodeDeclaration({ name: "hello", label: "x", views: [] }, "hello");
    expect(Result.isFailure(views) ? views.failure : "").toContain("declaration:");
    const byDefault = decodeDeclaration(
      { name: "hello", label: "x", optional: { byDefault: "maybe" } },
      "hello",
    );
    expect(Result.isFailure(byDefault)).toBe(true);
  });
});
