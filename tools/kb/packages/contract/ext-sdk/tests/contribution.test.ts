import { describe, expect, test } from "bun:test";
import { Result } from "effect";
import { decodeContribution, isTemplateContribution } from "../src/index.ts";

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
    mode: "read",
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

  test("mode is read or apply", () => {
    expect(failureOf(action({ mode: "reed" }))).toContain("mode");
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
