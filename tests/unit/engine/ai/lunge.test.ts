import { test } from "node:test";
import assert from "node:assert/strict";
import { RootMotionLibrary } from "../../../../src/engine/anim/rootMotion";
import { ARCHETYPES } from "../../../../src/engine/combat/attacks";
import type { CombatEvent } from "../../../../src/engine/combat/CombatSystem";
import { carriedBy, dashCurve, landingDistance, leapCurve, lungeReach, LUNGE, stopDistance } from "../../../../src/engine/ai/lunge";
import { wrapAngle, yawOf } from "../../../../src/engine/ai/steering";
import { dist, fight, STEP, type Actor } from "../../helpers/ai";
import { ROOT_MOTION_FIXTURE } from "../../helpers/rootMotionFixture";

const lib = () => RootMotionLibrary.parse(ROOT_MOTION_FIXTURE);
const DEG = 180 / Math.PI;

test("lunge maths: carried distance, the fallback dash, a creature's leap, how far a lunge reaches", () => {
  const dash = lib().get("Sword_Dash_RM")!;
  const lunge = ARCHETYPES.axeman.special!;
  // the shipped dash: 3.28 m by the end of its strike window (0.42 s), 3.69 m in all
  assert.ok(Math.abs(carriedBy(dash, lunge.active[1]) - 3.28) < 0.02, `${carriedBy(dash, lunge.active[1])}`);
  assert.ok(Math.abs(carriedBy(dash, dash.duration) - 3.692) < 0.01);
  // without the sidecar: still through the wind-up, 88 % of its travel by the window's end
  const fb = dashCurve(lunge, lunge.travel!);
  assert.equal(carriedBy(fb, lunge.active[0]), 0);
  assert.ok(Math.abs(carriedBy(fb, lunge.active[1]) - lunge.travel! * LUNGE.dashShare) < 1e-9);
  assert.ok(Math.abs(carriedBy(fb, lunge.length) - lunge.travel!) < 1e-9);
  // a spider's leap: off the ground partway through the wind-up, all of it by mid-window
  const jump = ARCHETYPES.smallSpider.special!;
  const leap = leapCurve(jump, 2.5);
  assert.equal(carriedBy(leap, jump.active[0] * 0.5), 0);
  assert.ok(Math.abs(carriedBy(leap, (jump.active[0] + jump.active[1]) / 2) - 2.5) < 1e-9);
  // reach: a strike reaching 1.95 m, carried 3.28 m, lands from up to 4.93 m (0.3 m margin)
  assert.ok(Math.abs(lungeReach(1.95, 3.28) - 4.93) < 1e-9);
  assert.equal(lungeReach(1.75, 0), 1.75, "a move that does not travel reaches only its reach");
  assert.equal(stopDistance(0.35, 0.35), 0.9);
  assert.ok(Math.abs(stopDistance(1, 0.35) - 1.5) < 1e-9, "the giant spider stops short of its own body");
  assert.ok(Math.abs(landingDistance(1.75, 0.95) - 1.15) < 1e-9);
});

/** Swings of `e` with the facing error at each strike, and its blows that landed. */
function watchStrikes(f: ReturnType<typeof fight>, e: Actor) {
  const errs: number[] = [];
  let swings = 0, hits = 0;
  f.combat.events.on((ev: CombatEvent) => {
    if (ev.type === "windup" && ev.attacker === e.c) swings++;
    if (ev.type === "swing" && ev.attacker === e.c) {
      const p = e.agent.position, t = f.pl.p;
      errs.push(Math.abs(wrapAngle(e.agent.yaw - yawOf(t.x - p.x, t.z - p.z))) * DEG);
    }
    if (ev.type === "hit" && ev.hit.attacker === e.c && ev.hit.outcome === "hit") hits++;
  });
  return { errs, get swings() { return swings; }, get hits() { return hits; } };
}

for (const rm of [false, true]) {
  test(`a soldier tracks a player circling it at 2 m/s through the wind-up, then commits (${rm ? "with" : "without"} the root-motion curves)`, () => {
    const f = fight();
    const e = f.enemy("s", "soldier", { x: 0, y: 0, z: -1.6, yaw: 0 }, rm ? { rootMotion: lib() } : {});
    const w = watchStrikes(f, e);
    let a = 0;
    const R = 1.5;
    f.run(25, () => {
      // the player strafes around it, 1.5 m out
      a += (2 / R) * STEP;
      const p = e.agent.position;
      f.pl.p = { x: p.x + Math.sin(a) * R, y: 0, z: p.z + Math.cos(a) * R };
      f.pl.moving = true;
    });
    assert.ok(w.errs.length >= 6, `struck ${w.errs.length} times`);
    const mean = w.errs.reduce((s, x) => s + x, 0) / w.errs.length;
    assert.ok(mean < 12, `mean facing error at the strike ${mean.toFixed(1)}° (${w.errs.map((x) => x.toFixed(0)).join(" ")})`);
    assert.ok(w.hits >= Math.ceil(w.errs.length * 0.8), `${w.hits} of ${w.errs.length} strikes landed`);
  });
}

test("committed: once the strike starts it holds its facing (a late sidestep makes it miss)", () => {
  const f = fight();
  const e = f.enemy("s", "soldier", { x: 0, y: 0, z: -1.5, yaw: 0 }, { rootMotion: lib() });
  f.until(() => !!e.c.swing && e.c.swing.time >= e.c.swing.attack.active[0], 6);
  const yaw = e.agent.yaw;
  // the player jumps to its side
  f.pl.p = { x: e.agent.position.x + 1.4, y: 0, z: e.agent.position.z };
  const s = e.c.swing!;
  f.until(() => s.finished, 2);
  assert.ok(Math.abs(wrapAngle(e.agent.yaw - yaw)) < 1e-6, `held its facing (${((e.agent.yaw - yaw) * DEG).toFixed(1)}°)`);
});

