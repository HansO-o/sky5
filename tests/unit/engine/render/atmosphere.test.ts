import { test } from "node:test";
import assert from "node:assert/strict";
import { AtmosphereBlend, climbOut, lerpAtmosphere, smoothstep, type Atmosphere } from "../../../../src/engine/render/atmosphere";

const OUT: Atmosphere = { env: 0.95, fog: [0.6, 0.64, 0.68], density: 0.0024, exposure: 1.05, sun: 2.1, fill: 0.12 };
const CAVE: Atmosphere = { env: 0.05, fog: [0.02, 0.025, 0.03], density: 0.04, exposure: 1.6, sun: 0, fill: 0.02 };
const near = (a: number, b: number, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);

test("lerp, smoothstep and the climb-out distance blend", () => {
  const mid = lerpAtmosphere(OUT, CAVE, 0.5);
  near(mid.sun, 1.05);
  near(mid.fog[1], (0.64 + 0.025) / 2);
  near(lerpAtmosphere(OUT, CAVE, 2).exposure, 1.6);
  near(smoothstep(0.5), 0.5);
  near(smoothstep(-1), 0);
  assert.ok(smoothstep(0.1) < 0.1 && smoothstep(0.9) > 0.9);
  // fully the interior 13 m or more from the mouth, fully outdoor at it
  near(climbOut(20, 13), 0);
  near(climbOut(13, 13), 0);
  near(climbOut(6.5, 13), 0.5);
  near(climbOut(0, 13), 1);
});

test("a blend eases from the shown values to the target over its seconds", () => {
  const b = new AtmosphereBlend(OUT);
  b.to(CAVE, 2);
  assert.ok(b.blending);
  near(b.step(0).sun, 2.1);
  near(b.step(1).sun, 1.05);
  const end = b.step(1.5);
  assert.equal(b.blending, false);
  assert.deepEqual(end, CAVE);
  // retargeting mid-blend starts from where it is
  b.to(OUT, 1);
  b.step(0.5);
  b.to(CAVE, 1);
  near(b.step(0).sun, 1.05);
});

test("a start override (exposure flare) and a function target the blend keeps following", () => {
  const b = new AtmosphereBlend(CAVE);
  let mood = 0;
  const outdoor = (): Atmosphere => ({ ...OUT, sun: OUT.sun * (1 - mood * 0.35) });
  b.to(outdoor, 2, { exposure: 2.4 });
  near(b.step(0).exposure, 2.4);
  near(b.step(2).exposure, 1.05);
  mood = 1;
  near(b.step(0.1).sun, 2.1 * 0.65);
  // 0 s: at once
  b.to(CAVE, 0);
  assert.equal(b.blending, false);
  near(b.step(0).exposure, 1.6);
});
