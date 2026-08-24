import { describe, expect, it } from "vitest";
import {
  CAPABILITY_REASONS,
  capabilitiesFor,
  RENDERER_CAPABILITIES,
} from "./graph-capabilities";

describe("renderer capabilities", () => {
  it("declares a descriptor for every built-in renderer", () => {
    for (const r of ["force2d", "cluster", "tree", "force3d"] as const) {
      expect(RENDERER_CAPABILITIES[r]).toBeDefined();
      expect(capabilitiesFor(r)).toEqual(RENDERER_CAPABILITIES[r]);
    }
  });

  it("tree supports fit/zoom/reset/search/selection but not focus/drag/dim", () => {
    const c = capabilitiesFor("tree");
    expect(c.fit).toBe(true);
    expect(c.zoom).toBe(true);
    expect(c.reset).toBe(true);
    expect(c.search).toBe(true);
    expect(c.selection).toBe(true);
    expect(c.focus).toBe(false);
    expect(c.drag).toBe(false);
    expect(c.dim).toBe(false);
  });

  it("force3d does not claim selection until task 14 wires it", () => {
    expect(capabilitiesFor("force3d").selection).toBe(false);
    expect(capabilitiesFor("force3d").drag).toBe(false);
    expect(capabilitiesFor("force3d").fit).toBe(true);
  });

  it("unknown renderer disables everything (never looks live)", () => {
    const c = capabilitiesFor("metro");
    expect(Object.values(c).every((v) => v === false)).toBe(true);
  });

  it("every capability has a hover reason string", () => {
    for (const key of Object.keys(CAPABILITY_REASONS) as Array<
      keyof typeof CAPABILITY_REASONS
    >) {
      expect(CAPABILITY_REASONS[key].length).toBeGreaterThan(10);
    }
  });
});
