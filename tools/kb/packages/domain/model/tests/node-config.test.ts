import { describe, expect, it } from "bun:test";
import { Schema } from "effect";
import {
  allValues,
  decodeNodeConfig,
  firstBool,
  firstNum,
  firstRef,
  firstStr,
  manyOf,
  oneOf,
  type ConfigSlots,
  type NodeProps,
} from "../src/node-config.ts";

interface Demo {
  mode: "list" | "table";
  size: number;
  flag: boolean;
  target: string | null;
  tags: string[];
}

const SLOTS: ConfigSlots<Demo> = {
  mode: oneOf({
    fields: ["f.mode"],
    read: firstStr("f.mode"),
    schema: Schema.Literals(["list", "table"]),
    fallback: "list",
  }),
  size: oneOf({
    fields: ["f.size"],
    read: firstNum("f.size"),
    schema: Schema.Finite.check(Schema.isGreaterThan(0)),
    fallback: 100,
  }),
  flag: oneOf({
    fields: ["f.flag"],
    read: firstBool("f.flag"),
    schema: Schema.Boolean,
    fallback: true,
  }),
  target: oneOf<string | null>({
    fields: ["f.target"],
    read: firstRef("f.target"),
    schema: Schema.NonEmptyString,
    fallback: null,
  }),
  tags: manyOf<string>({
    fields: ["f.tags"],
    read: (props) =>
      allValues("f.tags")(props)?.map((value) => (value.v === "skip" ? null : value.v)),
    schema: Schema.NullOr(Schema.NonEmptyString),
    fallback: ["default"],
  }),
};

function decode(props: NodeProps) {
  const warnings: string[] = [];
  const slot = decodeNodeConfig<Demo>(SLOTS, props, (warning) => warnings.push(warning));
  const value: Demo = {
    mode: slot("mode"),
    size: slot("size"),
    flag: slot("flag"),
    target: slot("target"),
    tags: slot("tags"),
  };
  return { value, warnings };
}

describe("node-config", () => {
  it("falls back for every slot when nothing is stored, and reports nothing", () => {
    const { value, warnings } = decode({});
    expect(value).toEqual({
      mode: "list",
      size: 100,
      flag: true,
      target: null,
      tags: ["default"],
    });
    expect(warnings).toEqual([]);
  });

  it("decodes each carrier through its own schema", () => {
    const { value, warnings } = decode({
      "f.mode": [{ t: "str", v: "table" }],
      "f.size": [{ t: "num", v: 42 }],
      "f.flag": [{ t: "bool", v: false }],
      "f.target": [{ t: "ref", v: "n.a" }],
      "f.tags": [
        { t: "str", v: "one" },
        { t: "str", v: "two" },
      ],
    });
    expect(value).toEqual({
      mode: "table",
      size: 42,
      flag: false,
      target: "n.a",
      tags: ["one", "two"],
    });
    expect(warnings).toEqual([]);
  });

  it("reports a present prop the schema rejects, and uses the declared fallback", () => {
    const { value, warnings } = decode({ "f.mode": [{ t: "str", v: "kanban" }] });
    expect(value.mode).toBe("list");
    expect(warnings).toEqual(['f.mode ignored: Expected "list" | "table"']);
  });

  it("reports a present prop stored under a carrier the slot cannot read", () => {
    const { value, warnings } = decode({ "f.size": [{ t: "str", v: "42" }] });
    expect(value.size).toBe(100);
    expect(warnings).toEqual(["f.size ignored: no readable value"]);
  });

  it("keeps the readable values of a multi-valued field and reports the rest by index", () => {
    const { value, warnings } = decode({
      "f.tags": [
        { t: "str", v: "one" },
        { t: "str", v: "" },
        { t: "str", v: "two" },
      ],
    });
    expect(value.tags).toEqual(["one", "two"]);
    expect(warnings).toEqual(["f.tags[1] ignored: Expected a value with a length of at least 1"]);
  });

  it("drops an element that decodes to null without reporting it", () => {
    const { value, warnings } = decode({
      "f.tags": [
        { t: "str", v: "skip" },
        { t: "str", v: "kept" },
      ],
    });
    expect(value.tags).toEqual(["kept"]);
    expect(warnings).toEqual([]);
  });

  it("tells a present-but-empty multi-valued field from an absent one", () => {
    expect(decode({ "f.tags": [] }).value.tags).toEqual([]);
    expect(decode({}).value.tags).toEqual(["default"]);
  });

  it("reports once per slot read, so the report is complete when the config is", () => {
    const { warnings } = decode({
      "f.mode": [{ t: "str", v: "kanban" }],
      "f.size": [{ t: "num", v: -1 }],
    });
    expect(warnings).toEqual([
      'f.mode ignored: Expected "list" | "table"',
      "f.size ignored: Expected a value greater than 0",
    ]);
  });

  it("names every field a slot reads in its warning", () => {
    const paired = {
      keys: manyOf<string>({
        fields: ["f.keys", "f.dirs"],
        read: () => [1],
        schema: Schema.NullOr(Schema.String),
        fallback: [],
      }),
    };
    const warnings: string[] = [];
    const slot = decodeNodeConfig<{ keys: string[] }>(paired, { "f.keys": [] }, (w) =>
      warnings.push(w),
    );
    expect(slot("keys")).toEqual([]);
    expect(warnings).toEqual(["f.keys + f.dirs[0] ignored: Expected string | null"]);
  });
});
