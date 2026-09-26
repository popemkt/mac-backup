import { describe, expect, it } from "vitest";
import { TIMING_FALLBACK } from "@/lib/timing";
import { BLOB_BOUNDS, BLOB_COUNT, BlobField, shortestPeriod } from "./blobs";

describe("the glass blobs", () => {
  it("drift no faster than the ambient period (M4)", () => {
    expect(shortestPeriod(TIMING_FALLBACK)).toBeGreaterThanOrEqual(TIMING_FALLBACK.ambientPeriod);
  });

  it("stay inside the march's bounding sphere", () => {
    const field = new BlobField(TIMING_FALLBACK);
    for (let t = 0; t < 120; t += 0.37) {
      field.step(1 / 60, t, { x: 1.2, y: -0.8, z: 0.5 });
      for (const blob of field.blobs) {
        expect(Math.hypot(blob.x, blob.y, blob.z) + blob.radius).toBeLessThan(BLOB_BOUNDS);
      }
    }
    expect(field.blobs).toHaveLength(BLOB_COUNT);
  });

  it("keeps the held blob in bounds when the pointer reaches past them (a far dolly)", () => {
    const field = new BlobField(TIMING_FALLBACK);
    // The farthest dolly (16) at fov 40 puts the frame edge ~5.8 from the centre.
    const aim = { x: 5.8 * 1.6, y: 5.8, z: 0 };
    for (let t = 0; t < 3; t += 1 / 120) field.step(1 / 120, t, aim);
    const held = field.blobs[BLOB_COUNT - 1];
    expect(held).toBeDefined();
    if (held === undefined) return;
    expect(Math.hypot(held.x, held.y, held.z) + held.radius).toBeLessThan(BLOB_BOUNDS);
    // It still leans toward the pointer: pressed against the bound, not dropped.
    expect(Math.hypot(held.x, held.y, held.z)).toBeGreaterThan(BLOB_BOUNDS - 1);
  });

  it("brings the held blob to the pointer within the follow duration (M5)", () => {
    const field = new BlobField(TIMING_FALLBACK);
    const aim = { x: 1, y: 0.5, z: 0 };
    for (let t = 0; t < TIMING_FALLBACK.follow; t += 1 / 120) field.step(1 / 120, t, aim);
    const held = field.blobs[BLOB_COUNT - 1];
    expect(Math.hypot((held?.x ?? 0) - aim.x, (held?.y ?? 0) - aim.y)).toBeLessThan(0.05);
  });
});
