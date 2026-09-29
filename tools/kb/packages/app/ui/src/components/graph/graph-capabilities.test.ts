import { describe, expect, it } from "vitest";
import {
  CAPABILITY_REASONS,
  capabilitiesFor,
  linkStyleNote,
  settingDisabledReason,
} from "./graph-capabilities";
import { ClusterView, Force2dView, Force3dView, TreeView } from "./views";

describe("renderer capabilities", () => {
  it("declares a descriptor for every built-in renderer", () => {
    for (const r of [Force2dView, ClusterView, TreeView, Force3dView]) {
      expect(r.renderer.capabilities).toBeDefined();
      expect(capabilitiesFor(r)).toEqual(r.renderer.capabilities);
    }
  });

  it("tree supports fit/zoom/reset/search/selection but not node drag", () => {
    const c = capabilitiesFor(TreeView);
    expect(c.fit).toBe(true);
    expect(c.zoom).toBe(true);
    expect(c.reset).toBe(true);
    expect(c.search).toBe(true);
    expect(c.selection).toBe(true);
    expect(c.focus).toBe(true);
    expect(c.drag).toBe(false);
    expect(c.dim).toBe(true);
  });

  it("force3d supports selection but not node drag", () => {
    expect(capabilitiesFor(Force3dView).selection).toBe(true);
    expect(capabilitiesFor(Force3dView).drag).toBe(false);
    expect(capabilitiesFor(Force3dView).fit).toBe(true);
  });

  it("a renderer no view is provided for disables everything (never looks live)", () => {
    const c = capabilitiesFor(null);
    expect(Object.values(c).every((v) => v === false)).toBe(true);
  });

  it("every capability has a hover reason string", () => {
    for (const key of Object.keys(CAPABILITY_REASONS) as Array<keyof typeof CAPABILITY_REASONS>) {
      expect(CAPABILITY_REASONS[key].length).toBeGreaterThan(10);
    }
  });

  it("a setting is live exactly where the renderer's params declare it", () => {
    expect(settingDisabledReason(Force3dView, "spread")).toBeUndefined();
    expect(settingDisabledReason(Force2dView, "spread")).toMatch(/does not support/);
    expect(settingDisabledReason(null, "showLabels")).toMatch(/does not support/);
  });

  it("every renderer that draws force links reads the one link style; only 3D moves it", () => {
    for (const r of [Force2dView, ClusterView, Force3dView])
      expect(settingDisabledReason(r, "linkStyle")).toBeUndefined();
    expect(linkStyleNote(Force2dView, "flow")).toMatch(/still/);
    expect(linkStyleNote(ClusterView, "flow")).toMatch(/still/);
    expect(linkStyleNote(Force2dView, "curved")).toBeUndefined();
    expect(linkStyleNote(Force3dView, "flow")).toBeUndefined();
    expect(linkStyleNote(TreeView, "flow")).toBeUndefined();
  });
});
