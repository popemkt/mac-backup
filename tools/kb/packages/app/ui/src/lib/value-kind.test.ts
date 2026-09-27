import { describe, expect, it } from "vitest";
import { parseTypedValue } from "@kb/model";
import { FIELD_TYPES } from "@/lib/field-type";
import { SYSTEM_IDS } from "@/lib/types";
import { EDITOR_MODES, toggledValue, valueKindOf, VALUE_KINDS } from "@/lib/value-kind";

describe("value kinds", () => {
  it("every declared type is a kind, and a field may name its own", () => {
    for (const type of FIELD_TYPES) expect(valueKindOf(type, "f.any")).toBe(type);
    expect(valueKindOf("text", SYSTEM_IDS.colorField)).toBe("color");
    expect(valueKindOf("ref", SYSTEM_IDS.colorField)).toBe("color");
  });

  it("every kind names an editor mode the slot knows", () => {
    for (const spec of Object.values(VALUE_KINDS)) {
      expect(EDITOR_MODES[spec.editor]).toBeDefined();
    }
  });

  it("a caret kind reads its value as text and back", () => {
    expect(VALUE_KINDS.text.text({ t: "str", v: "hi" })).toBe("hi");
    expect(VALUE_KINDS.text.parse("hi")).toEqual({ ok: true, value: { t: "str", v: "hi" } });
    expect(VALUE_KINDS.number.text({ t: "num", v: 42 })).toBe("42");
    expect(VALUE_KINDS.number.parse(" 12 ")).toEqual({ ok: true, value: { t: "num", v: 12 } });
    expect(VALUE_KINDS.number.parse("abc").ok).toBe(false);
  });

  it("a url kind reads input exactly as the CLI and the store do", () => {
    for (const raw of ["example.com/x", "https://kb.example", "javascript:alert(1)", "two words"]) {
      expect(VALUE_KINDS.url.parse(raw)).toEqual(parseTypedValue(raw, "url"));
    }
    expect(VALUE_KINDS.url.parse("example.com/x")).toEqual({
      ok: true,
      value: { t: "str", v: "https://example.com/x" },
    });
  });

  it("a url follows to its link, a legacy bare host included, and never to an unsafe one", () => {
    expect(VALUE_KINDS.url.follow({ t: "str", v: "https://kb.example" })).toEqual({
      kind: "href",
      href: "https://kb.example",
    });
    expect(VALUE_KINDS.url.follow({ t: "str", v: "kb.example" })).toEqual({
      kind: "href",
      href: "https://kb.example",
    });
    expect(VALUE_KINDS.url.follow({ t: "str", v: "javascript:alert(1)" })).toBeNull();
    expect(VALUE_KINDS.url.follow({ t: "str", v: "" })).toBeNull();
  });

  it("a toggle flips a true bool off and anything else on", () => {
    expect(toggledValue({ t: "bool", v: true })).toEqual({ t: "bool", v: false });
    expect(toggledValue({ t: "bool", v: false })).toEqual({ t: "bool", v: true });
    expect(toggledValue({ t: "str", v: "true" })).toEqual({ t: "bool", v: true });
  });

  it("only the pickers open when an unset slot is focused", () => {
    const opening = Object.entries(EDITOR_MODES)
      .filter(([, m]) => m.opensOnFocusWhenEmpty)
      .map(([mode]) => mode);
    expect(opening).toEqual(["picker"]);
  });
});
