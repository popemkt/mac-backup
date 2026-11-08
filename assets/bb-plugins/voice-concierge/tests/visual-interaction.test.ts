import test from "node:test";
import assert from "node:assert/strict";
import { VisualInteraction } from "../core/visual-interaction.ts";

test("pointer easing preserves elapsed time across frame partitions", () => {
  const coarse = new VisualInteraction("chromeOrbit", 0);
  const fine = new VisualInteraction("chromeOrbit", 0);
  coarse.point(1, -1); fine.point(1, -1);
  const a = coarse.tick(0.5, 500);
  let b = fine.tick(0, 0);
  for (let i = 1; i <= 50; i++) b = fine.tick(0.01, i * 10);
  assert.ok(Math.abs(a.x - b.x) < 1e-12);
  assert.ok(Math.abs(a.y - b.y) < 1e-12);
});

test("reduced motion alignment exposes one deadline and releases statically", () => {
  const interaction = new VisualInteraction("chromeOrbit", 0, true);
  interaction.activate(100, 2);
  assert.equal(interaction.wakeAt, 2100);
  assert.equal(interaction.tick(0, 100, true).align, 1);
  assert.equal(interaction.tick(0, 2100, true).align, 0);
  assert.equal(interaction.wakeAt, Infinity);
  interaction.point(NaN, Infinity);
  assert.ok(Object.values(interaction.tick(NaN, 2200)).every(Number.isFinite));
});

import { advanceSpring } from "../core/spring.ts";

test("press captures directional contact across touch leave and release", () => {
  const visual = new VisualInteraction("aiBlob", 0);
  visual.point(0.7, -0.4);
  visual.press(true);
  visual.tick(0.1, 100);
  visual.press(false);
  visual.point(0, 0);
  visual.activate(100);
  const gesture = visual.tick(0.01, 110);
  assert.equal(gesture.tapX, 0.7);
  assert.equal(gesture.tapY, -0.4);
  assert.ok(gesture.tap > 0 && Number.isFinite(gesture.tap));
  assert.ok(Math.abs(visual.tick(4, 4110).tap) < 0.001);
});

test("held pressure rises smoothly and release settles with bounded rebound", () => {
  const visual = new VisualInteraction("gradientBlob", 0);
  visual.press(true);
  const first = visual.tick(0.01, 10).press;
  assert.ok(first > 0 && first < 1);
  assert.ok(visual.tick(0.5, 510).press > 0.9);
  visual.press(false);
  let largest = 0;
  let rebounded = false;
  for (let i = 0; i < 100; i++) {
    const frame = visual.tick(0.02, 530 + i * 20);
    assert.ok(Number.isFinite(frame.press) && frame.press >= -0.15 && frame.press <= 1.1);
    largest = Math.max(largest, frame.press);
    rebounded ||= frame.press < -0.001;
  }
  assert.ok(largest > 0);
  assert.ok(rebounded, "release should expand past rest before settling");
  assert.ok(visual.tick(1, 3530).press < 0.001);
});

test("repeated taps add energy without discarding existing motion", () => {
  const visual = new VisualInteraction("aiBlob", 0);
  visual.activate(0);
  const before = visual.tick(0.02, 20).tap;
  visual.activate(20);
  const after = visual.tick(0, 20).tap;
  assert.ok(after > before);
  assert.ok(after <= 1.25);
  assert.ok(Math.abs(visual.tick(4, 4020).tap) < 0.001);
});

test("entrance settles and pointer spring overshoot remains bounded", () => {
  const visual = new VisualInteraction("gradientBlob", 0);
  visual.point(1, -1);
  for (let i = 1; i < 100; i++) {
    const frame = visual.tick(0.02, i * 20);
    assert.ok(frame.x <= 1.12 && frame.y >= -1.12);
    assert.ok(frame.intro >= 0 && frame.intro <= 1.1);
  }
  const settled = visual.tick(2, 4000);
  assert.ok(Math.abs(settled.intro - 1) < 0.001);
  visual.press(true); visual.activate(4000);
  const still = visual.tick(0.1, 4100, true);
  for (const key of ["x", "y", "vx", "vy", "tap", "press"] as const) assert.equal(still[key], 0);
  assert.equal(still.intro, 1);
});

test("shared analytical spring preserves elapsed time at voice smoothing damping", () => {
  for (const damping of [0.64, 1]) {
    const coarse = { value: 0.2, velocity: 0.3 }, fine = { ...coarse };
    advanceSpring(coarse, 1, 0.5, 3, damping);
    for (let i = 0; i < 50; i++) advanceSpring(fine, 1, 0.01, 3, damping);
    assert.ok(Math.abs(coarse.value - fine.value) < 1e-10);
    assert.ok(Math.abs(coarse.velocity - fine.velocity) < 1e-10);
  }
});