/** An axeman at `d` m straight ahead of the player (who faces it), ready to lunge. */
function lungeAt(d: number, o: { rootMotion?: boolean } = {}) {
  const f = fight();
  const e = f.enemy("axe", "axeman", { x: 0, y: 0, z: -d, yaw: 0 }, o.rootMotion === false ? {} : { rootMotion: lib() });
  const events: CombatEvent[] = [];
  f.combat.events.on((ev) => {
    if (("attacker" in ev && ev.attacker === e.c) || (ev.type === "hit" && ev.hit.attacker === e.c)) events.push(ev);
  });
  return { ...f, e, events };
}

for (const rootMotion of [true, false]) {
  test(`the axeman's lunge (Sword_Dash_RM) lands from its range, ${rootMotion ? "riding the baked curve uncapped" : "as a dash of its travel without the sidecar"}`, () => {
    const range = lungeAt(8, { rootMotion }).e.brain.specialRange()!;
    assert.equal(range[0], 4);
    assert.ok(range[1] > 4.7 && range[1] < 5.1, `lunges from up to ${range[1].toFixed(2)} m`);
    for (const d of [4.1, 4.5, range[1] - 0.02]) {
      const f = lungeAt(d, { rootMotion });
      f.until(() => !!f.e.c.swing, 1);
      assert.equal(f.e.c.swing?.attack.id, "axe_lunge", `lunges from ${d.toFixed(2)} m`);
      const s = f.e.c.swing!;
      f.until(() => s.finished, 3);
      const hit = f.events.find((ev) => ev.type === "hit");
      assert.ok(hit && hit.type === "hit" && hit.hit.attack.id === "axe_lunge" && hit.hit.outcome === "hit", `from ${d.toFixed(2)} m the lunge landed (ended ${dist(f.e.agent.position, f.pl.p).toFixed(2)} m away)`);
      assert.equal(f.player.vitals.hp, 100 - 16);
      assert.ok(dist(f.e.agent.position, f.pl.p) >= 0.85, "never carried into the player");
    }
    // jogging in from afar it picks the lunge inside that range, and lands it
    const f = lungeAt(10, { rootMotion });
    let from = 0;
    f.until(() => {
      if (f.e.c.swing?.attack.id === "axe_lunge" && !from) from = dist(f.e.agent.position, f.pl.p);
      return f.events.some((ev) => ev.type === "hit");
    }, 8);
    assert.ok(from >= 4 && from <= range[1] + 0.05, `started the lunge ${from.toFixed(2)} m out`);
    const hit = f.events.find((ev) => ev.type === "hit");
    assert.ok(hit && hit.type === "hit" && hit.hit.attack.id === "axe_lunge", "the first blow is the lunge");
  });
}

test("the lunge can be parried: block as it strikes, the axeman reels (Hit_Head) and the player's riposte is ready", () => {
  const f = lungeAt(4.6);
  f.until(() => f.events.some((ev) => ev.type === "swing"), 2);
  assert.equal(f.e.c.swing?.attack.id, "axe_lunge");
  // the press as the strike opens: the blade arrives within the 0.18 s parry window
  f.combat.block(f.player, true);
  f.until(() => f.events.some((ev) => ev.type === "hit"), 1);
  const hit = f.events.find((ev) => ev.type === "hit");
  assert.ok(hit && hit.type === "hit" && hit.hit.outcome === "parried", hit && hit.type === "hit" ? hit.hit.outcome : "no blow");
  assert.equal(f.player.vitals.hp, 100);
  assert.equal(f.e.brain.state, "stagger");
  assert.equal(f.e.agent.acting, "Hit_Head");
  assert.ok(f.player.riposteLeft > 0, "punish");
});

for (const [kind, ds] of [
  ["smallSpider", [3.05, 4, 4.9]],
  ["giantSpider", [3.05, 3.8, 4.45]],
] as const) {
  test(`a ${kind}'s lunge (Spider_Jump) leaps at its foe and lands from ${ds[0]}–${ds[ds.length - 1]} m`, () => {
    for (const d of ds) {
      const f = fight();
      const radius = ARCHETYPES[kind].radius;
      const s = f.creature("sp", kind, { x: 0, y: 0, z: -d, yaw: 0 });
      f.until(() => !!s.c.swing, 1);
      assert.equal(s.c.swing?.attack.clip, "Spider_Jump", `leaps from ${d} m`);
      const sw = s.c.swing!;
      let hit = false;
      f.combat.events.on((ev) => void (hit ||= ev.type === "hit" && ev.hit.attacker === s.c && ev.hit.attack === sw.attack && ev.hit.outcome === "hit"));
      f.until(() => sw.finished, 2);
      assert.ok(hit, `from ${d} m the lunge landed (ended ${dist(s.agent.position, f.pl.p).toFixed(2)} m away)`);
      assert.ok(dist(s.agent.position, f.pl.p) >= stopDistance(radius, 0.35) - 0.05, "it lands in front of its foe, not on it");
    }
  });
}

test("the wolf's pounce still comes after its run, and still lands", () => {
  const f = fight();
  const w = f.creature("wolf", "wolf", { x: 0, y: 0, z: -7, yaw: 0 });
  f.until(() => w.brain.state === "charge", 2);
  assert.equal(w.brain.state, "charge");
  f.until(() => w.c.swing?.attack.id === "wolf_pounce", 2);
  const s = w.c.swing!;
  f.until(() => s.finished, 3);
  assert.ok(f.combatEvents.some((ev) => ev.type === "hit" && ev.hit.attack.id === "wolf_pounce" && ev.hit.outcome === "hit"));
});
