import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  KbNodeSchema,
  PropValueSchema,
  nodeParseOptions,
} from "@kb/model";
import { WireNodeSchema } from "../src/protocol.ts";

const at = "2026-01-01T00:00:00.000Z";

describe("PropValueSchema discriminant", () => {
  const good = [
    { t: "str" as const, v: "hello" },
    { t: "num" as const, v: 42 },
    { t: "bool" as const, v: true },
    { t: "date" as const, v: "2026-01-01" },
    { t: "ref" as const, v: "n.target" },
  ];

  for (const value of good) {
    test(`accepts ${value.t}`, () => {
      expect(Schema.decodeUnknownSync(PropValueSchema)(value)).toEqual(value);
    });
  }

  const bad = [
    { t: "num", v: "not-a-number" },
    { t: "str", v: 1 },
    { t: "bool", v: "true" },
    { t: "date", v: 1 },
    { t: "ref", v: 1 },
    { t: "weird", v: 1 },
    { t: "str", v: true },
    { t: "num", v: false },
    { t: "bool", v: 0 },
  ];

  for (const value of bad) {
    test(`rejects ${JSON.stringify(value)}`, () => {
      expect(() => Schema.decodeUnknownSync(PropValueSchema)(value)).toThrow();
    });
  }

  test("KbNodeSchema-valid node parses as WireNodeSchema", () => {
    const node = {
      id: "n.1",
      text: "t",
      props: {
        "sys.f.type": [
          { t: "ref", v: "sys.tag" },
          { t: "str", v: "ok" },
          { t: "num", v: 1 },
          { t: "bool", v: false },
          { t: "date", v: at },
        ],
      },
      children: [] as string[],
      createdAt: at,
      updatedAt: at,
    };
    const decoded = Schema.decodeUnknownSync(KbNodeSchema, nodeParseOptions)(
      node,
    );
    expect(WireNodeSchema.parse(decoded)).toMatchObject({ id: "n.1" });
  });

  test("uncorrelated prop is rejected by KbNodeSchema (wire parity)", () => {
    const node = {
      id: "n.bad",
      text: "t",
      props: { "sys.f.type": [{ t: "num", v: "not-a-number" }] },
      children: [] as string[],
      createdAt: at,
      updatedAt: at,
    };
    expect(() =>
      Schema.decodeUnknownSync(KbNodeSchema, nodeParseOptions)(node),
    ).toThrow();
  });
});
